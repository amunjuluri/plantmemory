"use client";

import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { create } from "zustand";

import { LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { useBreakdown } from "@/lib/stores/breakdown";
import { cn } from "@/lib/utils";

/** Set once the tour is finished or skipped, so it starts on the first visit only. */
const SEEN_KEY = "plantmemory-tour";

type Step = {
  id: string;
  /** Shown at the top of the popup, so the manager knows where they are. */
  chapter: string;
  /** `data-tour` value of the element to point at; none for the welcome card. */
  target?: string;
  /** Point at the first match of this selector inside the target instead (a tall list). */
  child?: string;
  /** The page the element is on; the tour goes there. */
  page?: string;
  side?: "top" | "bottom";
  title: string;
  body: ReactNode;
  /** The manager does this step: clicking the element moves the tour on. */
  doIt?: string;
  /** Shown only if this holds when the tour reaches it (e.g. a guide was drafted). */
  when?: () => boolean;
  /** Moves on by itself once this holds (the guide has arrived). */
  until?: () => boolean;
  /** Offers to open another tab: yes goes there, "Not now" skips that tab's steps. */
  visit?: { label: string; path: string };
};

const STATS = [
  { value: "~20 s", label: "to a cited guide" },
  { value: "0", label: "made-up part numbers" },
  { value: "12", label: "languages to print" },
];

const drafting = () => useBreakdown.getState().status === "running";
const drafted = () => Boolean(useBreakdown.getState().guide);
const onPage = (id: string) => () => drafted() && Boolean(document.querySelector(`[data-tour="${id}"]`));

const STEPS: Step[] = [
  {
    id: "welcome",
    chapter: "Welcome",
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
    chapter: "Breakdown",
    target: "report",
    page: "/",
    title: "Describe the breakdown",
    body: "Machine, alarm code, what the worker saw. Any language; short forms are fine.",
  },
  {
    id: "speak",
    chapter: "Breakdown",
    target: "speak",
    page: "/",
    title: "Or just say it",
    body: "Speak Telugu, Hindi or English. It asks only for what’s missing and answers in your language. A logbook photo or alarm log works too.",
  },
  {
    id: "examples",
    chapter: "Breakdown",
    target: "examples",
    page: "/",
    side: "top",
    title: "Try one now",
    body: "Tap “TP-02 punch tight” to fill in a sample report.",
    doIt: "Tap an example to continue",
  },
  {
    id: "draft",
    chapter: "Breakdown",
    target: "draft",
    page: "/",
    title: "Draft the repair guide",
    body: "Past fixes, the manual, the parts store and the time, put together and checked. Tap it and watch.",
    doIt: "Tap Draft to see it work, or press Next",
  },
  {
    id: "drafting",
    chapter: "Drafting",
    target: "drafting",
    page: "/",
    title: "Watch it work",
    body: "It reads the report, searches past fixes and the manual side by side, checks the store, then writes and checks every line. About 20 seconds.",
    doIt: "The tour goes on when the guide is ready",
    when: drafting,
    until: () => !drafting(),
  },
  {
    id: "guide",
    chapter: "Your guide",
    target: "guide-header",
    page: "/",
    title: "Your repair guide",
    body: "It’s a draft: nothing reaches the floor until you approve it. Every guide gets an ID and a history of who did what.",
    when: onPage("guide-header"),
  },
  {
    id: "repeat",
    chapter: "Your guide",
    target: "guide-repeat",
    page: "/",
    title: "It has happened before",
    body: "How often, the downtime it has cost, and whether last time’s fix held. That’s the knowledge that walks out when a shift changes.",
    when: onPage("guide-repeat"),
  },
  {
    id: "facts",
    chapter: "Your guide",
    target: "guide-facts",
    page: "/",
    title: "Time and parts at a glance",
    body: "Time from the manual and past repairs, parts checked against the store, and what the guide is based on. Worked out by code, not guessed.",
    when: onPage("guide-facts"),
  },
  {
    id: "steps",
    chapter: "Your guide",
    target: "guide-steps",
    child: "ol > li",
    page: "/",
    title: "Every step shows its source",
    body: "Tap a chip to open the manual page or past fix it came from. A value that isn’t in a source is flagged.",
    when: onPage("guide-steps"),
  },
  {
    id: "parts",
    chapter: "Your guide",
    target: "guide-parts",
    page: "/",
    title: "Parts to collect",
    body: "With stock and bin location. A short part is flagged before anyone walks to the store.",
    when: onPage("guide-parts"),
  },
  {
    id: "actions",
    chapter: "Your guide",
    target: "guide-actions",
    page: "/",
    side: "top",
    title: "Change it, then approve",
    body: "Ask for a change by voice or typing, in any language. Then Approve and print; QA steps in only when code flags something.",
    when: onPage("guide-actions"),
  },
  {
    id: "to-guides",
    chapter: "Guides",
    target: "nav-guides",
    title: "Next: the Guides tab",
    body: "Every guide lives there, from draft to approval, printing and release. Shall we open it?",
    visit: { label: "Open Guides", path: "/guides/" },
  },
  {
    id: "guides",
    chapter: "Guides",
    target: "guides-filters",
    child: "[role=group]",
    page: "/guides/",
    title: "Every guide, by stage",
    body: "QA works from “Waiting for QA”. Approved guides are printed from here as numbered A4 copies in English plus any of 12 Indian languages. Closed ones wait for QA to release the machine.",
  },
  {
    id: "to-alarms",
    chapter: "Alarm logs",
    target: "nav-alarms",
    title: "Got a machine’s alarm log?",
    body: "PlantMemory reads HMI alarm exports and controller logs. Want to see where?",
    visit: { label: "Open Alarm logs", path: "/alarms/" },
  },
  {
    id: "alarms",
    chapter: "Alarm logs",
    target: "alarms-picker",
    page: "/alarms/",
    title: "Drop in a log",
    body: "Errors that stopped the machine come first, with the manual’s first actions and usual time. Warnings that keep rising are flagged before they stop the line. One click drafts the guide.",
  },
  {
    id: "to-memory",
    chapter: "Memory",
    target: "nav-memory",
    title: "Next: plant memory",
    body: "Where every fix is kept, so the next breakdown finds it. Have a look?",
    visit: { label: "Open Memory", path: "/memory/" },
  },
  {
    id: "memory",
    chapter: "Memory",
    target: "memory-tabs",
    page: "/memory/",
    title: "What every guide draws on",
    body: "Past incidents, manuals by page and the parts store. When you close a breakdown and say what was done, it’s added here, so no fix is lost between shifts.",
  },
  {
    id: "to-add",
    chapter: "Add records",
    target: "nav-add",
    title: "Bring in what you already have",
    body: "Old logbooks, SAP history and manuals make the memory useful from day one. Take a look?",
    visit: { label: "Open Add records", path: "/add/" },
  },
  {
    id: "add",
    chapter: "Add records",
    target: "add-tabs",
    child: "[role=group]",
    page: "/add/",
    title: "Logbooks, SAP and manuals",
    body: "Photograph a handwritten logbook, import a SAP or CMMS export, or upload a manual PDF. Nothing extracted is saved until you check it.",
  },
  {
    id: "actor",
    chapter: "Last one",
    target: "actor",
    title: "You’re the manager",
    body: "No sign-in in this demo. Switch to QA here to review a guide and release the machine.",
  },
];

/** The next step to show from `from` in direction `dir`, skipping ones that don't apply. */
function nextStep(from: number, dir: 1 | -1): number | null {
  for (let i = from + dir; i >= 0 && i < STEPS.length; i += dir) {
    const s = STEPS[i];
    if (!s.when || s.when()) return i;
  }
  return null;
}

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
function findTarget(step: Step): HTMLElement | null {
  if (!step.target) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return (step.child && el.querySelector<HTMLElement>(step.child)) || el;
  }
  return null;
}

/** Pinned to the screen (header, tab bar, the guide's action bar): never scrolled to. */
function pinned(el: HTMLElement) {
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

/** Scrolls the element into the part of the screen not under the header or tab bar. */
function reveal(el: HTMLElement) {
  if (pinned(el)) return;
  const r = el.getBoundingClientRect();
  const bottom = window.innerHeight - (window.innerWidth < 768 ? 88 : 24);
  if (r.top < 72 || r.bottom > bottom) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

const samePage = (a: string, b: string) => a.replace(/\/$/, "") === b.replace(/\/$/, "");

const PAD = 6; // room around the element inside the spotlight
const GAP = 14; // spotlight to popup, room for the arrow
const EDGE = 12; // popup to screen edge

/**
 * The product tour: the screen dims, the real control stays lit and usable, and a small
 * popup beside it says what it does, with Next and Skip. It follows the manager's work:
 * report, draft (waiting while it drafts), the guide itself, then each tab, asking before
 * it goes there. Starts on the first visit; the header's help button starts it again.
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
  const last = step !== null && nextStep(step, 1) === null;

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

  // A step on another page takes the manager there.
  useEffect(() => {
    if (current?.page && !samePage(pathname, current.page)) router.push(current.page);
  }, [current, pathname, router]);

  const finish = () => {
    setLeaving(true);
    setTimeout(() => {
      end();
      setLeaving(false);
      setSettled(false);
    }, 160);
  };
  const forward = () => {
    const to = step === null ? null : nextStep(step, 1);
    if (to === null) finish();
    else go(to);
  };
  const back = () => {
    const to = step === null ? null : nextStep(step, -1);
    if (to !== null) go(to);
  };
  // "Not now" on an offer to open a tab: skip that tab's steps.
  const notNow = () => {
    if (step === null || !current?.visit) return;
    let i = step + 1;
    while (i < STEPS.length && STEPS[i].page && samePage(STEPS[i].page!, current.visit.path)) i++;
    const to = nextStep(i - 1, 1);
    if (to === null) finish();
    else go(to);
  };
  // Yes: the next step is on that page, and going to it navigates there.
  const visit = forward;

  // Follow the element every frame while the tour is open: it may scroll, resize or
  // appear late (after navigating, or when the guide arrives), and the spotlight should
  // stay glued to it. A step that waits for something moves on when it happens.
  const forwardRef = useRef(forward);
  useEffect(() => {
    forwardRef.current = forward;
  });
  useEffect(() => {
    if (!current) return;
    let frame = 0;
    let el: HTMLElement | null = null;
    let revealed = false;
    let moved = false;
    const tick = () => {
      if (current.target && (!el || !el.isConnected)) {
        el = findTarget(current);
        revealed = false;
      }
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
      if (!moved && current.until?.()) {
        moved = true;
        // Let the new content render before pointing at it.
        setTimeout(() => forwardRef.current(), 400);
      }
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

  // Doing the step (tapping an example, drafting) moves the tour on.
  useEffect(() => {
    if (!current?.doIt || !current.target || current.until) return;
    const onClick = (e: MouseEvent) => {
      const el = findTarget(current);
      const hit = e.target instanceof Element ? e.target.closest("button, a") : null;
      if (el && hit && el.contains(hit) && !hit.matches(":disabled")) setTimeout(() => forwardRef.current(), 300);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [current]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if (e.key === "Escape") finish();
      else if (!typing && e.key === "ArrowRight" && !current?.visit) forward();
      else if (!typing && e.key === "ArrowLeft") back();
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

  if (!current || step === null) return null;

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
  const progress = step / (STEPS.length - 1);
  const waiting = Boolean(current.until);

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
        className={cn(
          "tour-spot pointer-events-none fixed top-0 left-0 z-[70] rounded-xl",
          (current.doIt || current.visit) && hole && "tour-spot-do",
        )}
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
          "tour-pop fixed top-0 left-0 z-[71] w-[min(21rem,calc(100vw-1.5rem))] overflow-visible rounded-2xl bg-surface text-fg shadow-raised outline-none",
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

        {/* How far through the tour: a hairline along the top edge. */}
        {step > 0 && (
          <span aria-hidden className="absolute inset-x-4 top-0 h-0.5 overflow-hidden rounded-full bg-line">
            <span
              className="tour-progress absolute inset-0 origin-left rounded-full bg-accent"
              style={{ transform: `scaleX(${progress})` }}
            />
          </span>
        )}

        <div
          key={current.id}
          className="p-4 transition-[opacity,filter,translate] duration-250 ease-out starting:translate-y-0.5 starting:opacity-0 starting:blur-[2px]"
        >
          <div className="flex items-center gap-2">
            {step === 0 ? (
              <LogoMark className="size-6" />
            ) : (
              <span className="text-xs font-medium text-accent-text">
                {current.chapter}
                <span className="sr-only">
                  , step {step} of {STEPS.length - 1}
                </span>
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
          <h2 id="tour-title" className="mt-1.5 text-[0.9375rem] font-semibold tracking-tight text-balance">
            {current.title}
          </h2>
          <div id="tour-body" className="mt-1 text-[0.8125rem] leading-5 text-fg-muted text-pretty">
            {current.body}
          </div>
          {current.doIt && (
            <p className="mt-2.5 flex items-center gap-2 text-xs font-medium text-accent-text" aria-live="polite">
              <span className="relative grid size-2 place-items-center">
                <span
                  className="absolute inset-0 rounded-full bg-accent"
                  style={{ animation: "ping-soft 1.6s var(--ease-out) infinite" }}
                />
                <span className="relative size-2 rounded-full bg-accent" />
              </span>
              {current.doIt}
            </p>
          )}

          <div className="mt-4 flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={finish} className="-ml-2 text-fg-subtle">
              {step === 0 ? "Skip" : "Skip tour"}
            </Button>
            <div className="ml-auto flex gap-1.5">
              {current.visit ? (
                <>
                  <Button variant="secondary" size="sm" onClick={notNow}>
                    Not now
                  </Button>
                  <Button ref={next} variant="primary" size="sm" onClick={visit}>
                    {current.visit.label}
                    <ArrowRight />
                  </Button>
                </>
              ) : (
                <>
                  {step > 1 && !waiting && (
                    <Button variant="secondary" size="sm" aria-label="Back" onClick={back} className="w-8 px-0">
                      <ArrowLeft />
                    </Button>
                  )}
                  <Button ref={next} variant={waiting ? "secondary" : "primary"} size="sm" onClick={forward}>
                    {step === 0 ? "Show me around" : waiting ? "Skip waiting" : last ? "Finish" : "Next"}
                    {!last && !waiting && <ArrowRight />}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
