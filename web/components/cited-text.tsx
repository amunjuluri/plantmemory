"use client";

import { Fragment } from "react";

import { splitCitations } from "@/lib/citations";
import { useRecords } from "@/lib/stores/records";
import { cn } from "@/lib/utils";

/** A record id as a chip. Hover highlights its card; click opens the record. */
export function CitationChip({ id, className }: { id: string; className?: string }) {
  const { open, highlight } = useRecords();
  return (
    <button
      type="button"
      onClick={() => open(id)}
      onPointerEnter={() => highlight(id)}
      onPointerLeave={() => highlight(null)}
      onFocus={() => highlight(id)}
      onBlur={() => highlight(null)}
      aria-label={`Open record ${id}`}
      className={cn(
        "mx-0.5 inline-flex h-5 translate-y-[-1px] items-center rounded-md bg-accent-soft px-1.5 align-middle font-mono text-[0.6875rem] font-medium text-accent-text",
        "transition-[background-color,scale] duration-150 ease-out hover:bg-accent/15 active:scale-[0.96]",
        className,
      )}
    >
      {id}
    </button>
  );
}

/** Renders text with each [RECORD-ID] turned into a chip. */
export function CitedText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitCitations(text).map((segment, i) =>
        segment.type === "cite" ? (
          <CitationChip key={i} id={segment.id} />
        ) : (
          <Fragment key={i}>{segment.value}</Fragment>
        ),
      )}
    </span>
  );
}
