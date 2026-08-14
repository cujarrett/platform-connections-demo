# api

Upstream POC API for the platform-connections mesh test - serves protected data that only `authorized-api` should be able to reach. See [Platform Engineering: Connections](https://github.com/cujarrett/homelab/blob/main/docs/platform-engineering-connections.md) in the homelab repo.

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
| `GET` | `/api/v1/data` | Protected data - proves ingress registration + mTLS |
| `GET` | `/metrics` | Prometheus metrics on `METRICS_PORT` - build info and a count of protected reads served |

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP listen port |
| `METRICS_PORT` | No | `9090` | Prometheus listen port - separate from `PORT` so the app port stays identity-enforced |

## Deployment

POC - deployed as a plain manifest in the `platform-connections-demo` namespace, not yet as an `Api` instance. Image: `ghcr.io/cujarrett/platform-connections-demo-api`. ARM64.
