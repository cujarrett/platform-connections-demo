# api

Upstream POC API for the platform-connections mesh test — serves protected data that only `authorized-caller` should be able to reach. See [docs/platform-connections](https://github.com/cujarrett/homelab/blob/main/docs/platform-connections.md) in the homelab repo.

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
| `GET` | `/api/v1/data` | Protected data — proves ingress registration + mTLS |

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP listen port |

## Deployment

POC — deployed as a plain manifest in the `poc-api` namespace, not yet as an `XApi` instance. Image: `ghcr.io/cujarrett/api`. ARM64.
