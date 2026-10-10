"use client";

import { Check, Copy, Pencil, Plus, RotateCcw, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CitationChip, CitedText } from "@/components/cited-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import type { Draft, DraftItem } from "@/lib/api";
import { splitCitations } from "@/lib/citations";
import { useAnalysis } from "@/lib/stores/analysis";
import { cn } from "@/lib/utils";

type ItemKey = "suggested_checks" | "suggested_actions";

const SECTIONS: { key: ItemKey; label: string; empty: string }[] = [
  { key: "suggested_checks", label: "Checks to do first", empty: "No checks suggested." },
  { key: "suggested_actions", label: "Suggested actions", empty: "No actions suggested." },
];

/** Citations listed on an item that its text doesn't already show inline. */
function extraCitations(item: DraftItem): string[] {
  const inline = new Set(
    splitCitations(item.text).flatMap((s) => (s.type === "cite" ? [s.id] : [])),
  );
  return (item.citations ?? []).filter((id) => !inline.has(id));
}

function ItemView({ item, index }: { item: DraftItem; index: number }) {
  return (
    <li className="flex gap-3">
      <span className="tabular mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[0.6875rem] font-semibold text-fg-muted">
        {index + 1}
      </span>
      <div className="min-w-0 text-[0.9375rem] leading-6">
        <CitedText text={item.text} />
        {extraCitations(item).map((id) => (
          <CitationChip key={id} id={id} />
        ))}
        {item.general && (
          <Badge className="ml-1.5 h-5 translate-y-[-1px] align-middle">General advice</Badge>
        )}
      </div>
    </li>
  );
}

function ItemEditor({
  items,
  onChange,
  addLabel,
}: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
  addLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <Textarea
            aria-label={`${addLabel} ${i + 1}`}
            value={item.text}
            onChange={(e) =>
              onChange(items.map((it, j) => (j === i ? { ...it, text: e.target.value } : it)))
            }
            className="min-h-10 py-2"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => onChange([...items, { text: "", citations: [], general: true }])}
      >
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

function asMarkdown(draft: Draft): string {
  const list = (items: DraftItem[]) => items.map((i) => `- ${i.text}`).join("\n");
  return [
    `# Draft note: ${draft.incident.area_or_equipment}`,
    draft.summary,
    draft.recurrence_note && `**Repeat:** ${draft.recurrence_note}`,
    draft.suggested_checks.length && `## Checks\n${list(draft.suggested_checks)}`,
    draft.suggested_actions.length && `## Actions\n${list(draft.suggested_actions)}`,
    draft.open_questions.length && `## Open questions\n${draft.open_questions.map((q) => `- ${q}`).join("\n")}`,
    `_${draft.review_notice}_`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function DraftPanel() {
  const { draft, edited, approvedId, editDraft, revertDraft } = useAnalysis();
  const [editing, setEditing] = useState(false);
  if (!draft) return null;

  const locked = approvedId !== null;
  const cleanItems = (items: DraftItem[]) => items.filter((i) => i.text.trim());

  const finishEditing = () => {
    editDraft((d) => ({
      ...d,
      summary: d.summary.trim(),
      suggested_checks: cleanItems(d.suggested_checks),
      suggested_actions: cleanItems(d.suggested_actions),
      open_questions: d.open_questions.map((q) => q.trim()).filter(Boolean),
    }));
    setEditing(false);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(asMarkdown(draft));
    toast.success("Draft copied", { description: "Paste it into a report or message." });
  };

  return (
    <Card className="overflow-hidden transition-[opacity,translate] duration-250 ease-out starting:translate-y-2 starting:opacity-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="font-semibold tracking-tight">Draft note</h2>
        {locked ? (
          <Badge tone="success">
            <Check />
            Approved
          </Badge>
        ) : (
          <Badge tone="warn">Needs review</Badge>
        )}
        {edited && !locked && <Badge>Edited</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {edited && !locked && !editing && (
            <Button variant="ghost" size="sm" onClick={revertDraft}>
              <RotateCcw />
              Undo edits
            </Button>
          )}
          {!locked &&
            (editing ? (
              <Button variant="primary" size="sm" onClick={finishEditing}>
                <Check />
                Done
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
            ))}
          {!editing && (
            <Button variant="ghost" size="icon" aria-label="Copy draft" onClick={copy}>
              <Copy />
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6 p-4 sm:p-5">
        <section className="flex flex-col gap-2">
          <SectionLabel>Summary</SectionLabel>
          {editing ? (
            <Textarea
              aria-label="Summary"
              value={draft.summary}
              onChange={(e) => editDraft((d) => ({ ...d, summary: e.target.value }))}
            />
          ) : (
            <p className="text-[0.9375rem] leading-7 text-pretty">
              <CitedText text={draft.summary} />
            </p>
          )}
        </section>

        {SECTIONS.map(({ key, label, empty }) => (
          <section key={key} className="flex flex-col gap-3">
            <SectionLabel>{label}</SectionLabel>
            {editing ? (
              <ItemEditor
                items={draft[key]}
                addLabel={key === "suggested_checks" ? "Add check" : "Add action"}
                onChange={(items) => editDraft((d) => ({ ...d, [key]: items }))}
              />
            ) : draft[key].length ? (
              <ol className="flex flex-col gap-3">
                {draft[key].map((item, i) => (
                  <ItemView key={i} item={item} index={i} />
                ))}
              </ol>
            ) : (
              <p className="text-sm text-fg-subtle">{empty}</p>
            )}
          </section>
        ))}

        {(draft.open_questions.length > 0 || editing) && (
          <section className="flex flex-col gap-3">
            <SectionLabel>Still to find out</SectionLabel>
            {editing ? (
              <ItemEditor
                items={draft.open_questions.map((text) => ({ text, citations: [], general: true }))}
                addLabel="Add question"
                onChange={(items) => editDraft((d) => ({ ...d, open_questions: items.map((i) => i.text) }))}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {draft.open_questions.map((question, i) => (
                  <li key={i} className="flex gap-3 text-[0.9375rem] leading-6">
                    <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-fg-subtle" />
                    <CitedText text={question} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <p
        className={cn(
          "flex items-start gap-2 border-t border-line bg-surface-2 px-4 py-3 text-[0.8125rem] text-fg-muted sm:px-5",
        )}
      >
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        {draft.review_notice}
      </p>
    </Card>
  );
}
