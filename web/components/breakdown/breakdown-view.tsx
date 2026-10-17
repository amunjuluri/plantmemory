"use client";

import { MessageCircleQuestion, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { GuideView } from "@/components/guide/guide-view";
import { PlantStatusBar } from "@/components/plant/plant-status";
import { StepsCard } from "@/components/steps-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DraftingLoader } from "@/components/ui/loaders";
import { ErrorState, Shimmer } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { GUIDE_STEPS, useBreakdown } from "@/lib/stores/breakdown";
import { refreshPlant } from "@/lib/stores/plant";
import { useActorName } from "@/lib/stores/session";
import { cn, plural } from "@/lib/utils";
import { BreakdownForm } from "./breakdown-form";

/** What happens from here, with the measured time of each AI step. */
const FLOW = [
  {
    title: "Describe it",
    time: null,
    body: "Type it, say it in any Indian language, or start from a logbook photo or the machine’s alarm log.",
  },
  {
    title: "Get a checked repair guide",
    time: "about 10 s",
    body: "Steps from the manual and past fixes, each citing its source. Parts and stock from the store, time from past repairs.",
  },
  {
    title: "Approve and print for the crew",
    time: "about 5 s",
    body: "You approve it; QA checks only when code finds a reason. One A4 sheet in English and your crew’s languages.",
  },
  {
    title: "Close it, QA releases the machine",
    time: null,
    body: "Say what was done. It’s saved to plant memory, so the next breakdown like it is quicker to fix.",
  },
];

function Idle() {
  const [counts, setCounts] = useState<{ incidents: number; manuals: number } | null>(null);
  useEffect(() => {
    Promise.all([api.incidents({ limit: 1 }), api.manuals()])
      .then(([page, manuals]) => setCounts({ incidents: page.total, manuals: manuals.length }))
      .catch(() => undefined);
  }, []);
  return (
    <div className="flex flex-col gap-5 rounded-(--radius-card) border border-dashed border-line-strong p-5 sm:p-7" data-tour="flow">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">From breakdown to a printed fix</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {counts
            ? `Searching ${plural(counts.incidents, "past incident")} and ${plural(counts.manuals, "equipment manual")}.`
            : "Searching your plant’s past incidents and equipment manuals."}
        </p>
      </div>
      <ol className="flex flex-col">
        {FLOW.map((step, i) => (
          <li
            key={step.title}
            style={{ transitionDelay: `${i * 60}ms` }}
            className="relative flex gap-3.5 pb-5 transition-[opacity,translate] duration-300 ease-out last:pb-0 starting:translate-y-1 starting:opacity-0"
          >
            {i < FLOW.length - 1 && (
              <span aria-hidden className="absolute top-8 bottom-1.5 left-[13.5px] w-px bg-line-strong" />
            )}
            <span className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">
              {i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
                {step.title}
                {step.time && <span className="tabular text-xs font-normal text-fg-subtle">{step.time}</span>}
              </p>
              <p className="mt-0.5 text-[0.8125rem] leading-5 text-fg-muted text-pretty">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** While drafting, the live steps sit beside the form (not under it, below the fold). */
function Loading() {
  const { steps, startedAt, finishedAt } = useBreakdown();
  return (
    <div className="flex flex-col gap-4 transition-[opacity,translate] duration-300 ease-out starting:translate-y-1 starting:opacity-0">
      <div data-tour="drafting">
        <StepsCard
          steps={GUIDE_STEPS}
          state={steps}
          status="running"
          startedAt={startedAt}
          finishedAt={finishedAt}
          title="Drafting the repair guide"
        >
          <DraftingLoader className="mx-auto mb-4 h-24" />
        </StepsCard>
      </div>
      <div className="flex flex-col gap-4" aria-hidden>
        <Shimmer className="h-6 w-2/3" />
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="flex flex-col gap-2 p-3.5">
              <Shimmer className="h-3 w-20" />
              <Shimmer className="h-5 w-16" />
            </Card>
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <Card key={i} className="flex gap-3 p-4">
            <Shimmer className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Shimmer className="h-3 w-full" />
              <Shimmer className="h-3 w-3/4" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Edit the report: the cursor goes to the end of what's there. */
function editReport() {
  const box = document.getElementById("breakdown") as HTMLTextAreaElement | null;
  if (!box) return;
  box.focus({ preventScroll: true });
  box.setSelectionRange(box.value.length, box.value.length);
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** One question before drafting, instead of a guide for the wrong machine or a guess. */
function ClarifyCard() {
  const { clarify, assetTag, setAssetTag, run } = useBreakdown();
  const by = useActorName();
  if (!clarify) return null;
  const choose = (tag: string) => {
    setAssetTag(tag);
    void run(by, true);
  };
  const only = clarify.machines.length === 1 ? clarify.machines[0] : null;
  return (
    <Card className="flex flex-col gap-4 p-5 transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
          <MessageCircleQuestion className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-pretty" role="status">
            {clarify.question}
          </p>
          <p className="mt-1 text-sm text-fg-muted text-pretty">
            {clarify.machines.length > 1
              ? "Pick one and the guide is drafted for it. A guide for the wrong machine is worse than a question."
              : only
                ? "Or change the machine in the form and draft again."
                : "Add it to the report and draft again. A guide needs to know what failed, not just that something did."}
          </p>
        </div>
      </div>
      {clarify.machines.length > 1 && (
        <div role="group" aria-label="Machines" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {clarify.machines.map((m) => (
            <button
              key={m.tag}
              type="button"
              onClick={() => choose(m.tag)}
              className={cn(
                "flex min-h-12 flex-col items-start justify-center rounded-lg px-3 py-2 text-left transition-[background-color,scale] duration-150 ease-out active:scale-[0.98]",
                m.tag === assetTag
                  ? "bg-surface-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-surface-3"
                  : "bg-surface-2 hover:bg-surface-3",
              )}
            >
              <span className="text-sm font-medium">
                {m.tag}
                {m.tag === assetTag && <span className="ml-1.5 text-xs font-normal text-fg-subtle">picked</span>}
              </span>
              <span className="text-xs text-fg-muted">{m.equipment_model}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {only && (
          <Button size="sm" variant="primary" onClick={() => choose(only.tag)}>
            Draft for {only.tag} anyway
          </Button>
        )}
        <Button size="sm" variant={only || clarify.machines.length ? "ghost" : "secondary"} onClick={editReport}>
          <PenLine />
          Edit the report
        </Button>
      </div>
    </Card>
  );
}

function Results() {
  const { status, guide, error, run, setGuide } = useBreakdown();
  const by = useActorName();
  if (status === "clarify") return <ClarifyCard />;
  if (status === "idle" && !guide) return <Idle />;
  if (status === "running") return <Loading />;
  if (status === "error" || !guide) {
    return (
      <ErrorState
        title="The guide couldn’t be drafted"
        message={error ?? "Something went wrong."}
        onRetry={() => void run(by)}
      />
    );
  }
  return <GuideView guide={guide} onChange={setGuide} />;
}

export function BreakdownView() {
  const resultsRef = useRef<HTMLDivElement>(null);
  const { steps, status, startedAt, finishedAt } = useBreakdown();
  useEffect(() => {
    // Once per page load: later visits to this tab already have live state (maybe a run).
    if (!useBreakdown.persist.hasHydrated()) void useBreakdown.persist.rehydrate();
  }, []);
  const stacked = useMediaQuery("(max-width: 1023px)");
  // A new guide means a machine has stopped.
  useEffect(() => {
    if (status === "done") refreshPlant();
  }, [status]);

  const onStart = () => {
    if (stacked) {
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PlantStatusBar />
      <header className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">A machine has stopped?</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-muted text-pretty">
          Describe it, or say it in your language. PlantMemory drafts a repair guide from past fixes and the
          equipment manual, with parts and time, for you to approve and the workers to follow.
        </p>
      </header>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 lg:sticky lg:top-20">
          <BreakdownForm onStart={onStart} />
          {status !== "running" && status !== "clarify" && (
            <StepsCard
              steps={GUIDE_STEPS}
              state={steps}
              status={status}
              startedAt={startedAt}
              finishedAt={finishedAt}
            />
          )}
        </div>
        <div ref={resultsRef} className="min-w-0 scroll-mt-20">
          <Results />
        </div>
      </div>
    </div>
  );
}
