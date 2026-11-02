# platform-connections-demo

Demo apps behind [Platform Engineering: Connections](https://github.com/cujarrett/homelab/blob/main/platform/docs/connections.md) in the homelab repo.

Three apps in one namespace. Two of them run a byte-identical image and differ only in what they declare - which is the whole point.

| App | Role |
|---|---|
| [`api/`](api/) | The API being called, deployed as `upstream-api`. Grants one caller and no one else. |
| [`downstream/`](downstream/) | The caller. Deployed twice, as `authorized-api` and `unauthorized-api`, under different service accounts. |
| [`spa/`](spa/) | The walkthrough. Seven live calls showing what gets through and what does not. |

## Run it

Both commands run from `spa/` and serve the walkthrough on http://localhost:4200. Run `just install` first.

| Command | Callers |
|---|---|
| `just dev` | The two callers in the cluster, port-forwarded. Needs `kubectl` pointed at the homelab |
| `npm run start:prod-api` | The live site, `connections.mattjarrett.dev`. Needs only Node |

Both give real results. Port-forwarding carries only the first hop from your laptop, so every decision still happens inside the cluster. The callers have no from-source variant, because the mesh that makes each decision only runs in the cluster.

`just --list` shows the rest.

Each Go app has its own `justfile` - `just ci` to lint, test and build.
