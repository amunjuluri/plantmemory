"use client";

import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { create } from "zustand";

import { LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Set once the tour is finished or skipped, so it starts on the first visit only. */
const SEEN_KEY = "plantmemory-tour";

type Step = {
  id: string;
  /** `data-tour` value of the element to point at; none for the welcome card. */
  target?: string;
  /** The element is on the Breakdown page. */
  home?: boolean;
  side?: "top" | "bottom";
  title: string;
  body: ReactNode;
  /** The manager does this step: clicking the element moves the tour on. */
  doIt?: string;
};

const STATS = [
  { value: "~20 s", label: "to a cited guide" },
  { value: "0", label: "made-up part numbers" },
  { value: "12", label: "languages to print" },
];

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome to PlantMemory",
    body: (
      <>
        <p>
          When a machine stops, the line waits for you. PlantMemory turns the breakdown into an approved repair sheet
          your workers can follow, in their language.
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-1.5">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-lg bg-surface-2 px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <dt className="sr-only">{s.label}</dt>
              <dd className="tabular text-base leading-5 font-semibold text-fg">{s.value}</dd>
              <dd className="mt-0.5 text-[0.6875rem] leading-4">{s.label}</dd>
            </div>
          ))}
        </dl>
      </>
    ),
  },
  {
    id: "report",
    target: "report",
    home: true,
    title: "Describe the breakdown",
    body: "Machine, alarm code, what the worker saw. Any language; short forms are fine.",
  },
  {
    id: "speak",
    target: "speak",
    home: true,
    title: "Or just say it",
    body: "Speak Telugu, Hindi or English. It asks only for what’s missing and answers in your language. A logbook photo or alarm log works too.",
  },
  {
    id: "examples",
    target: "examples",
    home: true,
    side: "top",
    title: "Try one now",
    body: "Tap “TP-02 punch tight” to fill in a sample report.",
    doIt: "Tap an example to continue",
  },
  {
    id: "draft",
    target: "draft",
    home: true,
    title: "Draft the repair guide",
    body: "In about 20 seconds: the manual’s steps, what fixed it last time, parts in stock and the time it takes. Every line cites its source.",
    doIt: "Tap it to draft one, or press Next",
  },
  {
    id: "guides",
    target: "nav-guides",
    title: "Approve, then print",
    body: "You approve; QA checks only what code flags. Print an A4 copy in English plus any of 12 Indian languages for the floor.",
  },
  {
    id: "memory",
    target: "nav-memory",
    title: "Close it, and the plant remembers",
    body: "After the repair, say what was done. Next time it breaks, that fix comes up first, so no fix is lost between shifts.",
  },
  {
    id: "actor",
    target: "actor",
    title: "You’re the manager",
    body: "No sign-in in this demo. Switch to QA here to review and release a guide.",
  },
];

type TourState = { step: number | null; start: () => void; go: (step: number) => void; end: () => void };

export const useTour = create<TourState>((set) => ({
  step: null,
  start: () => set({ step: 0 }),
  go: (step) => set({ step: Math.max(0, Math.min(STEPS.length - 1, step)) }),
  end: () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Private mode: the tour starts again next visit, which is harmless.
    }
    set({ step: null });
  },
}));

type Box = { x: number; y: number; w: number; h: number };

/** The visible element for a step: the header nav on a laptop, the tab bar on a phone. */
function findTarget(id: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Scrolls the element into the part of the screen not under the header or tab bar. */
function reveal(el: HTMLElement) {
  if (getComputedStyle(el).position === "fixed" || el.closest("header, nav")) return;
  const r = el.getBoundingClientRect();
  const bottom = window.innerHeight - (window.innerWidth < 768 ? 88 : 24);
  if (r.top < 72 || r.bottom > bottom) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

const PAD = 6; // room around the element inside the spotlight
const GAP = 14; // spotlight to popup, room for the arrow
const EDGE = 12; // popup to screen edge

/**
 * The product tour: the screen dims, the real control stays lit and usable, and a small
 * popup beside it says what it does, with Next and Skip. Starts on the first visit;
 * the header's help button starts it again.
 */
export function Tour() {
  const { step, start, go, end } = useTour();
  const pathname = usePathname();
  const router = useRouter();
  const [hole, setHole] = useState<Box | null>(null);
  const [screen, setScreen] = useState({ w: 0, h: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [leaving, setLeaving] = useState(false);
  // Placed once: from then on the popup glides between elements instead of jumping.
  const [settled, setSettled] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const current = step === null ? null : STEPS[step];
  const last = step === STEPS.length - 1;

  // First visit only, and never over the print page (it may be open on a shop-floor PC).
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // No storage: don't nag every visit.
    }
    if (seen || window.location.pathname.startsWith("/guides/print")) return;
    const timer = setTimeout(start, 700);
    return () => clearTimeout(timer);
  }, [start]);

  // Steps on the Breakdown page take the manager there.
  useEffect(() => {
    if (current?.home && pathname !== "/") router.push("/");
  }, [current, pathname, router]);

  // Follow the element every frame while the tour is open: it may scroll, resize or
  // appear late (after navigating), and the spotlight should stay glued to it.
  useEffect(() => {
    if (!current) return;
    let frame = 0;
    let el: HTMLElement | null = null;
    let revealed = false;
    const tick = () => {
      if (current.target && (!el || !el.isConnected)) el = findTarget(current.target);
      if (el && !revealed) {
        revealed = true;
        reveal(el);
      }
      const r = el?.getBoundingClientRect();
      const box = r && r.width ? { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 } : null;
      setHole((prev) => (sameBox(prev, box) ? prev : box));
      setScreen((prev) =>
        prev.w === window.innerWidth && prev.h === window.innerHeight
          ? prev
          : { w: window.innerWidth, h: window.innerHeight },
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [current]);

  useLayoutEffect(() => {
    const el = pop.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [step === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep focus in the popup so Enter and Escape work straight away.
  useEffect(() => {
    if (step !== null) next.current?.focus({ preventScroll: true });
  }, [step]);

  const finish = () => {
    setLeaving(true);
    setTimeout(() => {
      end();
      setLeaving(false);
      setSettled(false);
    }, 160);
  };
  const forward = () => (last ? finish() : go((step ?? 0) + 1));

  // Doing the step (tapping an example, drafting) moves the tour on.
  useEffect(() => {
    if (!current?.doIt || !current.target || step === null) return;
    const target = current.target;
    const onClick = (e: MouseEvent) => {
      const el = findTarget(target);
      const hit = e.target instanceof Element ? e.target.closest("button, a") : null;
      if (el && hit && el.contains(hit) && !hit.matches(":disabled")) setTimeout(() => go(step + 1), 300);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [current, step, go]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if (e.key === "Escape") finish();
      else if (!typing && e.key === "ArrowRight") forward();
      else if (!typing && e.key === "ArrowLeft") go(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const measured = size.h > 0 && screen.w > 0;
  useEffect(() => {
    if (!measured || settled) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [measured, settled]);

  if (!current) return null;

  // Place the popup under the element, or above when there's no room (the tab bar).
  let side: "top" | "bottom" | "center" = "center";
  let left = (screen.w - size.w) / 2;
  let top = (screen.h - size.h) / 2;
  let arrow = size.w / 2;
  if (hole) {
    const below = screen.h - (hole.y + hole.h) - GAP - EDGE;
    const above = hole.y - GAP - EDGE;
    side = current.side ?? "bottom";
    if (side === "bottom" && below < size.h && above > below) side = "top";
    if (side === "top" && above < size.h && below > above) side = "bottom";
    top = side === "bottom" ? hole.y + hole.h + GAP : hole.y - GAP - size.h;
    top = Math.max(EDGE, Math.min(top, screen.h - size.h - EDGE));
    const centre = hole.x + hole.w / 2;
    left = Math.max(EDGE, Math.min(centre - size.w / 2, screen.w - size.w - EDGE));
    arrow = Math.max(20, Math.min(centre - left, size.w - 20));
  }

  // With no element (the welcome card) the spotlight shrinks to the middle of the screen,
  // so the first step opens out of it.
  const spot = hole ?? { x: screen.w / 2, y: screen.h / 2, w: 0, h: 0 };
  const blockers: CSSProperties[] = hole
    ? [
        { left: 0, top: 0, right: 0, height: Math.max(0, hole.y) },
        { left: 0, top: hole.y + hole.h, right: 0, bottom: 0 },
        { left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.h },
        { left: hole.x + hole.w, top: hole.y, right: 0, height: hole.h },
      ]
    : [{ inset: 0 }];

  return (
    <div
      className={cn(
        "print:hidden",
        "transition-opacity duration-150 ease-out",
        leaving ? "opacity-0" : "opacity-100 starting:opacity-0",
      )}
    >
      {/* Clicks outside the lit element are held, so the tour can't be lost mid-way. */}
      {blockers.map((style, i) => (
        <div key={i} aria-hidden className="fixed z-[70]" style={style} />
      ))}
      <div
        aria-hidden
        className={cn("tour-spot pointer-events-none fixed top-0 left-0 z-[70] rounded-xl", current.doIt && hole && "tour-spot-do")}
        style={{ width: spot.w, height: spot.h, transform: `translate(${spot.x}px, ${spot.y}px)` }}
      />

      <div
        ref={pop}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-settled={settled ? "" : undefined}
        className={cn(
          "tour-pop fixed top-0 left-0 z-[71] w-[min(21rem,calc(100vw-1.5rem))] rounded-2xl bg-surface text-fg shadow-raised outline-none",
          !measured && "scale-[0.96] opacity-0",
        )}
        style={{
          transform: `translate(${Math.round(left)}px, ${Math.round(top)}px)`,
          // Grows out of the arrow, toward the element it points at.
          transformOrigin: side === "bottom" ? `${arrow}px 0` : side === "top" ? `${arrow}px 100%` : "center",
        }}
      >
        {side !== "center" && (
          <span
            aria-hidden
            className={cn(
              "tour-arrow absolute size-3 rotate-45 bg-surface",
              side === "bottom"
                ? "-top-1.5 shadow-[-1px_-1px_0_var(--color-line-strong)]"
                : "-bottom-1.5 shadow-[1px_1px_0_var(--color-line-strong)]",
            )}
            style={{ left: arrow - 6 }}
          />
        )}

        <div
          key={current.id}
          className="p-4 transition-[opacity,filter,translate] duration-250 ease-out starting:translate-y-0.5 starting:opacity-0 starting:blur-[2px]"
        >
          <div className="flex items-center gap-2">
            {step === 0 ? (
              <LogoMark className="size-6" />
            ) : (
              <span className="tabular text-xs font-medium text-fg-subtle" aria-label={`Step ${step} of ${STEPS.length - 1}`}>
                {step} / {STEPS.length - 1}
              </span>
            )}
            <button
              type="button"
              onClick={finish}
              aria-label="Close the tour"
              className="-mr-1.5 ml-auto grid size-7 place-items-center rounded-lg text-fg-subtle transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-2 hover:text-fg active:scale-[0.94]"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <h2 id="tour-title" className="mt-2 text-[0.9375rem] font-semibold tracking-tight text-balance">
            {current.title}
          </h2>
          <div id="tour-body" className="mt-1 text-[0.8125rem] leading-5 text-fg-muted text-pretty">
            {current.body}
          </div>
          {current.doIt && (
            <p className="mt-2.5 flex items-center gap-2 text-xs font-medium text-accent-text">
              <span className="relative grid size-2 place-items-center">
                <span className="absolute inset-0 rounded-full bg-accent" style={{ animation: "ping-soft 1.6s var(--ease-out) infinite" }} />
                <span className="relative size-2 rounded-full bg-accent" />
              </span>
              {current.doIt}
            </p>
          )}

          <div className="mt-4 flex items-center gap-1.5">
            {step === 0 ? (
              <Button variant="ghost" size="sm" onClick={finish} className="-ml-2">
                Skip
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={finish} className="-ml-2 text-fg-subtle">
                  Skip tour
                </Button>
                <div className="ml-auto flex gap-1" aria-hidden>
                  {STEPS.slice(1).map((s, n) => (
                    <span
                      key={s.id}
                      className={cn(
                        "h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out",
                        n + 1 === step ? "w-4 bg-accent" : n + 1 < (step ?? 0) ? "w-1.5 bg-accent/40" : "w-1.5 bg-line-strong",
                      )}
                    />
                  ))}
                </div>
              </>
            )}
            <div className={cn("flex gap-1.5", step === 0 ? "ml-auto" : "ml-2")}>
              {step !== null && step > 1 && (
                <Button variant="secondary" size="sm" aria-label="Back" onClick={() => go(step - 1)} className="w-8 px-0">
                  <ArrowLeft />
                </Button>
              )}
              <Button ref={next} variant="primary" size="sm" onClick={forward}>
                {step === 0 ? "Show me around" : last ? "Finish" : "Next"}
                {!last && <ArrowRight />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
