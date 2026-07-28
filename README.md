# platform-connections-demo

Demo apps behind [Platform Engineering: Connections](https://github.com/cujarrett/homelab/blob/main/docs/platform-engineering-connections.md) in the homelab repo.

Three apps in one namespace. Two of them run a byte-identical image and differ only in what they declare — which is the whole point.

| App | Role |
|---|---|
| [`api/`](api/) | The API being called, deployed as `upstream-api`. Grants one caller and no one else. |
| [`downstream/`](downstream/) | The caller. Deployed twice, as `authorized-api` and `unauthorized-api`, under different service accounts. |
| [`spa/`](spa/) | The walkthrough. Four live calls showing what gets through and what does not. |

## Run it

```bash
cd spa
just dev
```

Then open **http://localhost:4200**.

That port-forwards the two callers and serves the walkthrough against them. The results are real: port-forwarding carries only the first hop from your laptop, so every decision still happens inside the cluster.

Needs `kubectl` pointed at the homelab, plus `just` and Node. `just --list` shows the rest.

Each Go app has its own `justfile` — `just ci` to lint, test and build.
