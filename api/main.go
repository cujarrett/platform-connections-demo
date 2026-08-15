package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"time"
)

// version is set at build time via -ldflags="-X main.version=x.y.z".
// Falls back to "dev" when running locally with go run.
var version = "dev"

// dataRequests counts successful reads of the protected endpoint - the number that
// tells you whether connection enforcement is actually letting the caller through.
var dataRequests atomic.Int64

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

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
	// Mesh-only. Whoever the mesh lets through is served.
	mux.HandleFunc("GET /api/v1/data", dataHandler)
	// Same connection rules as above, then a role check. These two differ only in
	// which role they ask for - one the caller holds, one nobody does.
	mux.HandleFunc("GET /api/v1/protected", entraRoleHandler(roleRead))
	mux.HandleFunc("GET /api/v1/admin", entraRoleHandler(roleAdmin))
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

	startEntraVerifier(ctx)

	go func() {
		logger.Info("server listening", "port", port, "version", version)
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

func dataHandler(w http.ResponseWriter, r *http.Request) {
	dataRequests.Add(1)
	slog.Info("data request", "remote", r.RemoteAddr)
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"data":"ok"}`) //nolint:errcheck
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok","version":%q}`, version) //nolint:errcheck
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
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w, "# HELP demo_api_build_info Build information for this service.\n")       //nolint:errcheck
	fmt.Fprintf(w, "# TYPE demo_api_build_info gauge\n")                                     //nolint:errcheck
	fmt.Fprintf(w, "demo_api_build_info{version=%q} 1\n", version)                           //nolint:errcheck
	fmt.Fprintf(w, "# HELP demo_api_data_requests_total Requests served on /api/v1/data.\n") //nolint:errcheck
	fmt.Fprintf(w, "# TYPE demo_api_data_requests_total counter\n")                          //nolint:errcheck
	fmt.Fprintf(w, "demo_api_data_requests_total %d\n", dataRequests.Load())                 //nolint:errcheck
	// Split by outcome - summing them would hide the refused series.
	fmt.Fprintf(w, "# HELP demo_api_entra_decisions_total Role checks on /api/v1/protected.\n")     //nolint:errcheck
	fmt.Fprintf(w, "# TYPE demo_api_entra_decisions_total counter\n")                               //nolint:errcheck
	fmt.Fprintf(w, "demo_api_entra_decisions_total{outcome=\"allowed\"} %d\n", entraAllowed.Load()) //nolint:errcheck
	fmt.Fprintf(w, "demo_api_entra_decisions_total{outcome=\"refused\"} %d\n", entraRefused.Load()) //nolint:errcheck
}

func notFoundHandler(w http.ResponseWriter, r *http.Request) {
	slog.Info("404", "method", r.Method, "path", r.URL.Path)
	w.WriteHeader(http.StatusNotFound)
}
