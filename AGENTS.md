# platform-connections-demo

The page at connections.mattjarrett.dev and the three apps it calls. See [Platform Engineering: Connections](https://github.com/cujarrett/homelab/blob/main/platform/docs/connections.md) in the `homelab` repo for the full design.

## Rules

- **Never run `git add`, `git commit`, `git push`, or any git command that writes to or modifies the index, repository history, or remotes.** Output the commands for the user to run. Staging is part of their review, and running it for them removes the checkpoint.
- **Never add a `Co-Authored-By` trailer or a "Generated with Claude Code" line** to commit messages or PR descriptions, including in suggested commit messages. Commits are authored by the user alone.
- **Whenever a task requires a commit, always give a suggested commit message.** Never leave the user to write it themselves.
- **Give `git add` and the commit as two separate steps, listing every file explicitly.** Never `git add .` or `git add -A`.
- **Never output a `git push` command.** The user pushes as a deliberate human step.
- **No semicolons in TS.** The SPA enforces it with Prettier (`semi: false` in `spa/.prettierrc`), and CI runs `format:check`.

### Pre-commit safety check

Before telling the user to commit, always run `/security-review`. Once it confirms the changes are safe, offer a suggested commit message. Do not run `git commit` yourself.

## Philosophy: Grug-Brained Development

> "Complexity very, very bad." ([grugbrain.dev](https://grugbrain.dev/))

- **Say no.** No new feature, no new abstraction, until it earns its place.
- **Cheapest rung that works.** Before writing code go down the ladder and stop at the first rung that solves it: skip the feature, reuse code already here, standard library, native platform feature, a dependency already installed, one line, then build the minimum.
- **80/20 solutions.** Ugly but working beats elegant but over-engineered.
- **No FOLD** (Fear Of Looking Dumb). If something is too complex, say so.

## Layout

```
api/          Go API deployed as upstream-api, the service being called
downstream/   Go caller, one image deployed as authorized-api and unauthorized-api
spa/          the walkthrough page, an Angular app
```

`api/` and `downstream/` each have their own `go.mod`, `justfile` and `CLAUDE.md` with routes and conventions.

## Build tool: `just`, not `make`

Each of `api/`, `downstream/` and `spa/` has its own `justfile`. Run `just ci` in the one you changed before pushing. `just dev` in `spa/` port-forwards both callers and serves the page against the cluster.

## CI

One workflow per app. A push to `main` runs only the workflows whose directory changed. Every pull request runs all three.

| Workflow | Image | Updates in `homelab-workspaces` |
|---|---|---|
| `api.yml` | `ghcr.io/cujarrett/platform-connections-demo-api` | `platform-connections-demo/upstream-api.yaml` |
| `downstream.yml` | `ghcr.io/cujarrett/platform-connections-demo-downstream` | `authorized-api.yaml` and `unauthorized-api.yaml` in `platform-connections-demo/` |
| `spa.yml` | `ghcr.io/cujarrett/platform-connections-demo-spa` | `platform-connections-demo/connections-demo.yaml` |

## Required secrets (GitHub → repo settings → Secrets)

| Secret | Used by | Scope needed |
|---|---|---|
| `HOMELAB_WORKSPACES_PAT` | deploy job in every workflow | a PAT with push access to `cujarrett/homelab-workspaces` |

`GITHUB_TOKEN` (built in) covers the `ghcr.io` image push.
