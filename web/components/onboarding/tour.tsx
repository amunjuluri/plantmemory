"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Check, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { create } from "zustand";

import { LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { useBreakdown } from "@/lib/stores/breakdown";
import { useLiveVoice } from "@/lib/stores/live-voice";
import { track } from "@/lib/telemetry";
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
  /** Where the popup goes. "right" falls back to `narrow` (default below) on phones. */
  side?: "top" | "bottom" | "right";
  narrow?: "top" | "bottom";
  title: string;
  body: ReactNode;
  /** The manager does this step: clicking the element moves the tour on. */
  doIt?: ReactNode;
  /** Shown only if this holds when the tour reaches it (e.g. a guide was drafted). */
  when?: () => boolean;
  /** Moves on by itself once this holds (the guide has arrived, the change is ready). */
  until?: () => boolean;
  /** A branch (the voice conversation): when `until` fires, the next step is the first
   * one in the branch that applies, so the tour follows the conversation wherever it
   * goes, and leaves the branch when none does. */
  group?: string;
  /** Label of the Next button, and what it does first (e.g. end the conversation). */
  next?: { label: string; before?: () => void };
  /** Offers to open another tab: yes goes there, "Not now" skips that tab's steps. */
  visit?: { label: string; path: string };
  /** A wider card, for the welcome and the wrap-up. */
  wide?: boolean;
};

// Every figure is quoted from the source it links to (checked 14 Oct 2026).
const SIEMENS = "https://assets.new.siemens.com/siemens/assets/api/uuid:1b43afb5-2d07-47f7-9eb7-893fe7d0bc59/TCOD-2024_original.pdf";
const EVIDENCE = [
  {
    value: "$1.4T",
    label: "lost a year to unplanned downtime by the world’s 500 biggest companies: 11% of revenue",
    source: "Siemens, 2024",
    href: SIEMENS,
  },
  {
    value: "27 h",
    label: "of unplanned downtime a month at an average large plant",
    source: "Siemens, 2024",
    href: SIEMENS,
  },
  {
    value: "$125k",
    label: "typical cost of one hour of unplanned downtime, from a survey of 3,215 plants",
    source: "ABB, 2023",
    href: "https://new.abb.com/news/detail/107660/abb-survey-reveals-unplanned-downtime-costs-125000-per-hour",
  },
  {
    value: "62%",
    label: "of US drug shortages (2013–17) began with manufacturing or quality problems",
    source: "US FDA, 2019",
    href: "https://www.fda.gov/drugs/drug-shortages/report-drug-shortages-root-causes-and-potential-solutions",
  },
];

const IMPACT = [
  "Which machines are stopped, and for how long, at a glance",
  "A checked repair guide in about 10 seconds, not a search through logbooks",
  "One approved sheet the crew follows in their own language",
  "Every fix stays in plant memory when shifts change or people leave",
];

const has = (id: string) => Boolean(document.querySelector(`[data-tour="${id}"]`));
const drafting = () => useBreakdown.getState().status === "running";
// Guide steps apply wherever a guide is on screen: under the breakdown form, or a guide
// opened from the Guides tab.
const onPage = (id: string) => () => has(id);
const path = () => window.location.pathname;

// The breakdown voice conversation, as the tour sees it.
const voice = () => useLiveVoice.getState();
const voicePanel = () => has("voice") && voice().mode === "breakdown";
const talking = () => voicePanel() && ["connecting", "live", "confirmed"].includes(voice().phase);
const heardAll = () => Boolean(voice().result?.done);
const voiceButton = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-tour="voice"] button')].find(
    (b) => b.getAttribute("aria-label") === name || b.textContent?.trim() === name,
  );
const endVoice = () => voiceButton("End")?.click();
const closeVoice = () => voiceButton("Close")?.click();
let volumeShown = false;

/** A line to say, in English: the manager may say it in any language. */
function Say({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-[0.8125rem] leading-5 font-medium text-accent-text">
      “{children}”
    </p>
  );
}

// What to say next, for whatever the conversation still needs.
const NEXT_LINE: Record<string, string> = {
  equipment: "It’s TP-02.",
  symptom: "The upper punch is tight. E-104 is on the screen.",
  machine_stopped: "Yes, it stopped in the middle of the batch.",
};

/** The script for the voice branch: the first line, then an answer to each question,
 * following what the conversation is still missing. */
function VoiceScript() {
  const result = useLiveVoice((s) => s.result);
  const missing = result?.missing ?? [];
  const line = !result ? "TP-02 has stopped. The screen shows E-104, punch tight." : NEXT_LINE[missing[0]];
  return (
    <>
      <p>
        {!result
          ? "Speak in the language you’re most comfortable with: Telugu, Hindi, English or mixed. Not sure what to say? Try this:"
          : "It asks only for what’s still missing. Answer in your language, for example:"}
      </p>
      {line && <Say>{line}</Say>}
      <p className="mt-2 text-xs text-fg-subtle">No microphone? Tap the keyboard button to type.</p>
    </>
  );
}

const STEPS: Step[] = [
  {
    id: "welcome",
    chapter: "Welcome",
    wide: true,
    title: "Every hour a line stands still costs money",
    body: (
      <>
        <p>When a machine stops, the line waits for your instruction. The cost of that wait is well measured:</p>
        <ul className="mt-3 grid grid-cols-2 gap-1.5">
          {EVIDENCE.map((e, i) => (
            <li
              key={e.value}
              style={{ transitionDelay: `${120 + i * 70}ms` }}
              className="flex flex-col rounded-lg bg-surface-2 px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition-[opacity,translate] duration-300 ease-out starting:translate-y-1 starting:opacity-0"
            >
              <span className="tabular text-lg leading-6 font-semibold tracking-tight text-fg">{e.value}</span>
              <span className="mt-0.5 text-[0.6875rem] leading-4">{e.label}</span>
              <a
                href={e.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto inline-flex items-center gap-0.5 self-start pt-1.5 text-[0.6875rem] font-medium text-fg-subtle underline decoration-line-strong underline-offset-2 transition-[color] duration-150 ease-out hover:text-accent-text"
              >
                {e.source}
                <ArrowUpRight className="size-3" />
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-fg">
          PlantMemory gives you a checked repair guide in about 10 seconds, from your plant’s past fixes and the
          manual, printed in your workers’ language.
        </p>
      </>
    ),
  },
  {
    id: "plant",
    chapter: "Your plant",
    target: "plant-status",
    page: "/",
    title: "Your plant at a glance",
    body: "Which machines are running, which have stopped and for how long, and which wait for QA to release them. Tap it to see each machine and open its guide.",
  },
  {
    id: "flow",
    chapter: "How it works",
    target: "flow",
    page: "/",
    title: "Four steps, nothing missed",
    body: "Describe the breakdown, get a checked guide in about 10 seconds, approve and print it for the crew, then close it so QA can release the machine. Let’s do the first one.",
    when: onPage("flow"),
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
    body: "Talk it through in your language. It asks for what’s missing and answers out loud. A logbook photo or the machine’s alarm log works too.",
    doIt: "Tap Speak to try it",
    next: { label: "Type instead" },
  },

  // --- Voice branch: follows the conversation, then joins the draft. ---
  {
    id: "voice-volume",
    group: "voice",
    chapter: "Speaking",
    target: "voice",
    page: "/",
    side: "right",
    narrow: "top",
    title: "Turn your volume up",
    body: "It answers out loud, so you can keep your eyes on the machine. Allow the microphone if your browser asks.",
    when: () => talking() && !volumeShown,
    until: () => !talking(),
    next: { label: "Volume’s up" },
  },
  {
    id: "voice-trouble",
    group: "voice",
    chapter: "Speaking",
    target: "voice",
    page: "/",
    side: "right",
    narrow: "top",
    title: "Voice didn’t start",
    body: "Check that the browser may use the microphone, then tap Start again. Or tap Close and type the report instead.",
    when: () => voicePanel() && !talking(),
    until: () => !voicePanel() || talking(),
    next: { label: "Close and type", before: closeVoice },
  },
  {
    id: "voice-say",
    group: "voice",
    chapter: "Speaking",
    target: "voice",
    page: "/",
    side: "right",
    narrow: "top",
    title: "Say what broke, your way",
    body: <VoiceScript />,
    when: () => talking() && !heardAll(),
    until: () => !talking() || heardAll(),
    next: { label: "Stop and type", before: endVoice },
  },
  {
    id: "voice-confirm",
    group: "voice",
    chapter: "Speaking",
    target: "voice",
    page: "/",
    side: "right",
    narrow: "top",
    title: "Check it, then confirm",
    body: (
      <>
        <p>It reads the report back. If the chips are right, say:</p>
        <Say>Yes, that’s right.</Say>
        <p className="mt-2">Or tap Draft repair guide. Say what’s wrong to change it.</p>
      </>
    ),
    when: () => talking() && heardAll(),
    until: () => drafting() || !talking(),
    next: { label: "Stop and type", before: endVoice },
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
    when: () => !drafting(),
  },
  {
    id: "draft",
    chapter: "Breakdown",
    target: "draft",
    page: "/",
    title: "Draft the repair guide",
    body: (
      <>
        <p>Past fixes, the manual, the parts store and the time, put together and checked. Tap it and watch.</p>
        <p className="mt-2 text-xs text-fg-subtle">
          If the machine already has an open guide, the form offers it first so one stop isn’t drafted twice. For the
          tour, draft anyway.
        </p>
      </>
    ),
    doIt: "Tap Draft to see it work, or press Next",
    when: () => !drafting(),
  },
  {
    id: "drafting",
    chapter: "Drafting",
    target: "drafting",
    page: "/",
    title: "Watch it work",
    body: "It reads the report, searches past fixes and the manual side by side, checks the store, then writes and checks every line. About 10 seconds.",
    doIt: "The tour goes on when the guide is ready",
    when: drafting,
    until: () => !drafting(),
    next: { label: "Skip waiting" },
  },

  // --- The guide. ---
  {
    id: "guide",
    chapter: "Your guide",
    target: "guide-stages",
    title: "Your repair guide",
    body: "The track shows where it stands, from draft to QA’s release. Nothing reaches the floor until it’s approved, and every guide keeps a history of who did what.",
    when: onPage("guide-stages"),
  },
  {
    id: "repeat",
    chapter: "Your guide",
    target: "guide-repeat",
    title: "It has happened before",
    body: "How often, the downtime it has cost, and whether last time’s fix held. That’s the knowledge that walks out when a shift changes.",
    when: onPage("guide-repeat"),
  },
  {
    id: "facts",
    chapter: "Your guide",
    target: "guide-facts",
    title: "Time and parts at a glance",
    body: "Time from the manual and past repairs, parts checked against the store, and what the guide is based on. Worked out by code, not guessed.",
    when: onPage("guide-facts"),
  },
  {
    id: "steps",
    chapter: "Your guide",
    target: "guide-steps",
    child: "ol > li",
    title: "Every step shows its source",
    body: "Tap a chip to open the manual page or past fix it came from. A value that isn’t in a source is flagged.",
    when: onPage("guide-steps"),
  },
  {
    id: "parts",
    chapter: "Your guide",
    target: "guide-parts",
    title: "Parts to collect",
    body: "With stock and bin location. A short part is flagged before anyone walks to the store.",
    when: onPage("guide-parts"),
  },

  // --- Change it by voice or chat. ---
  {
    id: "revise",
    chapter: "Change it",
    target: "revise",
    side: "top",
    title: "Ask for a change",
    body: (
      <>
        <p>Type it, or tap the mic and say it, in any language. Try:</p>
        <Say>Add a safety step: wear a dust mask before opening the guard.</Say>
      </>
    ),
    doIt: "Send it and give it about 5 seconds. If it asks a question, answer it.",
    when: onPage("revise"),
    until: () => has("revision"),
  },
  {
    id: "revision",
    chapter: "Change it",
    target: "revision",
    title: "Every change is marked",
    body: "New, changed and removed lines are highlighted in the guide, and checked against the sources like a hand edit.",
    when: () => has("revision"),
  },
  {
    id: "keep",
    chapter: "Change it",
    target: "guide-actions",
    side: "top",
    title: "Keep it or discard it",
    body: "Nothing is saved until you keep it. The guide’s history records what you asked for.",
    doIt: "Tap Keep changes or Discard",
    when: () => has("revision"),
    until: () => !has("revision"),
  },

  // --- Approve and print. ---
  {
    id: "approve",
    chapter: "Approve",
    target: "guide-actions",
    side: "top",
    title: "Approve and print",
    body: "When it’s right, approve it. It’s translated for the floor in about 5 seconds, then the print page opens. Whether QA checks it first isn’t your call: if code flags something, approving sends it to QA.",
    doIt: "Tap Approve and print to see the sheet, or press Next",
    when: () => has("approve-button"),
    until: () => path().startsWith("/guides/print") && has("print-sheet"),
  },
  {
    id: "print-languages",
    chapter: "Print",
    target: "print-languages",
    title: "Languages on the sheet",
    body: "The crew’s languages are added on approval. Tap one to leave it off this copy. After the tour, + Language adds any of 12 Indian languages.",
    when: () => path().startsWith("/guides/print") && has("print-languages"),
  },
  {
    id: "print-sheet",
    chapter: "Print",
    target: "print-sheet",
    child: "header",
    title: "The A4 sheet",
    body: "Every line in English with each language under it, the manual’s figures, a tick box per step and sign-off lines. Pinch to zoom on a phone.",
    when: () => path().startsWith("/guides/print"),
  },
  {
    id: "print-button",
    chapter: "Print",
    target: "print-button",
    title: "Print a numbered copy",
    body: "Each print is a controlled copy with its own number, recorded in the history. On a phone, pick a printer or Save as PDF.",
    when: () => path().startsWith("/guides/print"),
  },
  {
    id: "print-back",
    chapter: "After the repair",
    target: "print-back",
    title: "When the repair is done",
    body: "Go back to the guide to record what was actually done.",
    doIt: "Tap Back to guide, or press Next",
    when: () => path().startsWith("/guides/print"),
    until: () => path().startsWith("/guides/view") && has("guide-header"),
  },
  {
    id: "close",
    chapter: "After the repair",
    target: "close-breakdown",
    title: "Close the breakdown",
    body: (
      <>
        <p>After the repair, tap it and say what was done. A short answer is enough:</p>
        <Say>Did what the guide said. Took about an hour. It’s fixed.</Say>
        <p className="mt-2">
          It fills in the steps and parts from the guide and saves the fix to plant memory. QA then releases the
          machine, and it shows as running again at the top of the Breakdown page.
        </p>
      </>
    ),
    when: () => path().startsWith("/guides/view") && has("close-breakdown"),
  },

  // --- The other tabs, each offered first. ---
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
    title: "Every guide, by what’s next",
    body: "Open guides are still being decided or worked. QA works from “Waiting for QA” and “Waiting for release”. A guide that isn’t needed is withdrawn with a reason, never deleted.",
  },
  {
    id: "guides-row",
    chapter: "Guides",
    target: "guides-list",
    child: "li",
    page: "/guides/",
    title: "Open any guide",
    body: "Its steps, languages and history, and the next action: approve, print, close after the repair, or release for QA.",
    when: () => has("guides-list"),
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
    target: "alarms-page",
    page: "/alarms/",
    title: "Read a machine’s log",
    body: "When the HMI or controller has logged the alarms, start here instead of describing the breakdown.",
  },
  {
    id: "alarms-drop",
    chapter: "Alarm logs",
    target: "alarms-drop",
    page: "/alarms/",
    title: "Drop in a log",
    body: "An HMI alarm export (CSV) or a controller printout. Pick the machine, or let it work it out from the log.",
    when: () => has("alarms-drop"),
  },
  {
    id: "alarms-sample",
    chapter: "Alarm logs",
    target: "alarms-samples",
    page: "/alarms/",
    side: "top",
    title: "Try a sample",
    body: "Tap the TP-02 alarm export. It’s read in a few seconds.",
    doIt: "Tap a sample, or press Next",
    when: () => has("alarms-samples"),
    until: () => has("alarms-errors"),
  },
  {
    id: "alarms-result",
    chapter: "Alarm logs",
    target: "alarms-errors",
    child: ":scope > :nth-child(2)",
    page: "/alarms/",
    title: "What stopped the machine, first",
    body: "Each stopping error with the manual’s first actions and how long the fix usually takes. Rising warnings are listed below. One click drafts the repair guide.",
    when: () => has("alarms-errors"),
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
    body: "Past incidents, manuals by page and the parts store. Every closed breakdown is added here, so no fix is lost between shifts.",
  },
  {
    id: "memory-row",
    chapter: "Memory",
    target: "memory-list",
    child: "li",
    page: "/memory/",
    title: "Every past fix, searchable",
    body: "What failed, what was done and whether it held, whoever wrote it and in whatever language. Tap one to read it with its source.",
    when: () => has("memory-list"),
  },

  {
    id: "memory-add",
    chapter: "Memory",
    target: "memory-add",
    page: "/memory/",
    title: "Bring in what you already have",
    body: "Old logbook photos, SAP or CMMS history and manual PDFs make the memory useful from day one. Nothing extracted is saved until you check it.",
  },
  {
    id: "actor",
    chapter: "Last one",
    target: "actor",
    title: "Manager or QA",
    body: "No sign-in in this demo. Switch to QA here to review guides that need a check, and to release the machine after a repair.",
  },
  {
    id: "wrap",
    chapter: "That’s the tour",
    wide: true,
    title: "Every closed breakdown makes the next one shorter",
    body: (
      <ul className="mt-1 flex flex-col gap-2">
        {IMPACT.map((line, i) => (
          <li
            key={line}
            style={{ transitionDelay: `${120 + i * 70}ms` }}
            className="flex items-start gap-2 text-fg transition-[opacity,translate] duration-300 ease-out starting:translate-y-1 starting:opacity-0"
          >
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-success-soft text-success-text">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            {line}
          </li>
        ))}
      </ul>
    ),
  },

  // Page tours only (after the wrap-up, so the full tour doesn't include them).
  {
    id: "add",
    chapter: "Add records",
    target: "add-tabs",
    child: "[role=group]",
    page: "/add/",
    title: "Logbooks, SAP and manuals",
    body: "Photograph a handwritten logbook, import a SAP or CMMS export, or upload a manual PDF. Nothing extracted is saved until you check it.",
  },
];

const at = (id: string) => STEPS.findIndex((s) => s.id === id);

/** Tours the header menu offers: the whole job, or one page. `path` is the page it
 * belongs to ("This page"); `pick` puts it in the list of pages. */
export const SECTIONS = {
  full: { label: "Full tour", hint: "From a breakdown to a printed sheet, about 3 min", first: "welcome", last: "wrap" },
  breakdown: { label: "Breakdown", hint: "Plant status, report it, draft a guide", first: "plant", last: "approve", path: "/", pick: true },
  guide: { label: "This guide", hint: "Sources, changes, approval, closing", first: "guide", last: "close", path: "/guides/view/" },
  print: { label: "The print page", hint: "Languages, the A4 sheet, numbered copies", first: "print-languages", last: "close", path: "/guides/print/" },
  guides: { label: "Guides", hint: "Every guide by stage", first: "guides", last: "guides-row", path: "/guides/", pick: true },
  alarms: { label: "Alarm logs", hint: "From a machine’s log to a guide", first: "alarms", last: "alarms-result", path: "/alarms/", pick: true },
  memory: { label: "Memory", hint: "Past fixes, manuals, parts", first: "memory", last: "memory-add", path: "/memory/", pick: true },
  add: { label: "Add records", hint: "Logbooks, SAP, manuals", first: "add", last: "add", path: "/add/", pick: true },
} satisfies Record<string, { label: string; hint: string; first: string; last: string; path?: string; pick?: boolean }>;
export type Section = keyof typeof SECTIONS;

/** The steps of the tour that is running, as indexes into STEPS. */
let range: [number, number] = [0, STEPS.length - 1];

/** The next step to show from `from` in direction `dir`, skipping ones that don't apply. */
function nextStep(from: number, dir: 1 | -1): number | null {
  for (let i = from + dir; i >= range[0] && i <= range[1]; i += dir) {
    const s = STEPS[i];
    if (!s.when || s.when()) return i;
  }
  return null;
}

/** After a branch step's condition fires: the first step of the branch that applies now
 * (other than this one), or the first step after the branch. */
function branchStep(from: number): number | null {
  const group = STEPS[from].group;
  if (!group) return nextStep(from, 1);
  let last = from;
  for (let i = range[0]; i <= range[1]; i++) {
    if (STEPS[i].group !== group) continue;
    last = i;
    if (i !== from && (!STEPS[i].when || STEPS[i].when!())) return i;
  }
  return nextStep(last, 1);
}

type TourState = {
  step: number | null;
  section: Section;
  start: (section?: Section) => void;
  go: (step: number) => void;
  end: () => void;
};

export const useTour = create<TourState>((set) => ({
  step: null,
  section: "full",
  start: (section = "full") => {
    const { first, last } = SECTIONS[section];
    range = [at(first), at(last)];
    set({ step: range[0], section });
    track("tour_started", { section });
  },
  go: (step) => set({ step: Math.max(range[0], Math.min(range[1], step)) }),
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
  // Read at once, not on the first animation frame, so the card and the dimming appear
  // together instead of the grey arriving first.
  const [screen, setScreen] = useState(() =>
    typeof window === "undefined" ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight },
  );
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [leaving, setLeaving] = useState(false);
  // Placed once: from then on the popup glides between elements instead of jumping.
  const [settled, setSettled] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const stepsSeen = useRef(0);
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

  // A step on another page takes the manager there, once, when the step starts: a step
  // may itself lead somewhere else (Approve opens the print page).
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  });
  useEffect(() => {
    if (current?.page && !samePage(pathRef.current, current.page)) router.push(current.page);
  }, [current, router]);

  const finish = () => {
    track("tour_ended", {
      section: useTour.getState().section,
      step: current?.id ?? null,
      finished: last,
      steps_seen: stepsSeen.current,
    });
    setLeaving(true);
    setTimeout(() => {
      end();
      setLeaving(false);
      setSettled(false);
    }, 160);
  };
  const goOrFinish = (to: number | null) => (to === null ? finish() : go(to));
  const forward = () => goOrFinish(step === null ? null : nextStep(step, 1));
  // Next, with whatever the step does first (ending the conversation, say). The page
  // needs a moment to react before the tour picks where to go.
  const onNext = () => {
    const before = current?.next?.before;
    if (!before || step === null) return forward();
    before();
    const from = step;
    setTimeout(() => goOrFinish(branchStep(from)), 150);
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
  const branchRef = useRef(() => goOrFinish(step === null ? null : branchStep(step)));
  useEffect(() => {
    forwardRef.current = forward;
    branchRef.current = () => goOrFinish(step === null ? null : branchStep(step));
  });

  // Which steps people reach, to see where the tour loses them.
  useEffect(() => {
    if (!current) {
      stepsSeen.current = 0;
      return;
    }
    stepsSeen.current++;
    track("tour_step", { step: current.id, section: useTour.getState().section });
  }, [current]);

  useEffect(() => {
    if (current?.id === "voice-volume") volumeShown = true;
  }, [current]);
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
        setTimeout(() => branchRef.current(), 400);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [current]);

  // Where the element is, measured before the step first paints (then followed per frame).
  useLayoutEffect(() => {
    if (!current) return;
    const el = findTarget(current);
    const r = el?.getBoundingClientRect();
    // Measuring layout before paint is what a layout effect is for (React docs).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHole(r && r.width ? { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 } : null);
    setScreen({ w: window.innerWidth, h: window.innerHeight });
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
      else if (!typing && e.key === "ArrowRight" && !current?.visit) onNext();
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

  // Place the popup beside the element on a wide screen when asked, otherwise under it, or
  // above when there's no room (the tab bar).
  let side: "top" | "bottom" | "right" | "center" = "center";
  let left = (screen.w - size.w) / 2;
  let top = (screen.h - size.h) / 2;
  let arrow = size.w / 2;
  if (hole && current.side === "right" && screen.w - (hole.x + hole.w) - GAP - EDGE >= size.w) {
    side = "right";
    left = hole.x + hole.w + GAP;
    const middle = hole.y + hole.h / 2;
    top = Math.max(EDGE, Math.min(middle - size.h / 2, screen.h - size.h - EDGE));
    arrow = Math.max(20, Math.min(middle - top, size.h - 20));
  } else if (hole) {
    const below = screen.h - (hole.y + hole.h) - GAP - EDGE;
    const above = hole.y - GAP - EDGE;
    side = (current.side === "right" ? current.narrow : current.side) === "top" ? "top" : "bottom";
    // Switch sides only to one where it fits; otherwise keep the side asked for.
    if (side === "bottom" && below < size.h && above >= size.h) side = "top";
    else if (side === "top" && above < size.h && below >= size.h) side = "bottom";
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
  const progress = (step - range[0]) / Math.max(1, range[1] - range[0]);
  const canGoBack = nextStep(step, -1) !== null;
  // On a short screen the popup may have to sit over the element; then an arrow would
  // point at nothing.
  const overlaps =
    hole !== null &&
    ((side === "top" && top + size.h > hole.y + 4) || (side === "bottom" && top < hole.y + hole.h - 4));
  const label = current.next?.label ?? (step === 0 ? "Show me around" : last ? "Finish" : "Next");

  return (
    <div
      className={cn(
        "print:hidden",
        "transition-opacity duration-150 ease-out",
        leaving || !measured ? "opacity-0" : "opacity-100 starting:opacity-0",
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
          // Above toasts too (Sonner's layer), so a toast never hides the popup.
          "tour-pop fixed top-0 left-0 z-[1000000000]",
          current.wide ? "w-[min(27rem,calc(100vw-1.5rem))]" : "w-[min(21rem,calc(100vw-1.5rem))]",
          "overflow-visible rounded-2xl bg-surface text-fg shadow-raised outline-none",
          "starting:scale-[0.96]",
        )}
        style={{
          transform: `translate(${Math.round(left)}px, ${Math.round(top)}px)`,
          // Grows out of the arrow, toward the element it points at.
          transformOrigin:
            side === "bottom"
              ? `${arrow}px 0`
              : side === "top"
                ? `${arrow}px 100%`
                : side === "right"
                  ? `0 ${arrow}px`
                  : "center",
        }}
      >
        {side !== "center" && !overlaps && (
          <span
            aria-hidden
            className={cn(
              "tour-arrow absolute size-3 rotate-45 bg-surface",
              side === "bottom" && "-top-1.5 shadow-[-1px_-1px_0_var(--color-line-strong)]",
              side === "top" && "-bottom-1.5 shadow-[1px_1px_0_var(--color-line-strong)]",
              side === "right" && "-left-1.5 shadow-[-1px_1px_0_var(--color-line-strong)]",
            )}
            style={side === "right" ? { top: arrow - 6 } : { left: arrow - 6 }}
          />
        )}

        {/* How far through the tour: a hairline along the top edge. */}
        {current.id !== "welcome" && (
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
                  , step {step - range[0] + 1} of {range[1] - range[0] + 1}
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
                  {canGoBack && step > 1 && !current.until && !current.group && (
                    <Button variant="secondary" size="sm" aria-label="Back" onClick={back} className="w-8 px-0">
                      <ArrowLeft />
                    </Button>
                  )}
                  <Button
                    ref={next}
                    variant={current.until || current.next ? "secondary" : "primary"}
                    size="sm"
                    onClick={onNext}
                  >
                    {label}
                    {!last && !current.next && <ArrowRight />}
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
