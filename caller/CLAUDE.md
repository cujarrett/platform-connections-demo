## Rules

- **Never run `git commit`, `git push`, or any git command that writes to or modifies repository history or remotes.** If a task requires committing or pushing, stop and tell the user to run the git command manually.
- **Whenever a task requires a commit, always give a suggested commit message** — never leave the user to write it themselves.

### Pre-commit safety check

Before telling the user to commit, always run `/pre-commit-review`. It checks for secrets, sensitive identifiers, PII, credential templates, and cluster safety, and returns explicit verdicts on whether the changes are safe for a public repo and safe to apply to the homelab cluster. Once it confirms the changes are safe, offer the user a suggested commit message — do not run `git commit` yourself.

## Philosophy: Grug-Brained Development

> "Complexity very, very bad." — [grugbrain.dev](https://grugbrain.dev/)

- **Say no.** The best weapon against complexity is the word "no". No new feature, no new abstraction, until it earns its place.
- **No abstraction until a pattern repeats three times.** Let cut points emerge naturally from the code; don't invent them up front.
- **80/20 solutions.** Ship 80% of the value with 20% of the code. Ugly but working beats elegant but over-engineered.
- **Chesterton's Fence.** Understand why code exists before removing it. If you don't see the use, go away and think.
- **Boring, obvious code wins.** Intermediate variables with good names beat clever one-liners. Easier to debug.
- **DRY is not a law.** A little copy-paste beats a complex abstraction built for two cases.
- **No FOLD** (Fear Of Looking Dumb). If something is too complex, say so. That's a signal to simplify, not a personal failing.

# caller

Go HTTP API. Single binary, no frameworks. POC app for the homelab platform-connections mesh test. See [docs/platform-connections](https://github.com/cujarrett/homelab/blob/main/docs/platform-connections.md) in the homelab repo — proves both internal (mTLS) and external (`ServiceEntry`) connection registration. Identity-agnostic: deployed twice under different service accounts (`authorized-caller`, `unauthorized-caller`) to prove enforcement is identity-based, not code-based.

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
| GET | `/api/call` | Calls `api` internally |
| GET | `/api/weather` | Calls a registered external FQDN (`api.open-meteo.com`) |
| GET | `/api/leak` | Calls an unregistered external FQDN (`example.com`) — must fail once `REGISTRY_ONLY` is enforced |

## Conventions
- No frameworks — stdlib `net/http` only
- `slog` for structured logging
- Graceful shutdown via `signal.NotifyContext`
- Errors returned as `{"error":"..."}` JSON
- Binary name matches repo name
