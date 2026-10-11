import { cn } from "@/lib/utils";

/**
 * Loaders for the long waits (a guide takes 10 to 30 s, a photo up to 40 s). Each one shows
 * what is happening, not just that something is. Pure SVG and CSS animations, so they stay
 * smooth while the page is busy. Under reduced motion they hold still, fully drawn.
 */

const LINES = [
  { y: 30, to: 66 },
  { y: 40, to: 74 },
  { y: 50, to: 60 },
  { y: 64, to: 70 },
  { y: 74, to: 52 },
];

/** A page writing itself, line by line, next to the manual and past fixes it is built from. */
export function DraftingLoader({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" fill="none" aria-hidden className={cn("h-24 w-auto", className)}>
      {/* Sources: a manual and a logbook, slightly behind */}
      <g className="text-fg-subtle" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <rect x="6" y="22" width="22" height="30" rx="3" className="fill-surface-2" />
        <path d="M11 30h12M11 36h9M11 42h12" strokeLinecap="round" opacity="0.7" />
        <rect x="8" y="58" width="20" height="26" rx="3" className="fill-surface-2" />
        <path d="M12 65h11M12 71h8M12 77h10" strokeLinecap="round" opacity="0.7" />
      </g>
      {/* Facts travelling from the sources into the guide */}
      {[0, 0.6, 1.2].map((delay, i) => (
        <circle
          key={i}
          cx="34"
          cy={i === 1 ? 70 : 38}
          r="1.8"
          className="fill-accent motion-reduce:hidden"
          style={{
            animation: `travel 1.8s var(--ease-in-out) ${delay}s infinite backwards`,
          }}
        />
      ))}
      {/* The guide */}
      <rect x="42" y="12" width="68" height="78" rx="6" className="fill-surface stroke-line-strong" strokeWidth="1.5" />
      <path d="M50 21h24" className="stroke-accent" strokeWidth="3" strokeLinecap="round" />
      {LINES.map((line, i) => (
        <g key={line.y}>
          <rect x="50" y={line.y - 3} width="6" height="6" rx="1.5" className="stroke-line-strong" strokeWidth="1.2" />
          <path
            d={`M60 ${line.y}H${line.to + 30}`}
            pathLength={1}
            strokeDasharray="1"
            className="stroke-fg-subtle"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ animation: `draw-line 3s var(--ease-out) ${i * 0.35}s infinite backwards` }}
          />
        </g>
      ))}
    </svg>
  );
}

/** A page with a band of light reading down it: for photos and PDFs being read. */
export function ScanningLoader({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={cn("size-4", className)}>
      <rect x="2.5" y="1.5" width="11" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 5h6M5 8h4.5M5 11h5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
      <rect
        x="1"
        y="2.5"
        width="14"
        height="1.6"
        rx="0.8"
        className="fill-accent"
        style={{ ["--scan-distance" as string]: "10px", animation: "scan-y 1.6s var(--ease-in-out) infinite" }}
      />
    </svg>
  );
}

/** The same letter cycling through English, Telugu and Hindi: for translation. */
export function TranslatingLoader({ className }: { className?: string }) {
  const glyphs = ["A", "అ", "अ"];
  return (
    <span aria-hidden className={cn("relative inline-grid size-4 place-items-center", className)}>
      <span className="absolute inset-0 rounded-[4px] shadow-[inset_0_0_0_1.4px_currentColor] opacity-60" />
      {glyphs.map((g, i) => (
        <span
          key={g}
          className={cn(
            "indic col-start-1 row-start-1 text-[10px] leading-none font-semibold",
            i > 0 && "motion-reduce:hidden",
          )}
          style={{ animation: `glyph-cycle 2.4s var(--ease-out) ${i * 0.8}s infinite backwards` }}
        >
          {g}
        </span>
      ))}
    </span>
  );
}
