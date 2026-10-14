"use client";

import { AlertTriangle, Check, FilePenLine, Keyboard } from "lucide-react";
import { useLayoutEffect, useRef, useState, type Ref } from "react";

import { Badge } from "@/components/ui/badge";
import { VoiceIcon } from "@/components/voice/icons";
import { cn, plural } from "@/lib/utils";
import type { Ask, Revision } from "./revision";

function languageName(code: string | null): string | null {
  if (!code || code === "en") return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A request as said, clamped to three lines when long, with a way to read all of it. */
function Said({ ask }: { ask: Ask }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [ask.transcript, open]);
  const language = languageName(ask.language);
  return (
    <div className="min-w-0 flex-1 text-fg-muted">
      <span className="sr-only">{ask.voice ? "You said" : "You typed"}: </span>
      <span ref={ref} className={cn("indic text-fg [overflow-wrap:anywhere]", open ? "block" : "line-clamp-3")}>
        “{ask.transcript}”
      </span>
      {(language || long) && (
        <span className="mt-1 flex flex-wrap items-center gap-2">
          {language && <Badge className="h-5">{language}</Badge>}
          {long && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="rounded text-xs font-medium text-accent-text hover:underline"
            >
              {open ? "Show less" : "Show all"}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** What the manager asked for and what each request changed, above the guide with the
 * changes marked. */
export function RevisionSummary({
  revision,
  count,
  ref,
}: {
  revision: Revision;
  count: number;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <section
      ref={ref}
      aria-labelledby="revision-title"
      className="scroll-mt-24 overflow-hidden rounded-(--radius-card) bg-surface shadow-[0_0_0_1.5px_var(--color-accent),var(--shadow-card)] transition-[opacity,translate] duration-250 ease-out starting:translate-y-1.5 starting:opacity-0"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-accent-soft px-4 py-2.5">
        <FilePenLine className="size-4 shrink-0 text-accent-text" />
        <h3 id="revision-title" className="text-sm font-semibold text-accent-text">
          Proposed {count === 1 ? "change" : "changes"}
        </h3>
        <span className="text-[0.8125rem] text-fg-muted">Not saved until you keep {count === 1 ? "it" : "them"}</span>
        <span className="tabular ml-auto text-xs font-medium text-accent-text">{plural(count, "change")}</span>
      </header>

      <div className="flex flex-col gap-3.5 p-4">
        <ol className="flex flex-col gap-3.5">
          {revision.asks.map((ask, i) => (
            <li key={i} className="flex flex-col gap-2">
              <div className="flex items-start gap-2.5 text-[0.8125rem] leading-5">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-subtle [&_svg]:size-3">
                  {ask.voice ? <VoiceIcon /> : <Keyboard />}
                </span>
                <Said ask={ask} />
              </div>
              {ask.changes.length > 0 && (
                <ul className="flex flex-col gap-1.5 pl-7.5">
                  {ask.changes.map((change, j) => (
                    <li key={j} className="flex items-start gap-2 text-[0.875rem] leading-5">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-success-text" strokeWidth={2.5} />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{change}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>

        {revision.warnings.length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-lg bg-warn-soft px-3 py-2.5">
            {revision.warnings.map((warning, i) => (
              <li key={i} className="flex items-start gap-2 text-[0.8125rem] leading-5 text-warn-text">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{warning}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-xs text-fg-subtle">
          Marked in the guide below:
          <Badge tone="success" className="h-5">
            New
          </Badge>
          <Badge tone="accent" className="h-5">
            Changed
          </Badge>
          <Badge tone="danger" className="h-5">
            Removed
          </Badge>
          Every line is checked again against the manual and past fixes.
        </p>
      </div>
    </section>
  );
}
