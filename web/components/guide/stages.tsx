import { Check } from "lucide-react";

import type { Guide } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tone = "done" | "now" | "wait" | "back" | "todo";

/** The guide's whole life, so nothing after approval is missed: printing, closing with
 * what was done, and QA's release. */
function stages(guide: Guide): { label: string; tone: Tone }[] {
  const s = guide.status;
  const printed = guide.copies_printed > 0;
  // How many stages are complete.
  const done = { draft: 1, rejected: 1, in_review: 1, approved: printed ? 3 : 2, closed: 4, released: 5, withdrawn: 0 }[s];
  const approval = s === "in_review" ? "With QA" : s === "rejected" ? "Sent back" : "Approved";
  const labels = ["Drafted", approval, "Printed", "Repaired", "Released"];
  return labels.map((label, i) => ({
    label,
    tone:
      i < done
        ? "done"
        : i > done
          ? "todo"
          : s === "in_review"
            ? "wait"
            : s === "rejected"
              ? "back"
              : "now",
  }));
}

const DOT: Record<Tone, string> = {
  done: "bg-accent text-accent-fg",
  now: "bg-surface shadow-[inset_0_0_0_2px_var(--color-accent),0_0_0_3px_var(--color-accent-soft)]",
  wait: "bg-surface shadow-[inset_0_0_0_2px_var(--color-warn),0_0_0_3px_var(--color-warn-soft)]",
  back: "bg-surface shadow-[inset_0_0_0_2px_var(--color-danger),0_0_0_3px_var(--color-danger-soft)]",
  todo: "bg-surface shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]",
};

const LABEL: Record<Tone, string> = {
  done: "text-fg-muted",
  now: "font-medium text-accent-text",
  wait: "font-medium text-warn-text",
  back: "font-medium text-danger-text",
  todo: "text-fg-subtle",
};

/** Where the guide stands, from draft to release, as a compact track. */
export function GuideStages({ guide, className }: { guide: Guide; className?: string }) {
  if (guide.status === "withdrawn") return null;
  const list = stages(guide);
  const current = list.findIndex((s) => s.tone !== "done");
  return (
    <ol
      aria-label="Where this guide stands"
      className={cn("grid grid-cols-5", className)}
      data-tour="guide-stages"
    >
      {list.map((stage, i) => (
        <li
          key={i}
          aria-current={i === current ? "step" : undefined}
          className="relative flex flex-col items-center gap-1.5 text-center"
        >
          {i > 0 && (
            <span
              aria-hidden
              className={cn(
                "absolute top-[7px] right-[calc(50%+12px)] left-[calc(-50%+12px)] h-0.5 rounded-full transition-[background-color] duration-300 ease-out",
                current === -1 || i <= current ? "bg-accent/45" : "bg-line-strong",
              )}
            />
          )}
          <span
            className={cn(
              "relative grid size-4 place-items-center rounded-full transition-[background-color,box-shadow] duration-300 ease-out",
              DOT[stage.tone],
            )}
          >
            {stage.tone === "done" && <Check className="size-2.5" strokeWidth={3.5} />}
          </span>
          <span className={cn("text-[0.6875rem] leading-4 sm:text-xs", LABEL[stage.tone])}>
            {stage.label}
            <span className="sr-only">{stage.tone === "done" ? ", done" : i === current ? ", now" : ""}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
