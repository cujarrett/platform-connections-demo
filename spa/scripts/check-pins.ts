// Checks that every pinned line range in src/app/cases.ts still matches main.
// The links stay valid either way, so drift is silent: the page explains code main no longer runs.
// Exits 1 listing each block that changed or moved off its lines, so the workflow fails and alerts.
import { readFileSync } from "node:fs"

interface Pin {
  fn: "composition" | "workspace"
  pattern: RegExp
  sha: string
  raw: (ref: string, file?: string) => string
}

const cases = readFileSync(new URL("../src/app/cases.ts", import.meta.url), "utf8")

function pinnedSha(name: string): string {
  const match = cases.match(new RegExp(`const ${name} = "([0-9a-f]{40})"`))
  if (!match?.[1]) throw new Error(`${name} not found in cases.ts`)
  return match[1]
}

const pins: Pin[] = [
  {
    fn: "composition",
    pattern: /composition\("(?<note>[^"]+)", (?<from>\d+), (?<to>\d+)\)/g,
    sha: pinnedSha("COMPOSITION_SHA"),
    raw: (ref) =>
      `https://raw.githubusercontent.com/cujarrett/homelab/${ref}/platform/api/composition.yaml`,
  },
  {
    fn: "workspace",
    pattern: /workspace\("(?<file>[^"]+)", "(?<note>[^"]+)", (?<from>\d+), (?<to>\d+)\)/g,
    sha: pinnedSha("WORKSPACES_SHA"),
    raw: (ref, file) =>
      `https://raw.githubusercontent.com/cujarrett/homelab-workspaces/${ref}/platform-connections-demo/${file}`,
  },
]

async function block(url: string, from: number, to: number): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  return (await res.text())
    .split("\n")
    .slice(from - 1, to)
    .join("\n")
}

const drifted: string[] = []
for (const pin of pins) {
  const seen = new Set<string>()
  for (const match of cases.matchAll(pin.pattern)) {
    const { file, note, from, to } = match.groups ?? {}
    const key = `${file}:${from}-${to}`
    if (seen.has(key)) continue
    seen.add(key)
    const pinned = await block(pin.raw(pin.sha, file), Number(from), Number(to))
    const current = await block(pin.raw("main", file), Number(from), Number(to))
    if (pinned !== current)
      drifted.push(`${pin.fn}: ${file ?? "composition.yaml"} L${from}-L${to} (${note})`)
  }
}

if (drifted.length) {
  console.error(
    `${drifted.length} pinned block(s) no longer match main. Repin them in src/app/cases.ts:`,
  )
  for (const d of drifted) console.error(`  ${d}`)
  process.exit(1)
}
console.log("Every pinned block still matches main.")
