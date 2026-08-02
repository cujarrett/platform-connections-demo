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
import { CASES, Case } from "./cases"
import { highlightYaml } from "./yaml-highlight"

interface Result {
  state: "idle" | "calling" | "done"
  code: number
  ms: number
  body: string
}

@Component({
  selector: "app-root",
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scroll-progress" [style.width.%]="progress()"></div>

    <div class="page">
      <header class="hero">
        <h1>Platform Engineering: Connections</h1>
        <p class="lede">
          Kubernetes runs the workloads. Service Mesh decides which calls get through.
        </p>
        <p class="sub">
          Six live calls, run against
          <a href="https://blog.mattjarrett.dev/homelab/" target="_blank" rel="noopener"
            >my bookshelf Kubernetes cluster</a
          >.
        </p>
      </header>

      @for (c of cases; track c.title; let i = $index) {
        <section class="case" [id]="'case-' + i">
          <div class="narrative" [class]="verdict(i)">
            <span class="kind">{{ c.kind }}</span>
            <h2>{{ c.title }}</h2>
            <p class="grug">{{ c.grug }}</p>
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
                    <div class="mesh gate">
                      <span>service mesh</span>
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
                    <span class="body-source">not JSON — Envoy wrote this, the app never ran</span>
                  }
                }
              </div>

              <div class="why-slot">
                @if (verdict(i) === "broken") {
                  <p class="why broken">
                    <b>Demo not connected.</b> Expected HTTP {{ call.expect }} from the mesh. Start
                    it with <code>just dev</code> from <code>spa/</code> — <code>npm start</code>
                    alone skips the port-forwards.
                  </p>
                } @else if (results()[i].state === "done") {
                  <p class="why" [innerHTML]="html(call.why)"></p>
                }
              </div>
            }

            <ng-template #detail>
              <div class="deep">
                <div [innerHTML]="html(c.deep)"></div>
                @if (c.downstream && c.upstream) {
                  <div class="sides">
                    <div>
                      <div class="h">on the caller's pod</div>
                      <div [innerHTML]="html(c.downstream)"></div>
                    </div>
                    <div>
                      <div class="h">on the callee's side</div>
                      <div [innerHTML]="html(c.upstream)"></div>
                    </div>
                  </div>
                }
                <!-- Side by side so the asymmetry is the point: a few lines declared,
                     all of that rendered. Stacks below the two-column breakpoint. -->
                <!-- Both blocks belong to the same pod: the file that declares it and the
                     policy it renders land together. They sit on that pod's side, matching
                     the diagram above — caller left, callee right. The other column stays
                     empty on purpose; the box above it already says why. -->
                <div class="yaml-pair" [class.owner-caller]="c.call?.enforcedAt === 'downstream'">
                  <div class="yaml-stack">
                    @if (c.yaml; as y) {
                      <div class="yaml-col">
                        <div class="yaml-h">what the team writes</div>
                        <pre><code [innerHTML]="yaml(y)"></code></pre>
                      </div>
                    }
                    @if (c.istio; as policy) {
                      <div class="yaml-col">
                        <div class="yaml-h">what the platform renders — istio</div>
                        <pre><code [innerHTML]="yaml(policy)"></code></pre>
                      </div>
                    }
                  </div>
                </div>
              </div>
            </ng-template>

            @if (!c.call) {
              <ng-container [ngTemplateOutlet]="detail" />
            }
            <!-- Only after the call lands. The panel explains what just happened, so
                 offering it beforehand asks a question the reader has not met yet. -->
            @if (c.call && results()[i].state === "done") {
              <button
                class="deep-toggle"
                [class.open]="isOpen(i)"
                (click)="togglePanel(i)"
                [attr.aria-expanded]="isOpen(i)"
              >
                <span class="sum-text">{{ detailPrompt(i) }}</span>
                <span class="sum-chev">›</span>
              </button>
            }
          </div>

          @if (c.call && isOpen(i)) {
            <div class="deep-panel">
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

  // Which deep panels are open. A <details> cannot do this — the trigger sits in the
  // card and the content spans both grid columns, so they are two separate elements.
  private readonly openPanels = signal<ReadonlySet<number>>(new Set())

  // Each on-platform app keeps one colour across every card so the reader tracks
  // actors by sight. Off-platform destinations share one muted colour — they are
  // scenery, not participants. Green and red stay reserved for call results.
  podClass(name: string): string {
    const known: Record<string, string> = {
      "authorized-api": "pod-authorized",
      "unauthorized-api": "pod-unauthorized",
      "upstream-api": "pod-callee",
      "api.open-meteo.com": "pod-metro",
      "example.com": "pod-example",
      "s3.amazonaws.com": "pod-s3",
      "dynamodb.amazonaws.com": "pod-dynamo",
    }
    return known[name] ?? "pod-site"
  }

  // Off-platform destinations are not all alike to the app: one is a website it calls
  // over HTTP, the other a cloud service it calls through an SDK. To the mesh they are
  // the same MESH_EXTERNAL entry, so the difference is named, never gated on.
  offPlatformKind(name: string): string {
    return name.endsWith("amazonaws.com") ? "cloud service" : "public site"
  }

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
  // the caller's own side never crossed the wire — drawing it arriving and bouncing
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
    if (/^\s*<(!doctype|html)/i.test(body)) return "(origin error page — no body from the app)"
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
      body = "no response — is the demo running?"
    }
    const ms = Math.round(performance.now() - started)
    clearInterval(tick)

    // These calls answer in well under 100ms, which is faster than the eye can follow.
    // Hold the in-flight animation to a visible floor while freezing the displayed
    // timing at what was actually measured — the number stays honest, the motion
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
