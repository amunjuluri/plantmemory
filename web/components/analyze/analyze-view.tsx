"use client";

import { useEffect, useRef } from "react";

import { SectionLabel } from "@/components/ui/card";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useAnalysis } from "@/lib/stores/analysis";
import { useRecords } from "@/lib/stores/records";
import { plural } from "@/lib/utils";
import { AgentSteps } from "./agent-steps";
import { ApprovePanel } from "./approve-panel";
import { CauseFlags, NoMatchBanner, RecurrenceBanner } from "./banners";
import { DraftPanel } from "./draft-panel";
import { ErrorState, IdleState, LoadingState } from "./empty-states";
import { IncidentForm } from "./incident-form";
import { SimilarCard } from "./similar-card";

function Results() {
  const { status, original, error, run } = useAnalysis();
  const remember = useRecords((s) => s.remember);

  useEffect(() => {
    if (original) {
      remember(original.similar_incidents.flatMap((m) => (m.record ? [m.record] : [])));
    }
  }, [original, remember]);

  if (status === "idle") return <IdleState />;
  if (status === "running") return <LoadingState />;
  if (status === "error" || !original) {
    return <ErrorState message={error ?? "Something went wrong."} onRetry={run} />;
  }

  const matches = original.similar_incidents;
  return (
    <div className="flex flex-col gap-5">
      {original.no_match && <NoMatchBanner />}
      {original.recurrence_note && <RecurrenceBanner note={original.recurrence_note} />}
      {original.cause_flags.length > 0 && <CauseFlags flags={original.cause_flags} />}

      {matches.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <SectionLabel>Similar past incidents</SectionLabel>
            <span className="text-xs text-fg-subtle">{plural(matches.length, "match", "matches")}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {matches.map((match, i) => (
              <SimilarCard key={match.id} match={match} index={i} />
            ))}
          </div>
        </section>
      )}

      <DraftPanel />
      <ApprovePanel />
    </div>
  );
}

export function AnalyzeView() {
  const stepsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Once per page load: later visits to this tab already have live state (maybe a run).
    if (!useAnalysis.persist.hasHydrated()) void useAnalysis.persist.rehydrate();
  }, []);
  const stacked = useMediaQuery("(max-width: 1023px)");

  // On phones the results sit below the form: bring the agent's progress into view.
  const onStart = () => {
    if (stacked) {
      requestAnimationFrame(() =>
        stepsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
          Has this happened before?
        </h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-muted text-pretty">
          Describe a breakdown, quality problem or deviation. PlantMemory finds how it was handled
          before and drafts a note for you to review.
        </p>
      </header>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 lg:sticky lg:top-20">
          <IncidentForm onStart={onStart} />
          <div ref={stepsRef} className="scroll-mt-20">
            <AgentSteps />
          </div>
        </div>
        <Results />
      </div>
    </div>
  );
}
