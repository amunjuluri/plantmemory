"use client";

import { ArrowRight, ChevronDown, FilePlus2, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { Card } from "@/components/ui/card";
import { Shimmer } from "@/components/ui/states";
import type { MachineState, MachineStatus, PlantStatus } from "@/lib/api";
import { useBreakdown } from "@/lib/stores/breakdown";
import { stageLabel, useNow, usePlantStatus } from "@/lib/stores/plant";
import { track } from "@/lib/telemetry";
import { cn, formatDate, formatDuration, formatSince, plural } from "@/lib/utils";

const OPEN_KEY = "plantmemory-plant-open";

const TONE: Record<MachineState, { dot: string; text: string; label: string }> = {
  stopped: { dot: "bg-danger", text: "text-danger-text", label: "Stopped" },
  awaiting_release: { dot: "bg-warn", text: "text-warn-text", label: "Waiting for release" },
  running: { dot: "bg-success", text: "text-success-text", label: "Running" },
};

const guideHref = (id: string) => `/guides/view/?id=${encodeURIComponent(id)}`;

function Dot({ state, live }: { state: MachineState; live?: boolean }) {
  return (
    <span aria-hidden className="relative grid size-2 shrink-0 place-items-center">
      {live && (
        <span
          className={cn("absolute inset-0 rounded-full", TONE[state].dot)}
          style={{ animation: "ping-soft 2s var(--ease-out) infinite" }}
        />
      )}
      <span className={cn("relative size-2 rounded-full", TONE[state].dot)} />
    </span>
  );
}

/** One cell per machine, worst first, so the bar reads like the floor. A large plant gets
 * proportional segments instead. */
function Meter({ status, className }: { status: PlantStatus; className?: string }) {
  const total = status.machines.length;
  const label = `${status.running} running, ${status.stopped} stopped, ${status.awaiting_release} waiting for release`;
  if (total <= 24) {
    return (
      <span role="img" aria-label={label} className={cn("flex h-2 gap-[3px]", className)}>
        {status.machines.map((m, i) => (
          <span
            key={m.tag}
            style={{ transitionDelay: `${i * 20}ms` }}
            className={cn(
              "h-full min-w-1 flex-1 rounded-full transition-[background-color,opacity] duration-300 ease-out starting:opacity-0",
              TONE[m.state].dot,
              m.state === "running" && "opacity-70",
            )}
          />
        ))}
      </span>
    );
  }
  const parts: [MachineState, number][] = [
    ["stopped", status.stopped],
    ["awaiting_release", status.awaiting_release],
    ["running", status.running],
  ];
  return (
    <span role="img" aria-label={label} className={cn("flex h-2 gap-[3px] overflow-hidden", className)}>
      {parts
        .filter(([, n]) => n > 0)
        .map(([state, n]) => (
          <span
            key={state}
            className={cn("h-full rounded-full", TONE[state].dot, state === "running" && "opacity-70")}
            style={{ flexGrow: n, flexBasis: 0 }}
          />
        ))}
    </span>
  );
}

function Legend({ status }: { status: PlantStatus }) {
  const items: [MachineState, number, string][] = [
    ["stopped", status.stopped, "stopped"],
    ["awaiting_release", status.awaiting_release, "waiting for release"],
  ];
  const shown = items.filter(([, n]) => n > 0);
  if (!shown.length) return <span className="text-success-text">All running</span>;
  return (
    <>
      {shown.map(([state, n, label]) => (
        <span key={state} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Dot state={state} />
          <span>
            <span className={cn("tabular font-medium", TONE[state].text)}>{n}</span> {label}
          </span>
        </span>
      ))}
    </>
  );
}

/** Pre-fills the breakdown form with this machine and puts the cursor in the report. */
function reportFor(tag: string) {
  track("plant_report_clicked", { machine: tag });
  useBreakdown.getState().setAssetTag(tag);
  const box = document.getElementById("breakdown");
  if (!box) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  box.focus({ preventScroll: true });
}

/** Shown one after another as the panel opens; all at once, quickly, as it closes. */
const REVEAL =
  "transition-[opacity,translate,filter] duration-300 ease-out group-data-open/panel:delay-(--reveal) not-group-data-open/panel:translate-y-1 not-group-data-open/panel:opacity-0 not-group-data-open/panel:blur-[2px] not-group-data-open/panel:duration-150";

const revealDelay = (i: number) => ({ "--reveal": `${60 + Math.min(i, 12) * 35}ms` }) as React.CSSProperties;

function MachineRow({ machine: m, now, index }: { machine: MachineStatus; now: number; index: number }) {
  const tone = TONE[m.state];
  const stopped = m.state !== "running";
  return (
    <li
      style={revealDelay(index)}
      className={cn("flex min-w-0 flex-col gap-1 rounded-xl bg-surface p-3 shadow-[inset_0_0_0_1px_var(--color-line)]", REVEAL)}
    >
      <div className="flex items-center gap-2">
        <Dot state={m.state} live={m.state === "stopped"} />
        <span className="truncate font-mono text-[0.8125rem] font-semibold">{m.tag}</span>
        <span className={cn("ml-auto shrink-0 text-xs font-medium whitespace-nowrap", tone.text)}>
          {tone.label}
          {stopped && m.since && <span className="tabular"> · {formatSince(m.since, now)}</span>}
        </span>
      </div>
      <p className="truncate pl-4 text-xs text-fg-subtle" title={m.equipment_model ?? undefined}>
        {m.equipment_model ?? "No manual or parts on file"}
      </p>
      <div className="mt-1 flex min-h-7 items-center justify-between gap-2 pl-4">
        {stopped && m.guide_id ? (
          <>
            <span className="min-w-0 truncate text-[0.8125rem] text-fg-muted">
              {stageLabel(m, true)}
              {m.open_guides > 1 && <span className="text-fg-subtle"> · {m.open_guides} open</span>}
            </span>
            <Link
              href={guideHref(m.guide_id)}
              aria-label={`Open the guide for ${m.tag}`}
              className="-mr-1.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[0.8125rem] font-medium text-accent-text transition-[background-color] duration-150 ease-out hover:bg-accent-soft [&_svg]:size-3.5"
            >
              Open
              <ArrowRight />
            </Link>
          </>
        ) : (
          <>
            <span className="min-w-0 truncate text-[0.8125rem] text-fg-subtle">
              {m.since ? `Back in production ${formatDate(m.since)}` : "No open breakdown"}
            </span>
            <button
              type="button"
              onClick={() => reportFor(m.tag)}
              aria-label={`Report a breakdown on ${m.tag}`}
              className="-mr-1.5 inline-flex h-7 shrink-0 items-center rounded-lg px-2 text-[0.8125rem] font-medium text-fg-muted transition-[background-color,color] duration-150 ease-out hover:bg-surface-2 hover:text-fg"
            >
              Report
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Details({ status, now }: { status: PlantStatus; now: number }) {
  const down = status.machines.filter((m) => m.state !== "running" && m.since);
  // A small plant shows every machine; a large one keeps full rows for the stopped ones
  // and lists the running ones compactly.
  const compact = status.machines.length > 8;
  const tiles = compact ? status.machines.filter((m) => m.state !== "running") : status.machines;
  const chips = compact ? status.machines.filter((m) => m.state === "running") : [];
  const lostMinutes = down.reduce((sum, m) => sum + Math.max(0, now - new Date(m.since!).getTime()) / 60_000, 0);
  return (
    <div className="border-t border-line px-3 pt-3 pb-3 sm:px-4 sm:pb-4">
      {tiles.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {tiles.map((m, i) => (
            <MachineRow key={m.tag} machine={m} now={now} index={i} />
          ))}
        </ul>
      )}
      {chips.length > 0 && (
        <div className={cn(tiles.length > 0 && "mt-3", REVEAL)} style={revealDelay(tiles.length)}>
          <p className="mb-2 text-xs text-fg-subtle">
            {chips.length} running. Tap one to report a breakdown on it.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((m) => (
              <li key={m.tag}>
                <button
                  type="button"
                  onClick={() => reportFor(m.tag)}
                  title={m.equipment_model ?? undefined}
                  aria-label={`Report a breakdown on ${m.tag}`}
                  className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-full bg-surface px-2.5 font-mono text-xs text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-2 hover:text-fg active:scale-[0.97]"
                >
                  <Dot state="running" />
                  <span className="truncate">{m.tag}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div
        style={revealDelay(tiles.length + 1)}
        className={cn("mt-3 flex flex-col gap-1 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:gap-4", REVEAL)}
      >
        <p className="text-pretty">
          A machine counts as stopped from its first open guide until QA releases it. Withdraw a guide that
          isn’t needed.
        </p>
        <p className="flex shrink-0 flex-wrap gap-x-3">
          {down.length > 0 && (
            <span>
              {down.length > 1 ? "Machine time lost so far" : "Out of production so far"}:{" "}
              <span className="tabular font-medium text-fg">
                {lostMinutes < 1 ? "under a minute" : formatDuration(lostMinutes)}
              </span>
            </span>
          )}
          {status.unassigned > 0 && (
            <Link href="/guides/" className="underline decoration-line-strong underline-offset-2 hover:text-fg">
              {plural(status.unassigned, "open guide names", "open guides name")} no machine
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}

const SHELL = "overflow-hidden transition-[opacity,translate] duration-300 ease-out starting:translate-y-1 starting:opacity-0";

/**
 * The plant at a glance, on the breakdown page: how many machines are running, which are
 * stopped and for how long, and which wait for QA to release them. Opens to one row per
 * machine with its guide.
 */
export function PlantStatusBar({ className }: { className?: string }) {
  const { status, error, refresh } = usePlantStatus();
  const now = useNow();
  const panel = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      // Restored after mount so the server render and the first client render agree.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      // No storage: start closed.
    }
  }, []);
  const toggle = () =>
    setOpen((was) => {
      try {
        localStorage.setItem(OPEN_KEY, was ? "0" : "1");
        if (!was) track("plant_status_opened");
      } catch {
        // Not remembered; harmless.
      }
      return !was;
    });

  if (!status) {
    if (error) {
      return (
        <Card className={cn("flex items-center gap-3 px-4 py-3 text-sm", className)} data-tour="plant-status">
          <span className="text-fg-muted">Couldn’t load which machines are running.</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg [&_svg]:size-3.5"
          >
            <RotateCw />
            Retry
          </button>
        </Card>
      );
    }
    return (
      <Card aria-hidden className={cn("flex h-[4.5rem] items-center gap-4 px-4 sm:h-13", className)}>
        <Shimmer className="h-4 w-44" />
        <Shimmer className="hidden h-2 w-40 sm:block" />
        <Shimmer className="ml-auto h-4 w-24" />
      </Card>
    );
  }

  const total = status.machines.length;
  if (!total) {
    return (
      <Card className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm", className)} data-tour="plant-status">
        <span className="font-medium">No machines yet</span>
        <span className="text-fg-muted">Add a manual or a SAP export and each machine shows here.</span>
        <Link
          href="/add/"
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-medium text-accent-text hover:bg-accent-soft [&_svg]:size-3.5"
        >
          <FilePlus2 />
          Add records
        </Link>
      </Card>
    );
  }

  const worst = status.machines[0];
  const longest = worst.state === "stopped" && worst.since ? worst : null;
  const headline: MachineState = status.stopped ? "stopped" : status.awaiting_release ? "awaiting_release" : "running";

  return (
    <Card className={cn(SHELL, className)} data-tour="plant-status">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panel}
        className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2.5 px-4 py-3 text-left transition-[background-color] duration-150 ease-out hover:bg-surface-2/60 sm:flex sm:h-13 sm:py-0"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Dot state={headline} live={headline === "stopped"} />
          <span className="truncate text-sm">
            <span className="tabular font-semibold">
              {status.running} of {total}
            </span>{" "}
            {total === 1 ? "machine" : "machines"} running
          </span>
        </span>
        <span className="flex items-center gap-1 justify-self-end text-[0.8125rem] font-medium text-fg-muted sm:order-last sm:ml-auto">
          <span className="max-sm:sr-only">{open ? "Hide" : "Machines"}</span>
          <ChevronDown
            className={cn(
              "size-4 text-fg-subtle transition-[rotate] duration-200 ease-(--ease-out)",
              open && "rotate-180",
            )}
          />
        </span>
        <span className="col-span-2 flex min-w-0 items-center gap-4 sm:contents">
          <Meter status={status} className="w-full max-w-28 shrink-0 sm:w-40 sm:max-w-none" />
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-fg-muted">
            <Legend status={status} />
          </span>
          {longest && (
            <span className="hidden min-w-0 truncate text-[0.8125rem] text-fg-muted lg:inline">
              <span className="text-fg-subtle">Longest stop</span>{" "}
              <span className="font-mono font-medium text-fg">{longest.tag}</span>{" "}
              <span className="tabular font-medium text-danger-text">{formatSince(longest.since!, now)}</span>
            </span>
          )}
        </span>
      </button>
      {/* Opens and closes on its real height (grid rows 0fr to 1fr), so nothing jumps. */}
      <div
        id={panel}
        inert={!open}
        data-open={open ? "" : undefined}
        className={cn(
          "group/panel grid transition-[grid-template-rows] duration-300 ease-(--ease-drawer)",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <Details status={status} now={now} />
        </div>
      </div>
    </Card>
  );
}
