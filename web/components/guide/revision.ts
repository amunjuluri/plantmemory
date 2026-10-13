import type { Guide, GuideEdit, GuideItem, GuidePart, GuideStep } from "@/lib/api";
import { countChanges, diffRows, sameRows, type Row } from "@/lib/diff";

/** One thing the manager asked for while changing the guide, and what it changed. */
export type Ask = { transcript: string; language: string | null; voice: boolean; changes: string[] };

/** A proposed change the manager has not kept or discarded yet. */
export type Revision = { proposal: Guide; warnings: string[]; asks: Ask[] };

export type GuideDiff = {
  title: boolean;
  summary: boolean;
  safety: Row<GuideItem>[];
  steps: Row<GuideStep>[];
  parts: Row<GuidePart>[];
  checks: Row<GuideItem>[];
  escalate: Row<string>[];
  questions: Row<string>[];
  count: number;
};

const text = (i: { text: string }) => i.text.trim();
const str = (s: string) => s.trim();

/** Every difference between the saved guide and a proposal, list by list. */
export function diffGuide(before: Guide, after: Guide): GuideDiff {
  const lists = {
    safety: diffRows(before.safety, after.safety, text),
    steps: diffRows(
      before.steps,
      after.steps,
      text,
      (a, b) => (a.caution ?? "") === (b.caution ?? "") && (a.figure_id ?? "") === (b.figure_id ?? ""),
    ),
    parts: diffRows(
      before.parts,
      after.parts,
      (p) => p.part_no,
      (a, b) => a.qty === b.qty,
    ),
    checks: diffRows(before.restart_checks, after.restart_checks, text),
    escalate: diffRows(before.escalate_if, after.escalate_if, str),
    questions: diffRows(before.open_questions, after.open_questions, str),
  };
  const title = before.title.trim() !== after.title.trim();
  const summary = before.summary.trim() !== after.summary.trim();
  const count = Object.values(lists).reduce((n, rows) => n + countChanges(rows), 0) + Number(title) + Number(summary);
  return { ...lists, title, summary, count };
}

/** The rows of a guide shown without a proposal. */
export function plainDiff(guide: Guide): GuideDiff {
  return {
    title: false,
    summary: false,
    safety: sameRows(guide.safety),
    steps: sameRows(guide.steps),
    parts: sameRows(guide.parts),
    checks: sameRows(guide.restart_checks),
    escalate: sameRows(guide.escalate_if),
    questions: sameRows(guide.open_questions),
    count: 0,
  };
}

const item = (i: GuideItem) => ({ text: i.text, citations: i.citations, general: !i.citations.length, flags: [] });

/** A guide's content as an edit. The server checks it again either way. */
export function toEdit(guide: Guide, by: string, extra: Partial<GuideEdit> = {}): GuideEdit {
  return {
    by,
    title: guide.title,
    summary: guide.summary,
    safety: guide.safety.map(item),
    steps: guide.steps.map((s) => ({ ...item(s), caution: s.caution, figure_id: s.figure_id })),
    parts: guide.parts.map((p) => ({ part_no: p.part_no, qty: p.qty, why: p.why })),
    restart_checks: guide.restart_checks.map(item),
    escalate_if: guide.escalate_if,
    open_questions: guide.open_questions,
    ...extra,
  };
}

/** What the audit trail says about a kept change, e.g. `By voice: step 4 is for the engineer`. */
export function auditNote(asks: Ask[]): string {
  const voice = asks.some((a) => a.voice);
  const words = asks
    .map((a) => a.transcript.trim())
    .filter(Boolean)
    .join(" · ");
  return `${voice ? "By voice" : "Asked"}: ${words}`.slice(0, 2000);
}
