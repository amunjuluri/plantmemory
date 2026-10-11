"use client";

import { BookOpen, Languages, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { GuideView } from "@/components/guide/guide-view";
import { StepsCard } from "@/components/steps-card";
import { Card } from "@/components/ui/card";
import { DraftingLoader } from "@/components/ui/loaders";
import { ErrorState, Shimmer } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { GUIDE_STEPS, useBreakdown } from "@/lib/stores/breakdown";
import { useActorName } from "@/lib/stores/session";
import { BreakdownForm } from "./breakdown-form";

const POINTS = [
  {
    icon: BookOpen,
    title: "Past fixes and the manual, together",
    body: "Finds how this was fixed before, even if it was written differently or in another language, and the manual’s procedure for the alarm.",
  },
  {
    icon: ShieldCheck,
    title: "Checked before anyone acts",
    body: "Every step cites its source. Values not in the manual are flagged. Parts and time come from the store and past downtime.",
  },
  {
    icon: Languages,
    title: "Approved, printed in their language",
    body: "You check and approve it (QA steps in when something needs a check), then print a controlled copy in English, Telugu and Hindi with the manual’s figures.",
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
    <div className="flex flex-col gap-6 rounded-(--radius-card) border border-dashed border-line-strong p-6 sm:p-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">From breakdown to a printed fix</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {counts
            ? `Searching ${counts.incidents} past incidents and ${counts.manuals} equipment manuals.`
            : "Searching your plant’s past incidents and equipment manuals."}
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {POINTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex flex-col gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-text">
              <Icon className="size-4" />
            </span>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-[0.8125rem] leading-5 text-fg-muted">{body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Loading() {
  const steps = useBreakdown((s) => s.steps);
  const active = GUIDE_STEPS.filter((step) => steps[step.id].status === "active").map((step) => step.label);
  const line = active.length ? `${active.join(" · ")}…` : "Starting…";
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <DraftingLoader className="h-28" />
        <div>
          <p className="text-sm font-medium">Drafting the repair guide</p>
          <p
            key={line}
            className="mt-0.5 text-[0.8125rem] text-fg-muted transition-[opacity,translate] duration-250 ease-out starting:translate-y-1 starting:opacity-0"
          >
            {line}
          </p>
        </div>
      </Card>
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

function Results() {
  const { status, guide, error, run, setGuide } = useBreakdown();
  const by = useActorName();
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
  const stepsRef = useRef<HTMLDivElement>(null);
  const { steps, status, startedAt, finishedAt } = useBreakdown();
  useEffect(() => {
    // Once per page load: later visits to this tab already have live state (maybe a run).
    if (!useBreakdown.persist.hasHydrated()) void useBreakdown.persist.rehydrate();
  }, []);
  const stacked = useMediaQuery("(max-width: 1023px)");

  const onStart = () => {
    if (stacked) {
      requestAnimationFrame(() => stepsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  return (
    <div className="flex flex-col gap-6">
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
          <div ref={stepsRef} className="scroll-mt-20">
            <StepsCard
              steps={GUIDE_STEPS}
              state={steps}
              status={status}
              startedAt={startedAt}
              finishedAt={finishedAt}
            />
          </div>
        </div>
        <Results />
      </div>
    </div>
  );
}
