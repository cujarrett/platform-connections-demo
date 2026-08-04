import { ChangeDetectionStrategy, Component, input } from "@angular/core"

// The brand mark — brackets holding an ascending arrow. Sized by the parent
// through --mark-size so callers never touch the geometry.
// Kept in step with launchpad/src/app/core/launchpad-mark.ts. Copied rather than
// shared: two standalone repos with no package between them, and the geometry is
// twelve numbers that have not moved since the mark was drawn.
@Component({
  selector: "app-launchpad-mark",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 80 64" role="img" aria-label="Launchpad" [class.animate]="animate()">
      <g class="bracket">
        <path d="M27 10 H14 V54 H27" />
        <path d="M53 10 H66 V54 H53" />
      </g>
      <g class="arrow">
        <path d="M40 16.5 L53.5 32 H26.5 Z" />
        <rect x="35.5" y="29" width="9" height="22" rx="4.5" />
      </g>
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        line-height: 0;
      }
      svg {
        width: var(--mark-size, 2.25rem);
        height: auto;
      }
      .bracket path {
        fill: none;
        stroke: var(--mark-bracket, var(--color-accent));
        stroke-width: 6;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      /* Filled, not stroked — round linejoins on a short chevron blob out into a
         mushroom once the mark is rendered large. */
      .arrow {
        fill: var(--mark-arrow, #c7d2fe);
      }

      /* Brackets draw themselves, then the payload lifts into the gap. */
      .animate .bracket path {
        stroke-dasharray: 120;
        animation: mark-draw 0.55s cubic-bezier(0.4, 0, 0.2, 1) both;
      }
      .animate .bracket path:last-child {
        animation-delay: 0.08s;
      }
      .animate .arrow {
        animation: mark-rise 0.5s cubic-bezier(0.34, 1.3, 0.64, 1) 0.4s both;
      }
      @keyframes mark-draw {
        from {
          stroke-dashoffset: 120;
        }
        to {
          stroke-dashoffset: 0;
        }
      }
      @keyframes mark-rise {
        from {
          transform: translateY(14px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .animate .bracket path,
        .animate .arrow {
          animation: none;
          stroke-dashoffset: 0;
          opacity: 1;
          transform: none;
        }
      }
    `,
  ],
})
export class LaunchpadMark {
  readonly animate = input(false)
}
