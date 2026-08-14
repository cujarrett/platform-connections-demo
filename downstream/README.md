# downstream

Generic downstream POC app for the platform-connections mesh test - calls `api` internally and both a registered and an unregistered external FQDN. Identity-agnostic by design: the same image is deployed twice, once as `authorized-api` (allowed) and once as `unauthorized-api` (denied) - the difference is the service account each instance runs as, not the code. See `docs/platform-engineering-connections.md` in the homelab repo.

## Commands

| Command | What it does |
|---|---|
| `just ci` | Lint + test + build (run before pushing) |
| `just run` | Start the server locally on port 8080 |
| `just test` | Run tests with race detector |
| `just lint` | go mod tidy -diff + golangci-lint |

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz` | Liveness probe |
| `GET` | `/api/call` | Calls `api`'s `/api/v1/data` - proves internal registration + mTLS |
| `GET` | `/api/weather` | Calls `api.open-meteo.com` - a **registered** external FQDN, proves `ServiceEntry` allow |
| `GET` | `/api/leak` | Calls `example.com` - an **unregistered** external FQDN, must be blocked by `REGISTRY_ONLY` |
| `GET` | `/metrics` | Prometheus metrics on `METRICS_PORT` - build info and `demo_downstream_calls_total{target,outcome}` |

`demo_downstream_calls_total` is where enforcement becomes visible. `outcome` is one of `ok` (2xx), `denied` (the mesh refused an undeclared caller with 403), `unreachable` (the connection never completed, which is how a `REGISTRY_ONLY` block on an unregistered destination shows up), or `error` (any other status).

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP listen port |
| `METRICS_PORT` | No | `9090` | Prometheus listen port - separate from `PORT` so the app port stays identity-enforced |
| `API_URL` | No | `http://api.poc-api.svc.cluster.local:8080/api/v1/data` | Internal `api` service endpoint to call |

## Deployment

POC - deployed as a plain manifest in the `platform-connections-demo` namespace (twice: `authorized-api` and `unauthorized-api`), not yet as `Api` instances. Image: `ghcr.io/cujarrett/platform-connections-demo-downstream`. ARM64.
