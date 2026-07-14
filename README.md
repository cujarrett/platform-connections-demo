# platform-connections-demo

Test apps for my homelab's platform-connections mesh POC — See [docs/platform-connections](https://github.com/cujarrett/homelab/blob/main/docs/platform-connections.md) in the homelab repo.

One repo, not one-per-app, because these are throwaway POC apps with no independent release cadence — delete this whole repo once the mesh decision is validated and the real `XConnection` platform work begins.

| App | Role |
|---|---|
| [`api/`](api/) | Protected upstream service (`GET /api/v1/data`) |
| [`caller/`](caller/) | Calls `api` internally, plus a registered and an unregistered external FQDN. Deployed twice — as `authorized-caller` and `unauthorized-caller` — under different service accounts. Same image, same code; only the identity differs, which is the whole point of the mesh test. |

Each app is an independent Go module with its own `justfile` (`just ci` to lint/test/build).
