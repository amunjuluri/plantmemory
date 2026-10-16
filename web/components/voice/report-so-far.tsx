import { Check } from "lucide-react";

import { AutoHeight } from "@/components/ui/auto-height";
import type { IntakeFields, IntakeMode, IntakeTurnResult } from "@/lib/api";
import { cn, formatMinutes } from "@/lib/utils";

type Item = {
  key: keyof IntakeFields;
  label: string;
  /** Asked for until it is given; the others are filled in when mentioned. */
  needed?: boolean;
  /** What to show for a missing optional item. */
  empty?: string;
  show: (f: IntakeFields) => string | null;
  /** Mentioned in passing: shown together on one "Also noted" line, once said. */
  extra?: boolean;
};

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

const ITEMS: Record<IntakeMode, Item[]> = {
  breakdown: [
    { key: "equipment", label: "Machine", needed: true, show: (f) => text(f.equipment) },
    { key: "symptom", label: "Problem", needed: true, show: (f) => text(f.symptom) },
    {
      key: "machine_stopped",
      label: "Stopped?",
      needed: true,
      show: (f) => (f.machine_stopped == null ? null : f.machine_stopped ? "Yes, it has stopped" : "No, still running"),
    },
    { key: "error_code", label: "Alarm", empty: "If one is on the screen", show: (f) => text(f.error_code) },
    { key: "started", label: "Started", extra: true, show: (f) => text(f.started) },
    { key: "product_or_batch", label: "Batch", extra: true, show: (f) => text(f.product_or_batch) },
    { key: "already_tried", label: "Already tried", extra: true, show: (f) => text(f.already_tried) },
  ],
  closure: [
    { key: "action_taken", label: "Work done", needed: true, show: (f) => text(f.action_taken) },
    { key: "parts_used", label: "Parts used", empty: "If any were replaced", show: (f) => text(f.parts_used) },
    {
      key: "downtime_minutes",
      label: "Downtime",
      needed: true,
      show: (f) => (f.downtime_minutes == null ? null : formatMinutes(f.downtime_minutes)),
    },
    {
      key: "outcome",
      label: "Fixed?",
      needed: true,
      show: (f) =>
        f.outcome ? { resolved: "Yes, it’s fixed", recurred: "It came back", unknown: "Not sure yet" }[f.outcome] : null,
    },
    { key: "root_cause", label: "Cause", extra: true, show: (f) => text(f.root_cause) },
  ],
};

type State = "done" | "asking" | "needed" | "optional";

function Mark({ state }: { state: State }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative mt-0.5 grid size-4 shrink-0 place-items-center rounded-full transition-[background-color,box-shadow] duration-300 ease-out",
        state === "done" && "bg-success text-white",
        state === "asking" && "shadow-[inset_0_0_0_2px_var(--color-accent)]",
        state === "needed" && "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]",
        state === "optional" && "shadow-[inset_0_0_0_1.5px_var(--color-line)]",
      )}
    >
      {state === "done" && (
        <Check className="size-2.5 transition-[scale,opacity] duration-200 ease-out starting:scale-50 starting:opacity-0" strokeWidth={3.5} />
      )}
      {state === "asking" && (
        <>
          <span className="absolute inset-0 rounded-full bg-accent/30" style={{ animation: "ping-soft 1.6s var(--ease-out) infinite" }} />
          <span className="size-1.5 rounded-full bg-accent" />
        </>
      )}
    </span>
  );
}

/**
 * What the spoken report holds so far, as a labelled checklist: each item with its full
 * value, what is still needed, what the assistant is asking about now, and what is
 * optional. Details mentioned in passing (when it started, the batch) appear too.
 */
export function ReportSoFar({
  mode,
  result,
  live,
}: {
  mode: IntakeMode;
  result: IntakeTurnResult | null;
  /** The conversation is on, so the first missing item is the one being asked about. */
  live: boolean;
}) {
  const fields = result?.state.fields ?? {};
  const missing = new Set(result?.missing ?? []);
  const asking = live && result && !result.done ? result.missing[0] : live && !result ? ITEMS[mode][0].key : null;
  const items = ITEMS[mode].filter((item) => !item.extra);
  const also = ITEMS[mode]
    .filter((item) => item.extra)
    .flatMap((item) => {
      const value = item.show(fields as IntakeFields);
      if (!value) return [];
      // "Batch B-2241" needs no "Batch:" in front.
      return [value.toLowerCase().startsWith(item.label.toLowerCase()) ? value : `${item.label}: ${value}`];
    })
    .join(" · ");
  const required = items.filter((item) => item.needed || missing.has(item.key));
  const have = required.filter((item) => item.show(fields as IntakeFields)).length;
  const complete = Boolean(result?.done);

  return (
    <section
      aria-label="The report so far"
      className="rounded-xl bg-surface-2/70 px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-fg-muted">Report so far</span>
        <span
          key={complete ? "complete" : have}
          className={cn(
            "tabular transition-opacity duration-200 ease-out starting:opacity-0",
            complete ? "font-medium text-success-text" : "text-fg-subtle",
          )}
          aria-live="polite"
        >
          {complete ? "Complete, check it" : `${have} of ${required.length} needed`}
        </span>
      </div>
      {/* A longer answer or a new line grows the list smoothly instead of jumping. */}
      <AutoHeight>
        <dl className="flex flex-col">
          {items.map((item) => {
            const value = item.show(fields as IntakeFields);
            const state: State = value
              ? "done"
              : item.key === asking
                ? "asking"
                : item.needed || missing.has(item.key)
                  ? "needed"
                  : "optional";
            return (
              <div key={item.key} className="flex gap-2.5 py-1">
                <Mark state={state} />
                <dt className="w-[5.25rem] shrink-0 text-[0.8125rem] leading-5 text-fg-muted">{item.label}</dt>
                <dd
                  key={value ?? state}
                  title={value ?? undefined}
                  className={cn(
                    "indic min-w-0 flex-1 text-[0.8125rem] leading-5 transition-[opacity,translate] duration-250 ease-out starting:translate-x-1 starting:opacity-0",
                    value ? "line-clamp-3 font-medium text-fg" : "truncate",
                    state === "asking" && "font-medium text-accent-text",
                    (state === "needed" || state === "optional") && "text-fg-subtle",
                  )}
                >
                  {value ?? (state === "asking" ? "Asking now…" : state === "needed" ? "Needed" : (item.empty ?? "Optional"))}
                </dd>
              </div>
            );
          })}
          {/* Opens on its height when something is mentioned in passing. */}
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-300 ease-(--ease-drawer)",
              also ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="flex gap-2.5 py-1">
                <span aria-hidden className="mt-0.5 size-4 shrink-0" />
                <dt className="w-[5.25rem] shrink-0 text-[0.8125rem] leading-5 text-fg-muted">Also noted</dt>
                <dd
                  key={also}
                  title={also || undefined}
                  className="indic line-clamp-2 min-w-0 flex-1 text-[0.8125rem] leading-5 text-fg transition-[opacity,translate] duration-250 ease-out starting:translate-x-1 starting:opacity-0"
                >
                  {also}
                </dd>
              </div>
            </div>
          </div>
        </dl>
      </AutoHeight>
    </section>
  );
}
