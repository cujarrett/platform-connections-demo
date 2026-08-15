package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"time"
)

// version is set at build time via -ldflags="-X main.version=x.y.z".
// Falls back to "dev" when running locally with go run.
var version = "dev"

const (
	// weatherURL is a registered external destination (proves an allowed ServiceEntry).
	weatherURL = "https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current_weather=true"
	// leakURL is deliberately unregistered (proves REGISTRY_ONLY blocks it).
	leakURL = "https://example.com"
	// maxResponseBytes caps how much of an upstream response we buffer - upstreams are
	// external, so an unbounded read would let a large response OOM the pod.
	maxResponseBytes = 1 << 20 // 1 MiB
)

// httpClient does not follow redirects - a redirect to an internal address would be
// an SSRF vector. Return the redirect response as-is instead of chasing it.
var httpClient = &http.Client{
	Timeout: 5 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// callKey labels one counter series. The label set is fixed and tiny - three targets,
// four outcomes - so a plain map under a mutex is enough.
type callKey struct {
	target  string
	outcome string
}

var (
	callsMu sync.Mutex
	calls   = map[callKey]int64{}
)

func record(target, outcome string) {
	callsMu.Lock()
	defer callsMu.Unlock()
	calls[callKey{target, outcome}]++
}

// outcome maps an upstream status onto the thing the demo is actually showing -
// 403 is how the mesh refuses an undeclared caller.
func outcome(status int) string {
	switch {
	case status >= 200 && status < 300:
		return "ok"
	case status == http.StatusForbidden:
		return "denied"
	default:
		return "error"
	}
}

func metricsServer(port string) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /metrics", metricsHandler)
	return &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

// metricsHandler serves Prometheus text format. The platform scrapes every Api, so
// this route must exist even though the sidecar already reports request rates.
func metricsHandler(w http.ResponseWriter, _ *http.Request) {
	callsMu.Lock()
	keys := make([]callKey, 0, len(calls))
	for k := range calls {
		keys = append(keys, k)
	}
	snapshot := make(map[callKey]int64, len(calls))
	for k, v := range calls {
		snapshot[k] = v
	}
	callsMu.Unlock()

	sort.Slice(keys, func(i, j int) bool {
		if keys[i].target != keys[j].target {
			return keys[i].target < keys[j].target
		}
		return keys[i].outcome < keys[j].outcome
	})

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w, "# HELP demo_downstream_build_info Build information for this service.\n")         //nolint:errcheck
	fmt.Fprintf(w, "# TYPE demo_downstream_build_info gauge\n")                                       //nolint:errcheck
	fmt.Fprintf(w, "demo_downstream_build_info{version=%q} 1\n", version)                             //nolint:errcheck
	fmt.Fprintf(w, "# HELP demo_downstream_calls_total Outbound calls by destination and outcome.\n") //nolint:errcheck
	fmt.Fprintf(w, "# TYPE demo_downstream_calls_total counter\n")                                    //nolint:errcheck
	for _, k := range keys {
		fmt.Fprintf(w, "demo_downstream_calls_total{target=%q,outcome=%q} %d\n", k.target, k.outcome, snapshot[k]) //nolint:errcheck
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Platform convention: reach another app at <app>.<namespace>.svc.cluster.local.
	// Nothing injects this - the name is deterministic, so there is no URL to declare.
	upstream := os.Getenv("UPSTREAM_URL")
	if upstream == "" {
		upstream = "http://upstream-api.platform-connections-demo.svc.cluster.local"
	}

	// One host, two routes. Built from the same base so they cannot drift onto
	// different hosts - the demo only means anything if the Entra check is the single
	// difference between these two calls.
	apiURL := upstream + "/api/v1/data"
	entraURL := upstream + "/api/v1/protected"
	entraAdminURL := upstream + "/api/v1/admin"

	// Metrics live on their own port. Sharing the app port would force the platform to
	// mark that port identity-free so Prometheus can scrape it, which would undo the
	// connection enforcement this demo exists to show.
	metricsPort := os.Getenv("METRICS_PORT")
	if metricsPort == "" {
		metricsPort = "9090"
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthHandler)
	mux.HandleFunc("GET /api/call", callHandler(apiURL))
	mux.HandleFunc("GET /api/entra", entraHandler("entra", entraURL))
	mux.HandleFunc("GET /api/entra-admin", entraHandler("entra-admin", entraAdminURL))
	mux.HandleFunc("GET /api/weather", proxyHandler("weather", weatherURL))
	mux.HandleFunc("GET /api/leak", proxyHandler("leak", leakURL))
	mux.HandleFunc("GET /api/table", tableHandler)
	mux.HandleFunc("/", notFoundHandler)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	metricsSrv := metricsServer(metricsPort)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	go func() {
		logger.Info("server listening", "port", port, "version", version, "api_url", apiURL)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	go func() {
		logger.Info("metrics listening", "port", metricsPort)
		if err := metricsSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("metrics server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down")
	if err := metricsSrv.Shutdown(context.Background()); err != nil {
		logger.Error("metrics shutdown error", "err", err)
	}
	if err := srv.Shutdown(context.Background()); err != nil {
		logger.Error("shutdown error", "err", err)
	}
}

// callHandler proxies to the internal `api` service - proves internal registration + mTLS.
func callHandler(target string) http.HandlerFunc {
	return proxyHandler("upstream-api", target)
}

// proxyHandler forwards the request to target and relays the result, for exercising
// both internal (mTLS) and external (ServiceEntry) connection registration. name is
// the metrics label for the destination.
func proxyHandler(name, target string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
		if err != nil {
			writeJSONError(w, "build request failed", http.StatusInternalServerError)
			return
		}

		resp, err := httpClient.Do(req)
		if err != nil {
			// The connection never completed. A REGISTRY_ONLY block on an unregistered
			// external destination lands here, not on an HTTP status.
			record(name, "unreachable")
			slog.Warn("upstream call failed", "target", target, "err", err)
			writeJSONError(w, "upstream call failed", http.StatusBadGateway)
			return
		}
		record(name, outcome(resp.StatusCode))
		defer resp.Body.Close() //nolint:errcheck

		body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		if err != nil {
			writeJSONError(w, "read upstream response failed", http.StatusBadGateway)
			return
		}

		slog.Info("upstream call", "target", target, "status", resp.StatusCode)
		// Upstream content is untrusted (external); force JSON type and forbid MIME sniffing.
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(resp.StatusCode)
		w.Write(body) //nolint:errcheck
	}
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok","version":%q}`, version) //nolint:errcheck
}

func notFoundHandler(w http.ResponseWriter, r *http.Request) {
	slog.Info("404", "method", r.Method, "path", r.URL.Path)
	w.WriteHeader(http.StatusNotFound)
}

func writeJSONError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	fmt.Fprintf(w, `{"error":%q}`, msg) //nolint:errcheck
}
