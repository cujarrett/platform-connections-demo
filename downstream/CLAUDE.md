## Rules

- **Never run `git commit`, `git push`, or any git command that writes to or modifies repository history or remotes.** If a task requires committing or pushing, stop and tell the user to run the git command manually.
- **Whenever a task requires a commit, always give a suggested commit message** - never leave the user to write it themselves.

### Pre-commit safety check

Before telling the user to commit, always run `/security-review`. It reviews the pending changes on the current branch for security issues. Once it confirms the changes are safe, offer the user a suggested commit message - do not run `git commit` yourself.

## Philosophy: Grug-Brained Development

> "Complexity very, very bad." - [grugbrain.dev](https://grugbrain.dev/)

- **Say no.** The best weapon against complexity is the word "no". No new feature, no new abstraction, until it earns its place.
- **No abstraction until a pattern repeats three times.** Let cut points emerge naturally from the code; don't invent them up front.
- **80/20 solutions.** Ship 80% of the value with 20% of the code. Ugly but working beats elegant but over-engineered.
- **Chesterton's Fence.** Understand why code exists before removing it. If you don't see the use, go away and think.
- **Boring, obvious code wins.** Intermediate variables with good names beat clever one-liners. Easier to debug.
- **DRY is not a law.** A little copy-paste beats a complex abstraction built for two cases.
- **No FOLD** (Fear Of Looking Dumb). If something is too complex, say so. That's a signal to simplify, not a personal failing.

# downstream

Go HTTP API. Single binary, no frameworks. The caller in the homelab platform-connections demo. See [Platform Engineering: Connections](https://github.com/cujarrett/homelab/blob/main/platform/docs/connections.md) in the homelab repo - exercises internal (mTLS), external (`ServiceEntry`), Entra and bound-resource paths. Identity-agnostic: one image deployed twice, as `authorized-api` and `unauthorized-api`, so the only difference is what each instance declares.

## Commands
| Command | What it does |
|---|---|
| `just ci` | Lint + test + build (run before pushing) |
| `just run` | Start the server locally on port 8080 |
| `just test` | Run tests with race detector |
| `just lint` | go mod tidy -diff + golangci-lint |

## Routes
| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | Liveness probe |
| GET | `/api/call` | Calls `upstream-api` internally |
| GET | `/api/entra` | Trades this pod's SVID for an Entra token, then calls `/api/v1/protected` |
| GET | `/api/entra-admin` | The same token against `/api/v1/admin` - the role is held by nobody, so 403 |
| GET | `/api/weather` | Calls a registered external FQDN (`api.open-meteo.com`) |
| GET | `/api/leak` | Calls an unregistered external FQDN (`example.com`) - blackholed by `REGISTRY_ONLY`, so 502 |
| GET | `/api/table` | Round-trips one item through the bound DynamoDB table |
| GET | `/metrics` | Prometheus metrics on `METRICS_PORT` (9090) - the platform scrapes every Api, so this route is required |

## Conventions
- No frameworks - stdlib `net/http` only
- `slog` for structured logging
- Graceful shutdown via `signal.NotifyContext`
- Errors returned as `{"error":"..."}` JSON
- Binary name matches repo name
- Every `AZURE_*`, `ENTRA_SCOPE_*` and AWS variable is injected by the platform from what the `Api` declared. None is a secret, and none is written by hand
- Credentials never reach a response body. The Entra routes return only the identity proved and the API asked for
