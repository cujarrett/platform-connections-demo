package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
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
	// maxResponseBytes caps how much of an upstream response we buffer — upstreams are
	// external, so an unbounded read would let a large response OOM the pod.
	maxResponseBytes = 1 << 20 // 1 MiB
)

// httpClient does not follow redirects — a redirect to an internal address would be
// an SSRF vector. Return the redirect response as-is instead of chasing it.
var httpClient = &http.Client{
	Timeout: 5 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	apiURL := os.Getenv("API_URL")
	if apiURL == "" {
		apiURL = "http://api.poc-api.svc.cluster.local:8080/api/v1/data"
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthHandler)
	mux.HandleFunc("GET /api/call", callHandler(apiURL))
	mux.HandleFunc("GET /api/weather", proxyHandler(weatherURL))
	mux.HandleFunc("GET /api/leak", proxyHandler(leakURL))
	mux.HandleFunc("/", notFoundHandler)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	go func() {
		logger.Info("server listening", "port", port, "version", version, "api_url", apiURL)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down")
	if err := srv.Shutdown(context.Background()); err != nil {
		logger.Error("shutdown error", "err", err)
	}
}

// callHandler proxies to the internal `api` service — proves internal registration + mTLS.
func callHandler(target string) http.HandlerFunc {
	return proxyHandler(target)
}

// proxyHandler forwards the request to target and relays the result, for exercising
// both internal (mTLS) and external (ServiceEntry) connection registration.
func proxyHandler(target string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
		if err != nil {
			writeJSONError(w, "build request failed", http.StatusInternalServerError)
			return
		}

		resp, err := httpClient.Do(req)
		if err != nil {
			slog.Warn("upstream call failed", "target", target, "err", err)
			writeJSONError(w, "upstream call failed", http.StatusBadGateway)
			return
		}
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
