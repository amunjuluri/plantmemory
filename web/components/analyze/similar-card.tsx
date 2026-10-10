"use client";

import { Sparkles } from "lucide-react";

import { OutcomeBadge, RecordId } from "@/components/incident-meta";
import type { SimilarIncident } from "@/lib/api";
import { useRecords } from "@/lib/stores/records";
import { cn, formatDate, percent } from "@/lib/utils";

function MatchMeter({ score }: { score: number }) {
  const value = percent(score);
  return (
    <div className="flex items-center gap-2" aria-label={`${value}% match`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${value}%` }} />
      </span>
      <span className="tabular text-xs font-medium text-fg">{value}%</span>
    </div>
  );
}

export function SimilarCard({ match, index }: { match: SimilarIncident; index: number }) {
  const { open, highlightId } = useRecords();
  const record = match.record;
  const highlighted = highlightId === match.id;
  if (!record) return null;

  return (
    <button
      type="button"
      onClick={() => open(match.id)}
      style={{ transitionDelay: `${index * 50}ms` }}
      className={cn(
        "group flex w-full min-w-0 flex-col gap-3 rounded-(--radius-card) bg-surface p-4 text-left shadow-card",
        "transition-[box-shadow,opacity,translate,scale] duration-250 ease-out starting:translate-y-2 starting:opacity-0",
        "hover:shadow-raised active:scale-[0.99]",
        highlighted && "shadow-[0_0_0_2px_var(--color-accent),0_4px_12px_-4px_var(--color-accent-soft)]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <RecordId id={match.id} />
          <span className="text-fg-subtle">·</span>
          <span className="truncate text-xs text-fg-muted">{formatDate(record.date)}</span>
        </div>
        <MatchMeter score={match.score} />
      </div>
      <div className="min-w-0">
        <h3 className="truncate font-medium">{record.area_or_equipment}</h3>
        <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-5 text-fg-muted">{record.description}</p>
      </div>
      {match.why && (
        <p className="flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[0.8125rem] leading-5 text-fg">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent-text" />
          <span>{match.why}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <OutcomeBadge outcome={record.outcome} />
        {record.root_cause && (
          <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">Cause: {record.root_cause}</span>
        )}
      </div>
    </button>
  );
}
