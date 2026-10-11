"use client";

import { Fragment } from "react";

import { splitCitations } from "@/lib/citations";
import { isManualId, useRecords } from "@/lib/stores/records";
import { cn } from "@/lib/utils";

/** "MAN-RTP37-16" -> "Manual p.16"; incident ids stay as they are. A guide uses one
 * machine's manual, so the page is enough; the manual's own code (RTP37) reads like a
 * machine tag and confused managers who had said TP-01. */
export function sourceLabel(id: string): string {
  const match = id.match(/^MAN-(.+)-(\d+)([A-Z]?)$/);
  return match ? `Manual p.${match[2]}` : id;
}

/** A record id or manual section as a chip. Hover highlights its card; click opens it. */
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
      aria-label={isManualId(id) ? `Open manual ${sourceLabel(id)}` : `Open record ${id}`}
      className={cn(
        "mx-0.5 inline-flex h-5 translate-y-[-1px] items-center rounded-md px-1.5 align-middle font-mono text-[0.6875rem] font-medium",
        isManualId(id) ? "bg-surface-3 text-fg-muted" : "bg-accent-soft text-accent-text",
        "transition-[background-color,scale,color] duration-150 ease-out hover:bg-accent/15 hover:text-accent-text active:scale-[0.96]",
        className,
      )}
    >
      {sourceLabel(id)}
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
