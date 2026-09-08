import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from "@angular/core"
import { DomSanitizer, SafeHtml } from "@angular/platform-browser"
import { BOXES, PODS, SCENARIOS, ZONES, type Box, type Step } from "./topology-map"

interface Pt {
  x: number
  y: number
}
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const NS = "http://www.w3.org/2000/svg"

/** How long each hop holds the screen before the next one starts. */
const STEP_MS = 3800

const KIND_COLOR: Record<string, string> = {
  declared: "var(--topo-declared)",
  built: "var(--topo-built)",
  token: "var(--topo-token)",
  gate: "var(--topo-built)",
  external: "var(--color-text-muted)",
}
const KIND_FILL: Record<string, string> = {
  declared: "var(--topo-declared-soft)",
  built: "var(--topo-built-soft)",
  token: "var(--topo-token-soft)",
  gate: "var(--topo-built-soft)",
  external: "transparent",
}

// The map itself lives in topology-map.ts. This draws it, and traces one flow
// across it at a time. Boxes and zones are built once and only their emphasis
// moves, which is what lets an unused box fade rather than blink when the tab
// changes - and what keeps a 44-point polyline off the change detector.
@Component({
  selector: "app-topology",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="layer">
      <h2>The whole map</h2>
      <p>
        One topology, five things that happen on it. Nobody types a secret in any of them. Hover a
        numbered marker to re-read that hop, or click it to stop there.
      </p>
    </div>

    <section class="topo" id="topology">
      <nav class="topo-tabs" role="tablist" aria-label="Flow">
        @for (s of scenarios; track s.key; let i = $index) {
          <button type="button" role="tab" [attr.aria-selected]="si() === i" (click)="pick(i)">
            <span class="k">{{ "0" + (i + 1) }}</span
            >{{ s.name }}
          </button>
        }
      </nav>

      <div class="topo-stage" #stage>
        <svg
          #svg
          viewBox="0 0 1250 580"
          role="img"
          aria-label="Topology of the platform with the selected flow traced across it"
        ></svg>
        <div class="topo-readout" [class]="'kind-' + current().kind">
          <p class="topo-text">{{ current().text }}</p>
          <p class="topo-who" [innerHTML]="html(current().who)"></p>
          <div class="topo-claim-block">
            <p class="topo-kicker">{{ current().tokenName }}</p>
            <dl class="topo-claims">
              @for (c of current().claims; track $index) {
                <div class="topo-claim">
                  <dt>{{ c[0] }}</dt>
                  <dd [innerHTML]="html(c[1])"></dd>
                </div>
              }
            </dl>
          </div>
        </div>
        <div class="topo-tip" #tip hidden></div>
      </div>

      <div class="topo-controls">
        <button type="button" (click)="toggle()">{{ playLabel() }}</button>
        <button type="button" (click)="restart()">Restart</button>
        <div class="topo-bar"><span [style.width.%]="progress()"></span></div>
        <span class="topo-count">{{ step() + 1 }} / {{ scenario().steps.length }}</span>
      </div>

      <div class="topo-strip">
        <div class="topo-card">
          <h3>What the team wrote</h3>
          <pre class="topo-yaml"><code [innerHTML]="yaml()"></code></pre>
          <p class="topo-foot">Everything else on the map, <b>the platform built</b>.</p>
        </div>

        <div class="topo-card">
          <h3>The chain</h3>
          <ol class="topo-steps">
            @for (s of scenario().steps; track $index; let k = $index) {
              <li [attr.data-state]="k === step() ? 'active' : k < step() ? 'done' : 'todo'">
                <button type="button" (click)="jump(k)">
                  <span class="n">{{ k + 1 }}</span>
                  <span>{{ s.label || s.tokenName }}</span>
                </button>
              </li>
            }
          </ol>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        --topo-declared: #f59e0b;
        --topo-declared-soft: #2c2110;
        --topo-built: #03a9f4;
        --topo-built-soft: #0c2635;
        --topo-token: #a5b4fc;
        --topo-token-soft: #23253f;
        display: block;
      }

      .topo {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        margin-top: 1.25rem;
        overflow: hidden;
      }

      .topo-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        padding: 0.85rem 1rem 0.6rem;
      }
      .topo-tabs button {
        font: inherit;
        font-size: 0.78rem;
        font-weight: 500;
        cursor: pointer;
        color: var(--color-text-muted);
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        padding: 0.25rem 0.75rem;
        transition:
          color 0.15s,
          border-color 0.15s,
          background 0.15s;
      }
      .topo-tabs button:hover {
        color: var(--color-text);
        border-color: var(--color-text-muted);
      }
      .topo-tabs button[aria-selected="true"] {
        background: var(--color-text);
        color: var(--color-bg);
        border-color: var(--color-text);
      }
      .topo-tabs .k {
        font-family: var(--font-mono);
        font-size: 0.62rem;
        opacity: 0.6;
        margin-right: 0.4rem;
      }

      /* A percentage height only resolves against a parent that has one, so the
         stage carries the map's own ratio. Without it the readout's max-height
         is simply ignored and the panel grows over the boxes. */
      .topo-stage {
        position: relative;
        padding: 0 0.5rem;
        aspect-ratio: 1250 / 580;
      }
      svg {
        display: block;
        width: 100%;
        height: 100%;
      }

      /* Drawn in the SVG, so these are fills rather than colours. */
      :host ::ng-deep .topo-node {
        transition: opacity 0.5s ease;
      }
      :host ::ng-deep .topo-node rect {
        transition:
          fill 0.3s ease,
          stroke 0.3s ease,
          stroke-width 0.3s ease;
      }
      :host ::ng-deep .topo-chip {
        cursor: pointer;
      }
      :host ::ng-deep .n-label {
        font-family: var(--font-sans);
        font-weight: 700;
        font-size: 14px;
        fill: var(--color-text);
      }
      :host ::ng-deep .n-sub {
        font-family: var(--font-mono);
        font-size: 10.5px;
        fill: var(--color-text-muted);
      }
      :host ::ng-deep .n-zone {
        font-family: var(--font-mono);
        font-size: 10.5px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        fill: var(--color-text-muted);
      }
      :host ::ng-deep .n-pod {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        fill: var(--color-text-muted);
      }
      :host ::ng-deep .n-edge {
        font-family: var(--font-mono);
        font-size: 11.5px;
        font-weight: 500;
        paint-order: stroke;
        stroke: var(--color-surface);
        stroke-width: 4.5px;
        stroke-linejoin: round;
      }
      :host ::ng-deep .n-chip {
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 600;
        fill: var(--color-surface);
      }
      @keyframes topoflow {
        to {
          stroke-dashoffset: -32;
        }
      }
      :host ::ng-deep .topo-live {
        animation: topoflow 0.75s linear infinite;
      }

      .topo-tip {
        position: absolute;
        width: 17rem;
        z-index: 2;
        pointer-events: none;
        background: var(--color-surface-alt);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 0.5rem 0.65rem 0.55rem;
        font-size: 0.72rem;
        line-height: 1.45;
        box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 45%);
      }
      .topo-tip b {
        display: block;
        font-size: 0.62rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin-bottom: 0.25rem;
      }

      .topo-controls {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.4rem 1rem 0.85rem;
      }
      .topo-controls button {
        font: inherit;
        font-size: 0.75rem;
        font-weight: 500;
        cursor: pointer;
        background: var(--color-surface-alt);
        border: 1px solid var(--color-border);
        color: var(--color-text);
        border-radius: var(--radius-sm);
        padding: 0.2rem 0.6rem;
      }
      .topo-controls button:hover {
        border-color: var(--color-text-muted);
      }
      .topo-bar {
        flex: 1;
        height: 2px;
        background: var(--color-border);
        border-radius: 2px;
        overflow: hidden;
      }
      .topo-bar span {
        display: block;
        height: 100%;
        background: var(--topo-token);
      }
      .topo-count {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        color: var(--color-text-muted);
        font-variant-numeric: tabular-nums;
      }

      .topo-strip {
        display: grid;
        grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
        gap: 1px;
        background: var(--color-border);
        border-top: 1px solid var(--color-border);
      }
      @media (max-width: 900px) {
        .topo-strip {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .topo-card {
        background: var(--color-surface);
        padding: 0.75rem 0.9rem 0.85rem;
      }
      .topo-card h3 {
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin: 0 0 0.5rem;
      }
      .topo-yaml {
        margin: 0;
        overflow-x: auto;
        font-family: var(--font-mono);
        font-size: 0.66rem;
        line-height: 1.7;
      }
      .topo-yaml .d {
        color: var(--topo-declared);
        font-weight: 600;
      }
      .topo-yaml .c {
        color: var(--color-text-muted);
      }
      .topo-foot {
        margin: 0.6rem 0 0;
        font-size: 0.68rem;
        color: var(--color-text-muted);
      }
      .topo-foot b {
        color: var(--topo-built);
        font-weight: 600;
      }

      .topo-steps {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .topo-steps button {
        width: 100%;
        text-align: left;
        font: inherit;
        font-size: 0.7rem;
        cursor: pointer;
        background: none;
        border: 0;
        border-radius: var(--radius-sm);
        padding: 0.25rem 0.4rem;
        display: grid;
        grid-template-columns: 1rem 1fr;
        gap: 0.4rem;
        color: var(--color-text-muted);
        line-height: 1.35;
      }
      .topo-steps button:hover {
        background: var(--color-surface-alt);
        color: var(--color-text);
      }
      .topo-steps .n {
        font-family: var(--font-mono);
        font-size: 0.6rem;
        font-variant-numeric: tabular-nums;
      }
      .topo-steps li[data-state="done"] button {
        color: var(--color-text);
        opacity: 0.55;
      }
      .topo-steps li[data-state="active"] button {
        background: var(--color-surface-alt);
        color: var(--color-text);
        font-weight: 500;
      }
      .topo-steps li[data-state="active"] .n {
        color: var(--topo-token);
      }

      /* The map's bottom-right corner is empty on every flow, so the words and
         the thing they describe stay in one glance. */
      .topo-readout {
        position: absolute;
        right: 1.4%;
        bottom: 2.5%;
        width: 30%;
        min-width: 14rem;
        z-index: 1;
        background: var(--color-surface-alt);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 0.5rem 0.6rem 0.55rem;
      }
      .topo-claim-block {
        margin-top: 0.45rem;
        padding-top: 0.4rem;
        border-top: 1px solid var(--color-border);
      }
      @media (max-width: 980px) {
        .topo-readout {
          position: static;
          width: auto;
          margin-top: 0.75rem;
        }
      }
      .topo-kicker {
        font-size: 0.56rem;
        font-weight: 700;
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin: 0 0 0.4rem;
      }
      .topo-text {
        margin: 0;
        font-size: 0.64rem;
        line-height: 1.42;
      }
      .topo-who {
        margin: 0.3rem 0 0;
        font-size: 0.6rem;
        color: var(--color-text-muted);
      }
      .topo-who b {
        font-weight: 600;
      }
      .kind-declared .topo-who b {
        color: var(--topo-declared);
      }
      .kind-built .topo-who b,
      .kind-gate .topo-who b {
        color: var(--topo-built);
      }
      .kind-token .topo-who b {
        color: var(--topo-token);
      }

      .topo-claims {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.12rem;
      }
      .topo-claim {
        display: grid;
        grid-template-columns: 5rem 1fr;
        gap: 0.5rem;
        align-items: baseline;
        font-family: var(--font-mono);
        font-size: 0.56rem;
      }
      .topo-claim dt {
        color: var(--color-text-muted);
      }
      .topo-claim dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .topo-claim dd em {
        font-style: normal;
        background: var(--topo-token-soft);
        color: var(--topo-token);
        padding: 0 0.25rem;
        border-radius: 3px;
      }

      @media (prefers-reduced-motion: reduce) {
        :host ::ng-deep *,
        .topo * {
          animation: none !important;
          transition: none !important;
        }
      }
    `,
  ],
})
export class Topology implements AfterViewInit, OnDestroy {
  protected readonly scenarios = SCENARIOS
  protected readonly si = signal(0)
  protected readonly step = signal(0)
  protected readonly playing = signal(true)
  protected readonly progress = signal(0)

  protected readonly scenario = computed(() => SCENARIOS[this.si()])
  protected readonly current = computed(() => this.scenario().steps[this.step()])
  protected readonly playLabel = computed(() =>
    this.playing() ? "Pause" : this.step() === this.scenario().steps.length - 1 ? "Replay" : "Play",
  )
  protected readonly yaml = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      this.scenario()
        .yaml.map(([text, cls]) =>
          text
            ? `<span class="${cls}">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`
            : "",
        )
        .join("\n"),
    ),
  )

  private readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>("svg")
  private readonly stageRef = viewChild.required<ElementRef<HTMLElement>>("stage")
  private readonly tipRef = viewChild.required<ElementRef<HTMLElement>>("tip")

  private readonly zone = inject(NgZone)
  private readonly sanitizer = inject(DomSanitizer)

  private readonly layers = {
    map: document.createElementNS(NS, "g"),
    wire: document.createElementNS(NS, "g"),
    box: document.createElementNS(NS, "g"),
    chip: document.createElementNS(NS, "g"),
  }
  private readonly boxEls: Record<string, { g: SVGGElement; rect: SVGRectElement }> = {}
  private raf = 0
  private startedAt = 0
  private ready = false
  private visible = false
  private observer?: IntersectionObserver
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)").matches

  constructor() {
    effect(() => {
      this.si()
      this.step()
      if (this.ready) this.draw()
    })
  }

  ngAfterViewInit(): void {
    this.buildMap()
    this.ready = true
    this.draw()
    this.startedAt = performance.now()
    // The map sits well down the page. Starting the walkthrough on load means it
    // has already finished by the time anyone scrolls to it, so it waits here.
    this.observer = new IntersectionObserver(
      (entries) => {
        this.visible = entries[0].isIntersecting
      },
      { threshold: 0.35 },
    )
    this.observer.observe(this.stageRef().nativeElement)
    this.zone.runOutsideAngular(() => {
      this.raf = requestAnimationFrame((t) => this.frame(t))
    })
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf)
    this.observer?.disconnect()
  }

  protected html(value: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(value)
  }

  protected pick(i: number): void {
    this.si.set(i)
    this.step.set(0)
    this.startedAt = performance.now()
  }

  protected jump(k: number): void {
    this.step.set(k)
    this.playing.set(false)
  }

  protected toggle(): void {
    if (!this.playing() && this.step() === this.scenario().steps.length - 1) this.step.set(0)
    this.playing.update((p) => !p)
    if (this.playing()) this.startedAt = performance.now()
  }

  protected restart(): void {
    this.step.set(0)
    this.playing.set(true)
    this.startedAt = performance.now()
  }

  // ── geometry ───────────────────────────────────────────────────────────

  private el<K extends keyof SVGElementTagNameMap>(
    name: K,
    attrs: Record<string, string | number>,
    text?: string,
  ): SVGElementTagNameMap[K] {
    const n = document.createElementNS(NS, name)
    for (const k in attrs) n.setAttribute(k, String(attrs[k]))
    if (text != null) n.textContent = text
    return n
  }

  private centre(r: Rect): Pt {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
  }

  private qd(p0: Pt, c: Pt, p2: Pt, t: number): Pt {
    const m = 1 - t
    return {
      x: m * m * p0.x + 2 * m * t * c.x + t * t * p2.x,
      y: m * m * p0.y + 2 * m * t * c.y + t * t * p2.y,
    }
  }

  private inside(x: number, y: number, r: Rect, pad: number): boolean {
    return x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad
  }

  private overlap(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  }

  /** Boxes to route around, plus the strips holding the zone and pod titles. */
  private walls(from: string, to: string): Rect[] {
    const w: Rect[] = []
    for (const id in BOXES) if (id !== from && id !== to) w.push(BOXES[id])
    for (const z in ZONES) w.push({ x: ZONES[z].x, y: ZONES[z].y, w: 150, h: 26 })
    for (const p in PODS) w.push({ x: PODS[p].x, y: PODS[p].y, w: PODS[p].w, h: 24 })
    return w
  }

  // Every arrow finds its own way round the boxes, so no route is hand-tuned.
  // The curve runs centre to centre and is then clipped to where it actually
  // leaves one box and enters the other. Clipping the straight line instead
  // leaves a head sitting alongside its target rather than facing it.
  private route(st: Step, reversed: boolean): Pt[] {
    const a = BOXES[st.from]
    const b = BOXES[st.to]
    const ca = this.centre(a)
    const cb = this.centre(b)
    const dx = cb.x - ca.x
    const dy = cb.y - ca.y
    const len = Math.hypot(dx, dy) || 1
    const px = -dy / len
    const py = dx / len
    const walls = this.walls(st.from, st.to)
    // A pair drawn in both directions always bows the same sign, which puts the
    // two arcs on opposite sides because the perpendicular flips with them.
    const opts = reversed
      ? [38, 66, 100, 140, 185]
      : [0, 40, -40, 72, -72, 108, -108, 150, -150, 200, -200]

    let best: { pts: Pt[]; score: number } | null = null
    for (const bow of opts) {
      const c = { x: (ca.x + cb.x) / 2 + px * bow * 2, y: (ca.y + cb.y) / 2 + py * bow * 2 }
      let t0 = 0
      let t1 = 1
      for (let t = 0; t <= 1; t += 0.004) {
        const q = this.qd(ca, c, cb, t)
        if (!this.inside(q.x, q.y, a, 5)) {
          t0 = t
          break
        }
      }
      for (let t = 1; t >= 0; t -= 0.004) {
        const q = this.qd(ca, c, cb, t)
        if (!this.inside(q.x, q.y, b, 7)) {
          t1 = t
          break
        }
      }
      if (t1 <= t0 + 0.03) continue

      const n = 44
      const pts: Pt[] = []
      for (let k = 0; k <= n; k++) pts.push(this.qd(ca, c, cb, t0 + (t1 - t0) * (k / n)))

      let hits = 0
      for (let j = 2; j < pts.length - 2; j++) {
        for (const w of walls) {
          if (this.inside(pts[j].x, pts[j].y, w, 5)) {
            hits++
            break
          }
        }
      }
      // How squarely the head faces its target, so an arrow never skims an edge.
      const e = pts[pts.length - 1]
      const e2 = pts[pts.length - 2]
      const tx = e.x - e2.x
      const ty = e.y - e2.y
      const tl = Math.hypot(tx, ty) || 1
      const gx = cb.x - e.x
      const gy = cb.y - e.y
      const gl = Math.hypot(gx, gy) || 1
      const aim = (tx / tl) * (gx / gl) + (ty / tl) * (gy / gl)
      const score = hits * 40 + (1 - aim) * 90

      if (!best || score < best.score) best = { pts, score }
      if (hits === 0 && aim > 0.94) break
    }
    return best ? best.pts : [ca, cb]
  }

  // ── drawing ────────────────────────────────────────────────────────────

  private buildMap(): void {
    const svg = this.svgRef().nativeElement
    for (const g of [this.layers.map, this.layers.wire, this.layers.box, this.layers.chip]) {
      svg.appendChild(g)
    }
    for (const id in ZONES) {
      const z = ZONES[id]
      this.layers.map.appendChild(
        this.el("rect", {
          x: z.x,
          y: z.y,
          width: z.w,
          height: z.h,
          rx: 14,
          fill: "var(--color-bg)",
          stroke: "var(--color-border)",
          "stroke-width": 1,
        }),
      )
      this.layers.map.appendChild(
        this.el("text", { x: z.x + 16, y: z.y + 22, class: "n-zone" }, z.label),
      )
    }
    for (const id in PODS) {
      const p = PODS[id]
      this.layers.map.appendChild(
        this.el("rect", {
          x: p.x,
          y: p.y,
          width: p.w,
          height: p.h,
          rx: 11,
          fill: "var(--color-surface)",
          stroke: "var(--color-border)",
          "stroke-width": 1.5,
          "stroke-dasharray": "2 5",
        }),
      )
      this.layers.map.appendChild(
        this.el("text", { x: p.x + 12, y: p.y + 20, class: "n-pod" }, p.label),
      )
    }
    for (const id in BOXES) {
      const n: Box = BOXES[id]
      const g = this.el("g", { class: "topo-node" })
      const rect = this.el("rect", {
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        rx: 8,
        fill: "var(--color-surface)",
        stroke: "var(--color-border)",
        "stroke-width": 1.2,
        "stroke-dasharray": n.kind === "external" ? "4 3" : "none",
      })
      g.appendChild(rect)
      g.appendChild(this.el("text", { x: n.x + 12, y: n.y + 19, class: "n-label" }, n.label))
      if (n.sub) g.appendChild(this.el("text", { x: n.x + 12, y: n.y + 34, class: "n-sub" }, n.sub))
      this.layers.box.appendChild(g)
      this.boxEls[id] = { g, rect }
    }
  }

  private head(g: SVGGElement, pts: Pt[], color: string, opacity: number): void {
    const e = pts[pts.length - 1]
    const b = pts[pts.length - 2]
    const ang = (Math.atan2(e.y - b.y, e.x - b.x) * 180) / Math.PI
    g.appendChild(
      this.el("polygon", {
        points: "-11,-4.2 0,0 -11,4.2",
        fill: color,
        opacity,
        transform: `translate(${e.x},${e.y}) rotate(${ang})`,
      }),
    )
  }

  private label(g: SVGGElement, st: Step, pts: Pt[], placed: Rect[], chip: Pt): void {
    if (!st.label) return
    const w = st.label.length * 6.6 + 8
    const h = 13
    // A path has to touch its own endpoints; its label does not, and letting it
    // sit on them puts the text straight across two boxes.
    const walls = this.walls("", "")
    walls.push({ x: chip.x - 13, y: chip.y - 13, w: 26, h: 26 })

    const tries: [number, number][] = []
    for (const f of [0.5, 0.38, 0.62, 0.3]) {
      for (const d of [16, -16, 30, -30, 46, -46, 66, -66, 88, -88]) tries.push([f, d])
    }
    let pick: { x: number; y: number; box: Rect; bad: number } | null = null
    for (const [f, d] of tries) {
      const idx = Math.max(1, Math.min(pts.length - 2, Math.round(f * (pts.length - 1))))
      const p = pts[idx]
      const tx = pts[idx + 1].x - pts[idx - 1].x
      const ty = pts[idx + 1].y - pts[idx - 1].y
      const tl = Math.hypot(tx, ty) || 1
      const x = p.x + (-ty / tl) * d
      const y = p.y + (tx / tl) * d
      const box = { x: x - w / 2, y: y - h / 2, w, h }
      let bad = 0
      for (const wall of walls) {
        if (this.overlap(box, wall)) {
          bad++
          break
        }
      }
      for (const done of placed) {
        if (this.overlap(box, done)) {
          bad++
          break
        }
      }
      if (!pick || bad < pick.bad) pick = { x, y, box, bad }
      if (bad === 0) break
    }
    if (!pick) return
    placed.push(pick.box)
    g.appendChild(
      this.el(
        "text",
        {
          x: pick.x,
          y: pick.y + 4,
          "text-anchor": "middle",
          class: "n-edge",
          fill: KIND_COLOR[st.kind] ?? "var(--color-text)",
        },
        st.label,
      ),
    )
  }

  private hoverable(g: SVGGElement, st: Step, k: number): void {
    g.setAttribute("class", "topo-chip")
    g.addEventListener("mouseenter", () => {
      const tip = this.tipRef().nativeElement
      tip.textContent = ""
      const b = document.createElement("b")
      b.textContent = `${k + 1} · ${st.label || st.tokenName}`
      tip.append(b, document.createTextNode(st.text))
      tip.hidden = false
      const cr = g.getBoundingClientRect()
      const sr = this.stageRef().nativeElement.getBoundingClientRect()
      const x = cr.left - sr.left + cr.width / 2 - tip.offsetWidth / 2
      const y = cr.top - sr.top - tip.offsetHeight - 12
      tip.style.left = `${Math.max(6, Math.min(sr.width - tip.offsetWidth - 6, x))}px`
      tip.style.top = `${y < 4 ? cr.bottom - sr.top + 12 : y}px`
    })
    g.addEventListener("mouseleave", () => {
      this.tipRef().nativeElement.hidden = true
    })
    g.addEventListener("click", () => this.zone.run(() => this.jump(k)))
  }

  private draw(): void {
    const scenario = this.scenario()
    const cur = scenario.steps[this.step()]
    const used: Record<string, true> = {}
    for (const st of scenario.steps) {
      used[st.from] = true
      used[st.to] = true
    }

    for (const id in BOXES) {
      const n = BOXES[id]
      const live = id === cur.from || id === cur.to
      const b = this.boxEls[id]
      b.g.setAttribute("opacity", String(live ? 1 : used[id] ? 0.66 : 0.14))
      b.rect.setAttribute("fill", live ? KIND_FILL[n.kind] : "var(--color-surface)")
      b.rect.setAttribute("stroke", live ? KIND_COLOR[n.kind] : "var(--color-border)")
      b.rect.setAttribute("stroke-width", live ? "2" : "1.2")
    }

    this.layers.wire.textContent = ""
    this.layers.chip.textContent = ""
    this.tipRef().nativeElement.hidden = true

    const seen: Record<string, true> = {}
    for (const st of scenario.steps) if (st.from !== st.to) seen[`${st.from}>${st.to}`] = true
    const placed: Rect[] = []

    scenario.steps.forEach((st, k) => {
      if (k > this.step() || st.from === st.to) return
      const active = k === this.step()
      const pts = this.route(st, !!seen[`${st.to}>${st.from}`])
      let d = `M${pts[0].x} ${pts[0].y}`
      for (let q = 1; q < pts.length; q++) d += ` L${pts[q].x} ${pts[q].y}`
      const color = active
        ? (KIND_COLOR[st.kind] ?? "var(--color-text-muted)")
        : "var(--color-text-muted)"
      const path = this.el("path", {
        d,
        fill: "none",
        stroke: color,
        "stroke-width": active ? 3 : 1.5,
        "stroke-linecap": "butt",
        "stroke-dasharray": active ? (st.dashed ? "4 5" : "9 7") : st.dashed ? "5 4" : "none",
        opacity: active ? 1 : 0.32,
      })
      if (active) {
        path.id = "topo-live"
        path.setAttribute("class", "topo-live")
      }
      this.layers.wire.appendChild(path)
      this.head(this.layers.chip, pts, color, active ? 1 : 0.32)

      const im = Math.floor(pts.length / 2)
      const mp = pts[im]
      const b0 = pts[im - 1] ?? pts[0]
      const b1 = pts[im + 1] ?? pts[pts.length - 1]
      const mtx = b1.x - b0.x
      const mty = b1.y - b0.y
      const mtl = Math.hypot(mtx, mty) || 1
      const mid = { x: mp.x + (-mty / mtl) * 13, y: mp.y + (mtx / mtl) * 13 }

      const chip = this.el("g", { opacity: active ? 1 : 0.4 })
      chip.appendChild(
        this.el("circle", {
          cx: mid.x,
          cy: mid.y,
          r: active ? 9.5 : 8,
          fill: color,
          stroke: "var(--color-surface)",
          "stroke-width": 2,
        }),
      )
      chip.appendChild(
        this.el(
          "text",
          { x: mid.x, y: mid.y + 3.8, "text-anchor": "middle", class: "n-chip" },
          String(k + 1),
        ),
      )
      this.hoverable(chip, st, k)
      this.layers.chip.appendChild(chip)
      if (active) this.label(this.layers.chip, st, pts, placed, mid)
    })

    // A step that stays inside one box gets its marker on the box itself.
    if (cur.from === cur.to) {
      const n = BOXES[cur.from]
      const g = this.el("g", {})
      g.appendChild(
        this.el("circle", {
          id: "topo-dot",
          cx: n.x + n.w - 14,
          cy: n.y + 14,
          r: 9.5,
          fill: KIND_COLOR[cur.kind],
          stroke: "var(--color-surface)",
          "stroke-width": 2,
        }),
      )
      g.appendChild(
        this.el(
          "text",
          { x: n.x + n.w - 14, y: n.y + 17.8, "text-anchor": "middle", class: "n-chip" },
          String(this.step() + 1),
        ),
      )
      this.hoverable(g, cur, this.step())
      this.layers.chip.appendChild(g)
      if (cur.label) {
        this.layers.chip.appendChild(
          this.el(
            "text",
            {
              x: n.x + n.w / 2,
              y: n.y - 10,
              "text-anchor": "middle",
              class: "n-edge",
              fill: KIND_COLOR[cur.kind],
            },
            cur.label,
          ),
        )
      }
    } else {
      const live = this.svgRef().nativeElement.querySelector<SVGPathElement>("#topo-live")
      if (live) {
        const p0 = live.getPointAtLength(0)
        this.layers.chip.appendChild(
          this.el("circle", {
            id: "topo-dot",
            cx: p0.x,
            cy: p0.y,
            r: 5.5,
            fill: KIND_COLOR[cur.kind] ?? "var(--topo-token)",
            stroke: "var(--color-surface)",
            "stroke-width": 2,
          }),
        )
      }
    }
  }

  // Runs outside Angular: every frame moves one circle, and only a step change
  // is worth a round of change detection.
  private frame(now: number): void {
    // Off screen the clock is held rather than advanced, so scrolling back finds
    // the flow where it was left instead of finished.
    if (!this.visible) {
      this.startedAt = now
      this.raf = requestAnimationFrame((t) => this.frame(t))
      return
    }
    const steps = this.scenario().steps
    const cur = steps[this.step()]
    const f = Math.min((now - this.startedAt) / STEP_MS, 1)
    if (this.playing()) this.progress.set(f * 100)

    const svg = this.svgRef().nativeElement
    const dot = svg.querySelector<SVGCircleElement>("#topo-dot")
    const live = svg.querySelector<SVGPathElement>("#topo-live")
    if (this.playing() && dot && live && cur.from !== cur.to && !this.reduced) {
      const e = Math.min(f / 0.7, 1)
      const eased = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2
      const pt = live.getPointAtLength(live.getTotalLength() * eased)
      dot.setAttribute("cx", String(pt.x))
      dot.setAttribute("cy", String(pt.y))
      dot.setAttribute("opacity", e >= 1 ? "0" : "1")
    }

    if (this.playing() && f >= 1) {
      this.zone.run(() => {
        if (this.step() < steps.length - 1) {
          this.step.update((s) => s + 1)
          this.startedAt = now
        } else {
          this.playing.set(false)
          this.progress.set(100)
        }
      })
    }
    this.raf = requestAnimationFrame((t) => this.frame(t))
  }
}
