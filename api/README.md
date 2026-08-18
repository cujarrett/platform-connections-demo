# api

The API being called, deployed as `upstream-api`. It grants one caller at the mesh and one role inside the app.

What that means and why is the walkthrough itself, at [connections.mattjarrett.dev](https://connections.mattjarrett.dev), designed in [Platform Engineering: Connections](https://github.com/cujarrett/homelab/blob/main/docs/platform-connections.md). This file is what you need to change the code.

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
| `GET` | `/api/v1/data` | Mesh-only. Whoever the mesh lets through is served |
| `GET` | `/api/v1/protected` | Requires the `Data.Read` app role in the token |
| `GET` | `/api/v1/admin` | Requires `Data.Admin`, granted to nobody - always 403 |
| `GET` | `/metrics` | Prometheus metrics on `METRICS_PORT` - build info, protected reads, and role decisions split by outcome |

Every refusal carries `"gate"`, because a mesh 403 and a role 403 are otherwise indistinguishable. `401` means the token was not believed, not that the caller was refused.

## Environment variables

Both `AZURE_` values are injected by the platform from `entra.enabled`. Unset either and the role routes refuse everything rather than verify half a token; the mesh routes are unaffected.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP listen port |
| `METRICS_PORT` | No | `9090` | Prometheus listen port - separate from `PORT` so the app port stays identity-enforced |
| `AZURE_TENANT_ID` | No | unset | Tenant whose v2.0 issuer signs the tokens |
| `AZURE_CLIENT_ID` | No | unset | This API's own client id, and the audience every token must carry |

## Deployment

An `Api` instance in the `platform-connections-demo` namespace. The roles it offers and who holds them are declared in [`upstream-api.yaml`](https://github.com/cujarrett/homelab-workspaces/blob/main/platform-connections-demo/upstream-api.yaml). Image: `ghcr.io/cujarrett/platform-connections-demo-api`. ARM64.
