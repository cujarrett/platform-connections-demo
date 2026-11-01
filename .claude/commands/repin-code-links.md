---
description: Repin the SPA's code links to homelab and homelab-workspaces main. Use when the pin-check workflow fails, or after the Api composition or a demo workspace file changes.
---

The cards in `spa/src/app/cases.ts` link to line ranges at a pinned commit.
`spa/scripts/check-pins.ts` fails when a pinned block no longer matches main.
The job is done when that script prints `Every pinned block still matches main.`

1. Run the check from `spa/`.

   ```bash
   node scripts/check-pins.ts
   ```

   Green means stop. Nothing needs repinning.

2. Get main's commit for each repo with a drifted line.

   ```bash
   git ls-remote https://github.com/cujarrett/homelab.git main             # composition lines
   git ls-remote https://github.com/cujarrett/homelab-workspaces.git main  # workspace lines
   ```

3. Edit `cases.ts`.
   - `COMPOSITION_SHA` or `WORKSPACES_SHA`: set to that commit. Bump only a SHA whose repo drifted.
   - `moved to A, B`: the block is unchanged. Swap in the new line numbers on every call with the old pair.
   - `changed, reread it`: the code itself changed. Read the block on main, pick its new range, and rewrite the card's YAML snippet and note to match. Show the user each rewritten snippet.

4. Run the check again until it is green. Then run `just ci` and `npm run format:check` in `spa/`.

5. Run `/security-review`, then give the commit commands per `AGENTS.md`. Commit message shape: `fix(spa): repin composition code links to homelab <short-sha>`.
