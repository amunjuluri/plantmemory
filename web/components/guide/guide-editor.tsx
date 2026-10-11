"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { sourceLabel } from "@/components/cited-text";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { api, type Guide, type GuideEdit, type GuideItem, type GuidePartPick, type GuideStep, type Part } from "@/lib/api";
import { useActorName } from "@/lib/stores/session";
import { cn } from "@/lib/utils";

type Line = { text: string; citations: string[]; caution?: string | null; figure_id?: string | null };

const control =
  "h-9 rounded-(--radius-control) bg-surface px-2 text-sm shadow-[inset_0_0_0_1px_var(--color-line-strong)] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-soft)]";

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function Cited({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="text-[0.6875rem] text-fg-subtle">No source: printed as general practice</span>;
  return <span className="text-[0.6875rem] text-fg-subtle">Sources kept: {ids.map(sourceLabel).join(", ")}</span>;
}

function LineEditor({
  label,
  lines,
  onChange,
  figures,
  withCaution,
  numbered,
}: {
  label: string;
  lines: Line[];
  onChange: (lines: Line[]) => void;
  figures?: { id: string; caption: string }[];
  withCaution?: boolean;
  numbered?: boolean;
}) {
  const update = (i: number, patch: Partial<Line>) =>
    onChange(lines.map((line, j) => (j === i ? { ...line, ...patch } : line)));
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>{label}</SectionLabel>
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2 rounded-(--radius-control) bg-surface-2/60 p-2">
          {numbered && (
            <span className="tabular mt-2 grid size-6 shrink-0 place-items-center rounded-full bg-fg text-xs font-semibold text-bg">
              {i + 1}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Textarea
              aria-label={`${label} ${i + 1}`}
              value={line.text}
              onChange={(e) => update(i, { text: e.target.value })}
              className="min-h-10 py-2"
            />
            {withCaution && (
              <Input
                aria-label={`Caution for step ${i + 1}`}
                value={line.caution ?? ""}
                placeholder="Caution (optional)"
                onChange={(e) => update(i, { caution: e.target.value || null })}
                className="h-9 text-sm"
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Cited ids={line.citations} />
              {figures && figures.length > 0 && (
                <select
                  aria-label={`Figure for step ${i + 1}`}
                  value={line.figure_id ?? ""}
                  onChange={(e) => update(i, { figure_id: e.target.value || null })}
                  className={cn(control, "h-8 max-w-56 text-xs")}
                >
                  <option value="">No figure</option>
                  {figures.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.caption.slice(0, 60)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-0.5">
            {numbered && (
              <>
                <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => onChange(move(lines, i, i - 1))}>
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move down"
                  disabled={i === lines.length - 1}
                  onClick={() => onChange(move(lines, i, i + 1))}
                >
                  <ArrowDown />
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => onChange([...lines, { text: "", citations: [], caution: null, figure_id: null }])}
      >
        <Plus />
        Add {label.toLowerCase().replace(/s$/, "")}
      </Button>
    </div>
  );
}

function PartsEditor({
  picks,
  onChange,
  catalog,
}: {
  picks: GuidePartPick[];
  onChange: (picks: GuidePartPick[]) => void;
  catalog: Part[];
}) {
  const available = catalog.filter((p) => !picks.some((x) => x.part_no === p.part_no));
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Parts</SectionLabel>
      {picks.map((pick, i) => {
        const part = catalog.find((p) => p.part_no === pick.part_no);
        return (
          <div key={pick.part_no} className="flex flex-wrap items-center gap-2 rounded-(--radius-control) bg-surface-2/60 p-2">
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-mono text-[0.8125rem] font-medium">{pick.part_no}</span>{" "}
              <span className="text-fg-muted">{part?.name}</span>
            </span>
            <label className="flex items-center gap-1.5 text-xs text-fg-muted">
              Qty
              <input
                type="number"
                min={1}
                max={99}
                value={pick.qty}
                onChange={(e) =>
                  onChange(picks.map((p, j) => (j === i ? { ...p, qty: Math.max(1, Number(e.target.value) || 1) } : p)))
                }
                className={cn(control, "w-16 tabular")}
              />
            </label>
            <Button variant="ghost" size="icon" aria-label={`Remove ${pick.part_no}`} onClick={() => onChange(picks.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </div>
        );
      })}
      {available.length > 0 && (
        <select
          aria-label="Add a part"
          value=""
          onChange={(e) => e.target.value && onChange([...picks, { part_no: e.target.value, qty: 1, why: "" }])}
          className={cn(control, "self-start text-sm")}
        >
          <option value="">+ Add a part from the store…</option>
          {available.map((p) => (
            <option key={p.part_no} value={p.part_no}>
              {p.part_no} · {p.name} ({p.stock_qty} in store)
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

const toLines = (items: (GuideItem | GuideStep)[]): Line[] =>
  items.map((i) => ({
    text: i.text,
    citations: i.citations,
    caution: "caution" in i ? i.caution : null,
    figure_id: "figure_id" in i ? i.figure_id : null,
  }));
const toItems = (lines: Line[]) =>
  lines
    .filter((l) => l.text.trim())
    .map((l) => ({ text: l.text.trim(), citations: l.citations, general: !l.citations.length, flags: [] }));
const toStrings = (lines: Line[]) => lines.map((l) => l.text.trim()).filter(Boolean);

/** Edit a draft or sent-back guide. The server re-checks sources, values, figures and parts. */
export function GuideEditor({ guide, onSaved, onCancel }: { guide: Guide; onSaved: (g: Guide) => void; onCancel: () => void }) {
  const by = useActorName();
  const uid = useId();
  const [title, setTitle] = useState(guide.title);
  const [summary, setSummary] = useState(guide.summary);
  const [safety, setSafety] = useState(toLines(guide.safety));
  const [steps, setSteps] = useState(toLines(guide.steps));
  const [checks, setChecks] = useState(toLines(guide.restart_checks));
  const [escalate, setEscalate] = useState<Line[]>(guide.escalate_if.map((text) => ({ text, citations: [] })));
  const [questions, setQuestions] = useState<Line[]>(guide.open_questions.map((text) => ({ text, citations: [] })));
  const [picks, setPicks] = useState<GuidePartPick[]>(guide.parts.map((p) => ({ part_no: p.part_no, qty: p.qty, why: p.why })));
  const [catalog, setCatalog] = useState<Part[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.parts(guide.asset_tag).then(setCatalog, () => undefined);
  }, [guide.asset_tag]);

  const figures = guide.manual_sections.flatMap((s) =>
    s.figure_ids.map((id) => ({ id, caption: `${s.manual_id} p.${s.page}: ${s.title}` })),
  );

  const save = async () => {
    const body: GuideEdit = {
      by,
      title: title.trim(),
      summary: summary.trim(),
      safety: toItems(safety),
      steps: steps
        .filter((l) => l.text.trim())
        .map((l) => ({
          text: l.text.trim(),
          citations: l.citations,
          general: !l.citations.length,
          flags: [],
          caution: l.caution?.trim() || null,
          figure_id: l.figure_id ?? null,
        })),
      parts: picks,
      restart_checks: toItems(checks),
      escalate_if: toStrings(escalate),
      open_questions: toStrings(questions),
    };
    if (!body.title || !body.steps.length) {
      toast.error("A guide needs a title and at least one step.");
      return;
    }
    setSaving(true);
    try {
      const saved = await api.editGuide(guide.id, body);
      onSaved(saved);
      toast.success("Changes saved", { description: "Sources, values and parts were checked again." });
    } catch (err) {
      toast.error("Couldn’t save", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="flex flex-col gap-6 p-4 sm:p-5">
      <Field label="Title" htmlFor={`${uid}-title`}>
        <Input id={`${uid}-title`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Summary for the manager" htmlFor={`${uid}-summary`}>
        <Textarea id={`${uid}-summary`} value={summary} maxLength={4000} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <LineEditor label="Safety points" lines={safety} onChange={setSafety} />
      <LineEditor label="Steps" lines={steps} onChange={setSteps} figures={figures} withCaution numbered />
      <PartsEditor picks={picks} onChange={setPicks} catalog={catalog} />
      <LineEditor label="Restart checks" lines={checks} onChange={setChecks} />
      <LineEditor label="Call for help if" lines={escalate} onChange={setEscalate} />
      <LineEditor label="Questions for the manager" lines={questions} onChange={setQuestions} />
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] -mx-1 flex justify-end gap-2 rounded-(--radius-card) bg-surface/90 p-2 backdrop-blur-xl md:bottom-4">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} loading={saving}>
          Save changes
        </Button>
      </div>
    </Card>
  );
}
