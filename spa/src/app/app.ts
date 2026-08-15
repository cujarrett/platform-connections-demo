import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  signal,
  ChangeDetectorRef,
  inject,
} from "@angular/core"
import { DomSanitizer, SafeHtml } from "@angular/platform-browser"
import { NgTemplateOutlet } from "@angular/common"
import { CASES, Case, Snippet } from "./cases"
import { highlightYaml } from "./yaml-highlight"
import { LaunchpadMark } from "./launchpad-mark"

type Actor = "caller" | "callee"

/** One pod's whole story: what its team declared, then what the platform put on it. */
interface Party {
  actor: Actor
  label: string
  cls: string
  blocks: { snip: Snippet; role: string }[]
  /** Stands in for the blocks when a pod renders nothing - off-platform callees. */
  note?: string
}

// Each on-platform app keeps one colour across every card so the reader tracks
// actors by sight. Off-platform destinations share one muted colour - they are
// scenery, not participants. Green and red stay reserved for call results.
const POD_CLASS: Record<string, string> = {
  "authorized-api": "pod-authorized",
  "unauthorized-api": "pod-unauthorized",
  "upstream-api": "pod-callee",
  "api.open-meteo.com": "pod-metro",
  "example.com": "pod-example",
  "s3.amazonaws.com": "pod-s3",
  "dynamodb.amazonaws.com": "pod-dynamo",
}
const podClassOf = (name: string): string => POD_CLASS[name] ?? "pod-site"

/**
 * One column per pod, caller left and callee right, matching the diagram above it.
 * Within a column: what that pod's team declared, then what the platform rendered onto
 * it. Split by written-vs-rendered instead, both columns held both pods, and ownership
 * could only be worked out by counting rows across blocks of unequal height.
 */
function partiesOf(c: Case): Party[] {
  const byActor = new Map<Actor, Party>()
  const add = (snip: Snippet, role: string) => {
    if (!snip.actor) return
    const party = byActor.get(snip.actor) ?? {
      actor: snip.actor,
      label: "",
      cls: "",
      blocks: [],
    }
    party.blocks.push({ snip, role })
    byActor.set(snip.actor, party)
  }
  for (const snip of c.declared ?? []) add(snip, "the app declares")
  for (const snip of c.rendered ?? []) add(snip, "the platform makes")

  if (!byActor.has("callee") && c.call && c.upstream) {
    byActor.set("callee", { actor: "callee", label: "", cls: "", blocks: [], note: c.upstream })
  }

  const order: Actor[] = ["caller", "callee"]
  return order.flatMap((actor) => {
    const party = byActor.get(actor)
    if (!party) return []
    const name = (actor === "caller" ? c.call?.from : c.call?.to) ?? ""
    party.label = `${actor} · ${name}`
    party.cls = podClassOf(name)
    return [party]
  })
}

interface Result {
  state: "idle" | "calling" | "done"
  code: number
  ms: number
  body: string
}

@Component({
  selector: "app-root",
  imports: [NgTemplateOutlet, LaunchpadMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scroll-progress" [style.width.%]="progress()"></div>

    <div class="page">
      <header class="hero">
        <h1><app-launchpad-mark [animate]="true" />Platform Engineering: Connections</h1>
        <p class="lede">
          Kubernetes runs the workloads. Service Mesh decides which calls get through.
        </p>
        <p class="sub">
          Six live calls, run against
          <a href="https://blog.mattjarrett.dev/homelab/" target="_blank" rel="noopener"
            >my bookshelf Kubernetes cluster</a
          >.
          <a
            href="https://github.com/cujarrett/homelab/blob/main/docs/nothing-novel.md"
            target="_blank"
            rel="noopener"
            >Nothing here is novel</a
          >.
        </p>
      </header>

      @for (c of cases; track c.title; let i = $index) {
        @if (c.section) {
          <div class="layer" [class.entra]="c.section.label === 'Entra'">
            <h2>{{ c.section.label }}</h2>
            <p>{{ c.section.blurb }}</p>
          </div>
        }
        <section class="case" [class]="verdict(i)" [id]="'case-' + i">
          <div class="narrative">
            <span class="kind" [class.entra]="c.kind.startsWith('entra')">{{ c.kind }}</span>
            <h2>{{ c.title }}</h2>
            <p class="summary">{{ c.summary }}</p>
          </div>

          <div
            class="card"
            [class.allow]="verdict(i) === 'allow'"
            [class.deny]="verdict(i) === 'deny'"
            [class.broken]="verdict(i) === 'broken'"
          >
            @if (c.call; as call) {
              <div class="call">
                <div
                  class="pod {{ podClass(call.from) }}"
                  [class.acting]="call.enforcedAt === 'downstream'"
                >
                  <div class="pod-app">
                    <div class="role">caller</div>
                    <div class="who">{{ call.from }}</div>
                  </div>
                  <div class="mesh" [class.gate]="call.enforcedAt === 'downstream'">
                    <span>service mesh</span>
                    @if (call.enforcedAt === "downstream") {
                      <span class="mark" [class]="verdict(i)">{{ mark(i) }}</span>
                    }
                  </div>
                </div>

                <div
                  class="wire {{ wirePhase(i) }}"
                  [class.flying]="results()[i].state === 'calling'"
                >
                  <div class="gate-label">{{ call.gate }}</div>
                  <div class="leg"></div>
                </div>

                <div
                  class="pod {{ podClass(call.to) }}"
                  [class.acting]="call.enforcedAt === 'upstream'"
                >
                  <div class="pod-app">
                    <div class="role">callee</div>
                    <div class="who">{{ call.to }}</div>
                    @if (call.enforcedAt !== "upstream") {
                      <div class="kind-note">{{ offPlatformKind(call.to) }}</div>
                    }
                  </div>
                  @if (call.enforcedAt === "upstream") {
                    <div class="mesh gate" [class.by-app]="call.enforcedBy === 'app'">
                      <span>{{ call.enforcedBy === "app" ? "app code" : "service mesh" }}</span>
                      <span class="mark" [class]="verdict(i)">{{ mark(i) }}</span>
                    </div>
                  }
                </div>
              </div>

              <div class="res">
                <span class="req">{{ call.request }}</span>
                <span class="outcome">
                  <span
                    class="status"
                    [class.ok]="verdict(i) === 'allow'"
                    [class.no]="verdict(i) === 'deny'"
                    [class.warn]="verdict(i) === 'broken'"
                    [class.idle]="results()[i].state !== 'done'"
                    >{{ statusText(i) }}</span
                  >
                  <span class="ms">{{ results()[i].ms ? results()[i].ms + " ms" : "" }}</span>
                </span>
                @if (call.codeNote && results()[i].state === "done") {
                  <span class="code-note">{{ call.codeNote }}</span>
                }
                <button
                  class="run"
                  [class.primary]="results()[i].state === 'idle'"
                  (click)="run(i)"
                  [disabled]="results()[i].state === 'calling'"
                >
                  {{ results()[i].state === "idle" ? "▶  Run this call" : "Run again" }}
                </button>
              </div>

              <div class="body-slot">
                @if (results()[i].state === "done") {
                  <span class="body-arrow">↳</span>
                  <span class="body-text" [class.denied]="verdict(i) === 'deny'">{{
                    responseBody(i)
                  }}</span>
                  @if (isEnvoyBody(i)) {
                    <span class="body-source">not JSON. Envoy wrote this, the app never ran</span>
                  }
                }
              </div>

              <div class="why-slot">
                @if (verdict(i) === "broken") {
                  <p class="why broken">
                    <b>Demo not connected.</b> Expected HTTP {{ call.expect }}. Start it with
                    <code>just dev</code> from <code>spa/</code>. <code>npm start</code> alone skips
                    the port-forwards.
                  </p>
                } @else if (results()[i].state === "done") {
                  <p class="why" [innerHTML]="html(call.why)"></p>
                }
              </div>
            }

            <!-- Every link on the page is one of these: the file, what to look at once
                 it opens, and the line range when there is one. Rendered next to the
                 snippet it belongs to, so "show me the real thing" is one click from
                 the thing itself, never a footnote pile at the bottom. -->
            <ng-template #source let-s let-compact="compact">
              <a class="src" [href]="s.url" [title]="s.note" target="_blank" rel="noopener">
                <span class="src-file">{{ s.file }}</span>
                <span class="src-go">↗</span>
                @if (!compact) {
                  <span class="src-note">{{ s.note }}</span>
                }
              </a>
            </ng-template>

            <!-- One column per pod, in that pod's colour, in the same order as the
                 diagram above - caller left, callee right. Each block is its own box so
                 two files never share one scroll box with a blank line between them. -->
            <ng-template #partyCol let-party>
              <div class="yaml-col {{ party.cls }}">
                <div class="yaml-h">{{ party.label }}</div>
                @if (party.note; as note) {
                  <p class="party-note" [innerHTML]="html(note)"></p>
                }
                @for (block of party.blocks; track $index) {
                  <div class="snippet">
                    <div class="srcs">
                      <span class="src-role">{{ block.role }}</span>
                      <span class="src-links">
                        @for (s of block.snip.sources; track s.url) {
                          <ng-container
                            [ngTemplateOutlet]="source"
                            [ngTemplateOutletContext]="{ $implicit: s, compact: true }"
                          />
                        }
                      </span>
                    </div>
                    <pre><code [innerHTML]="yaml(block.snip.code)"></code></pre>
                  </div>
                }
              </div>
            </ng-template>

            <ng-template #detail>
              <div class="deep">
                <div [innerHTML]="html(c.deep)"></div>
                @if (c.docs; as docs) {
                  <div class="srcs">
                    @for (d of docs; track d.url) {
                      <ng-container
                        [ngTemplateOutlet]="source"
                        [ngTemplateOutletContext]="{ $implicit: d }"
                      />
                    }
                  </div>
                }
                <!-- Declaration left, rendered policy right, across the full width. The
                     asymmetry is the point - a few lines written, all of that rendered -
                     and it only lands when the two are side by side at the same scale. -->
                <div class="yaml-pair">
                  @for (party of parties[i]; track party.actor) {
                    <ng-container
                      [ngTemplateOutlet]="partyCol"
                      [ngTemplateOutletContext]="{ $implicit: party }"
                    />
                  }
                </div>
              </div>
            </ng-template>

            @if (!c.call) {
              <ng-container [ngTemplateOutlet]="detail" />
            }
            <!-- Only after the call lands. The panel explains what just happened, so
                 offering it beforehand asks a question the reader has not met yet.
                 Gone once open, because the panel's head below carries the same words -
                 shown in both places the question reads as asked twice, rather than as
                 the one thing that moved. -->
            @if (c.call && results()[i].state === "done" && !isOpen(i)) {
              <button class="deep-toggle" (click)="togglePanel(i)" [attr.aria-expanded]="false">
                <span class="sum-text">{{ detailPrompt(i) }}</span>
                <span class="sum-chev">›</span>
              </button>
            }
          </div>

          @if (c.call && isOpen(i)) {
            <div class="deep-panel" [class]="verdict(i)">
              <button class="deep-head" (click)="togglePanel(i)" [attr.aria-expanded]="true">
                <span class="deep-mark">{{ mark(i) }}</span>
                <span>{{ detailPrompt(i) }}</span>
                <span class="sum-chev">›</span>
              </button>
              <ng-container [ngTemplateOutlet]="detail" />
            </div>
          }
        </section>
      }
    </div>
  `,
})
export class App {
  /** Shortest time the wire animation stays visible, regardless of how fast the call is. */
  private static readonly MIN_FLIGHT_MS = 620

  private readonly sanitizer = inject(DomSanitizer)
  private readonly cdr = inject(ChangeDetectorRef)

  readonly cases = CASES
  readonly progress = signal(0)
  readonly results = signal<Result[]>(
    CASES.map(() => ({ state: "idle", code: 0, ms: 0, body: "" })),
  )

  // Which deep panels are open. A <details> cannot do this - the trigger sits in the
  // card and the content spans both grid columns, so they are two separate elements.
  private readonly openPanels = signal<ReadonlySet<number>>(new Set())

  // Each on-platform app keeps one colour across every card so the reader tracks
  // actors by sight. Off-platform destinations share one muted colour - they are
  // scenery, not participants. Green and red stay reserved for call results.
  podClass(name: string): string {
    return podClassOf(name)
  }

  /** Built once - the grouping is static, and the template reads it per case. */
  readonly parties: Party[][] = CASES.map(partiesOf)

  // Off-platform destinations are not all alike to the app: one is a website it calls
  // over HTTP, the other a cloud service it calls through an SDK. To the mesh they are
  // the same MESH_EXTERNAL entry, so the difference is named, never gated on.
  offPlatformKind(name: string): string {
    return name.endsWith("amazonaws.com") ? "cloud service" : "public site"
  }

  /** The hue of the pod a snippet belongs to - the same one that pod wears above. */
  isOpen(i: number): boolean {
    return this.openPanels().has(i)
  }

  togglePanel(i: number): void {
    this.openPanels.update((open) => {
      const next = new Set(open)
      if (!next.delete(i)) next.add(i)
      return next
    })
  }

  @HostListener("window:scroll")
  onScroll(): void {
    const max = document.documentElement.scrollHeight - window.innerHeight
    this.progress.set(max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0)
  }

  /** "" until answered, "broken" when the answer is not one the mesh would give. */
  // Where the packet actually died decides how far the leg travels. A call refused at
  // the caller's own side never crossed the wire - drawing it arriving and bouncing
  // back would teach the opposite of what the 502 means.
  wirePhase(i: number): string {
    const v = this.verdict(i)
    if (!v) return ""
    if (v === "broken") return "wire-crossed-broken"
    const call = this.cases[i].call
    if (v === "deny" && call?.enforcedAt === "downstream") return "wire-stopped-near"
    return v === "deny" ? "wire-crossed-deny" : "wire-crossed-allow"
  }

  verdict(i: number): "allow" | "deny" | "broken" | "" {
    const r = this.results()[i]
    if (r.state !== "done") return ""
    const expected = this.cases[i].call?.expect
    if (r.code !== expected) return "broken"
    return r.code === 200 ? "allow" : "deny"
  }

  statusText(i: number): string {
    const r = this.results()[i]
    if (r.state === "idle") return "not run"
    if (r.state === "calling") return "calling…"
    if (r.code === 0) return "no response"
    return `HTTP ${r.code}`
  }

  /**
   * Cloudflare replaces 5xx bodies from the origin with its own HTML error page, which
   * says nothing. Only the app's or Envoy's own words are worth showing.
   */
  // Envoy's RBAC filter answers with a fixed plain-text body. Every other body on this
  // page is JSON from an app, so the format difference is the proof the app never ran.
  isEnvoyBody(i: number): boolean {
    return this.results()[i].body.trimStart().startsWith("RBAC:")
  }

  responseBody(i: number): string {
    const body = this.results()[i].body
    if (/^\s*<(!doctype|html)/i.test(body)) return "(origin error page, no body from the app)"
    return body.length > 96 ? body.slice(0, 96) + " …" : body
  }

  /** The invite matches what just happened, so it reads as the obvious next question. */
  detailPrompt(i: number): string {
    if (!this.cases[i].call) return "What adding user identity looks like"
    switch (this.verdict(i)) {
      case "deny":
        return "So what refused it?"
      case "allow":
        return "So what let it through?"
      default:
        return "What decides this?"
    }
  }

  /** Symbol shown on the mesh strip that decided. */
  mark(i: number): string {
    const v = this.verdict(i)
    return v === "allow" ? "✓" : v === "deny" ? "✕" : v === "broken" ? "!" : "·"
  }

  yaml(source: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(highlightYaml(source))
  }

  html(value: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(value)
  }

  async run(i: number): Promise<void> {
    const call = this.cases[i].call
    if (!call) return

    this.patch(i, { state: "calling", code: 0, ms: 0, body: "" })
    const started = performance.now()
    // Tick while in flight so the wait reads as a real network wait, not a spinner.
    const tick = setInterval(() => {
      this.patch(i, {
        state: "calling",
        code: 0,
        ms: Math.round(performance.now() - started),
        body: "",
      })
    }, 30)

    let code = 0
    let body = ""
    try {
      const response = await fetch(call.url, { cache: "no-store" })
      code = response.status
      body = (await response.text()).trim().replace(/\s+/g, " ")
    } catch {
      code = 0
      body = "no response. is the demo running?"
    }
    const ms = Math.round(performance.now() - started)
    clearInterval(tick)

    // These calls answer in well under 100ms, which is faster than the eye can follow.
    // Hold the in-flight animation to a visible floor while freezing the displayed
    // timing at what was actually measured - the number stays honest, the motion
    // becomes legible.
    this.patch(i, { state: "calling", code: 0, ms, body: "" })
    const remaining = App.MIN_FLIGHT_MS - (performance.now() - started)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))

    this.patch(i, { state: "done", code, ms, body })
  }

  private patch(i: number, value: Result): void {
    this.results.update((all) => {
      const next = [...all]
      next[i] = value
      return next
    })
    this.cdr.markForCheck()
  }
}
