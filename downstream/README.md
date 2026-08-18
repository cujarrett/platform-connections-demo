# downstream

The caller. One image deployed twice, as `authorized-api` and `unauthorized-api`, so the only difference between them is what each declares.

What each route proves is the walkthrough itself, at [connections.mattjarrett.dev](https://connections.mattjarrett.dev), designed in [Platform Engineering: Connections](https://github.com/cujarrett/homelab/blob/main/docs/platform-connections.md). This file is what you need to change the code.

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
| `GET` | `/api/call` | Calls `upstream-api` `/api/v1/data` |
| `GET` | `/api/entra` | Trades this pod's SVID for an Entra token, then calls `/api/v1/protected` |
| `GET` | `/api/entra-admin` | The same token against `/api/v1/admin` |
| `GET` | `/api/weather` | Calls `api.open-meteo.com`, a registered external host |
| `GET` | `/api/leak` | Calls `example.com`, unregistered, so the connection never completes and this returns 502 |
| `GET` | `/api/table` | Writes, reads and deletes one item in the bound DynamoDB table |
| `GET` | `/metrics` | Prometheus metrics on `METRICS_PORT` - build info and `demo_downstream_calls_total{target,outcome}` |

`outcome` is one of `ok` (2xx), `denied` (403), `unreachable` (the connection never completed), or `error` (any other status).

The Entra routes answer with `exchanged` and `upstream_said`. Neither the SVID nor the access token is in either - both are live credentials, and the page reading this is public.

## Environment variables

Everything below `METRICS_PORT` is injected by the platform from what the `Api` declared. None is a secret, and none should be set by hand.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP listen port |
| `METRICS_PORT` | No | `9090` | Prometheus listen port - separate from `PORT` so the app port stays identity-enforced |
| `UPSTREAM_URL` | No | `http://upstream-api.platform-connections-demo.svc.cluster.local` | Base URL of the API to call |
| `AZURE_TENANT_ID` | No | unset | Tenant to ask for a token |
| `AZURE_CLIENT_ID` | No | unset | The identity this pod acts as |
| `AZURE_FEDERATED_TOKEN_FILE` | No | unset | Path to the JWT-SVID a sidecar keeps fresh, posted as a `client_assertion` |
| `ENTRA_SCOPE_UPSTREAM_API` | No | unset | The scope to ask for, one per app in `consumes` |
| `SERVICE_BINDING_ROOT` | No | `/bindings` | Where bound resources are mounted, one directory per binding |
| `AWS_SHARED_CREDENTIALS_FILE` | No | unset | Credentials file the sidecar writes, one profile per binding |

## Deployment

Two `Api` instances in the `platform-connections-demo` namespace sharing one image tag: [`authorized-api.yaml`](https://github.com/cujarrett/homelab-workspaces/blob/main/platform-connections-demo/authorized-api.yaml) and [`unauthorized-api.yaml`](https://github.com/cujarrett/homelab-workspaces/blob/main/platform-connections-demo/unauthorized-api.yaml). Image: `ghcr.io/cujarrett/platform-connections-demo-downstream`. ARM64.
