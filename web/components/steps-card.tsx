"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import type { StepState, StepStatus } from "@/lib/stores/breakdown";
import { cn } from "@/lib/utils";

function StepIcon({ status }: { status: StepStatus }) {
  return (
    <span
      className={cn(
        "relative grid size-5 shrink-0 place-items-center rounded-full transition-[background-color,box-shadow] duration-200 ease-out",
        status === "pending" && "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]",
        status === "active" && "shadow-[inset_0_0_0_1.5px_var(--color-accent-soft)]",
        status === "done" && "bg-accent text-accent-fg",
        status === "error" && "bg-danger text-white",
      )}
    >
      {status === "active" && (
        <span className="absolute inset-0 animate-spin-fast rounded-full border-[1.5px] border-accent border-r-transparent" />
      )}
      {status === "done" && <Check className="size-3 transition-[scale,opacity] duration-200 ease-out starting:scale-50 starting:opacity-0" strokeWidth={3} />}
      {status === "error" && <X className="size-3" strokeWidth={3} />}
    </span>
  );
}

function useElapsed(startedAt: number | null, finishedAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || finishedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [startedAt, finishedAt]);
  if (!startedAt) return null;
  return Math.max(0, ((finishedAt ?? now) - startedAt) / 1000);
}

/** Live view of a multi-step AI run: each step's status and a one-line result. */
export function StepsCard<Id extends string>({
  steps: list,
  state: steps,
  status,
  startedAt,
  finishedAt,
}: {
  steps: { id: Id; label: string }[];
  state: Record<Id, StepState>;
  status: "idle" | "running" | "done" | "error";
  startedAt: number | null;
  finishedAt: number | null;
}) {
  const elapsed = useElapsed(startedAt, finishedAt);
  if (status === "idle") return null;

  return (
    <Card className="p-4 sm:p-5" aria-live="polite">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium">
          {status === "running" ? "Working on it" : status === "done" ? "Done" : "Stopped"}
        </h2>
        {elapsed !== null && (
          <span className="tabular text-xs text-fg-subtle">{elapsed.toFixed(1)}s</span>
        )}
      </div>
      <ol className="flex flex-col">
        {list.map((step, i) => {
          const state = steps[step.id];
          return (
            <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < list.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-6 bottom-1 left-[9.5px] w-px transition-[background-color] duration-300 ease-out",
                    state.status === "done" ? "bg-accent/40" : "bg-line-strong",
                  )}
                />
              )}
              <StepIcon status={state.status} />
              <div className="min-w-0 -translate-y-px">
                <p
                  className={cn(
                    "text-sm transition-[color] duration-200 ease-out",
                    state.status === "pending" ? "text-fg-subtle" : "text-fg",
                  )}
                >
                  {step.label}
                </p>
                {(state.summary || state.detail) && (
                  <p
                    className={cn(
                      "mt-0.5 text-[0.8125rem] transition-[opacity,translate] duration-250 ease-out starting:-translate-y-0.5 starting:opacity-0",
                      state.status === "error" ? "text-danger-text" : "text-fg-muted",
                    )}
                  >
                    {state.summary ?? state.detail}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
