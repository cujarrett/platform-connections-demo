# caller

Generic caller POC app for the platform-connections mesh test — calls `api` internally and both a registered and an unregistered external FQDN. Identity-agnostic by design: the same image is deployed twice, once as `authorized-caller` (allowed) and once as `unauthorized-caller` (denied) — the difference is the service account each instance runs as, not the code. See `docs/platform-connections.md` in the homelab repo.

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
| `GET` | `/api/call` | Calls `api`'s `/api/v1/data` — proves internal registration + mTLS |
| `GET` | `/api/weather` | Calls `api.open-meteo.com` — a **registered** external FQDN, proves `ServiceEntry` allow |
| `GET` | `/api/leak` | Calls `example.com` — an **unregistered** external FQDN, must be blocked by `REGISTRY_ONLY` |

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP listen port |
| `API_URL` | No | `http://api.poc-api.svc.cluster.local:8080/api/v1/data` | Internal `api` service endpoint to call |

## Deployment

POC — deployed as a plain manifest in the `poc-caller` namespace (twice: `authorized-caller` and `unauthorized-caller`), not yet as `XApi` instances. Image: `ghcr.io/cujarrett/platform-connections-demo-caller`. ARM64.
