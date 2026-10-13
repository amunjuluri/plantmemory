"use client";

import {
  AlertTriangle,
  BookOpen,
  CircleAlert,
  Clock,
  History,
  Package,
  PhoneCall,
  ShieldAlert,
  ListChecks,
} from "lucide-react";
import type { ReactNode } from "react";

import { CitationChip } from "@/components/cited-text";
import { SimilarCard } from "@/components/similar-card";
import { Badge } from "@/components/ui/badge";
import { Card, SectionLabel } from "@/components/ui/card";
import type { Guide, GuideItem, GuidePart, GuideStep, GuideTranslation } from "@/lib/api";
import { sameRows, type Mark, type Row } from "@/lib/diff";
import { useRecords } from "@/lib/stores/records";
import { cn, formatMinutes, plural } from "@/lib/utils";
import { Figure } from "./meta";

/** Which text to show: English, or a translation with the English beneath it. */
export type Lang = { tr: GuideTranslation | null };

function Bilingual({ english, translated }: { english: string; translated?: string | null }) {
  if (!translated) return <span>{english}</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="indic text-[0.9875rem]">{translated}</span>
      <span className="text-[0.8125rem] text-fg-subtle">{english}</span>
    </span>
  );
}

function Flags({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {flags.map((flag) => (
        <li key={flag} className="flex gap-1.5 text-[0.8125rem] leading-5 text-warn-text">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {flag}
        </li>
      ))}
    </ul>
  );
}

function Sources({ item }: { item: GuideItem }) {
  if (item.general) {
    return (
      <Badge className="ml-1 h-5 translate-y-[-1px] align-middle" title="No plant record or manual supports this line">
        General practice
      </Badge>
    );
  }
  return (
    <>
      {item.citations.map((id) => (
        <CitationChip key={id} id={id} />
      ))}
    </>
  );
}

/** "New" or "Changed" next to a line the manager has not kept yet. */
function ChangeBadge({ mark }: { mark: Mark }) {
  if (!mark) return null;
  return (
    <Badge tone={mark === "added" ? "success" : "accent"} className="ml-1 h-5 translate-y-[-1px] align-middle">
      {mark === "added" ? "New" : "Changed"}
    </Badge>
  );
}

/** The line as it was before the proposed change. */
function Was({ text }: { text: string }) {
  return (
    <p className="mt-1 text-[0.8125rem] leading-5 text-fg-subtle">
      <span className="sr-only">Was: </span>
      <del className="decoration-fg-subtle/70">{text}</del>
    </p>
  );
}

/** What a changed step said before. When only its caution or figure changed, say that. */
function wasNote(step: GuideStep, was: GuideStep): string {
  if (was.text !== step.text) return was.text;
  if ((was.caution ?? "") !== (step.caution ?? "")) return was.caution ? `Caution: ${was.caution}` : "No caution";
  return was.figure_id ? "A different figure" : "No figure";
}

/** Tint for a proposed line in a simple list. */
const markTint = (mark: Mark) =>
  mark && cn("-mx-2 rounded-lg px-2 py-1", mark === "added" ? "bg-success-soft" : "bg-accent-soft");

/** A line the proposed change removes. */
function RemovedLine({ text }: { text: string }) {
  return (
    <li className="-mx-2 flex items-start gap-2 rounded-lg px-2 py-1 text-[0.9375rem] leading-6 text-fg-subtle">
      <Badge tone="danger" className="mt-0.5 h-5 shrink-0">
        Removed
      </Badge>
      <del className="min-w-0 decoration-fg-subtle/70">{text}</del>
    </li>
  );
}

const markOf = <T,>(row: Row<T>): Mark => (row.kind === "added" || row.kind === "changed" ? row.kind : undefined);

export function Section({
  icon,
  title,
  aside,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <span className="text-fg-subtle [&_svg]:size-4">{icon}</span>
        <SectionLabel>{title}</SectionLabel>
        {aside && <span className="ml-auto text-xs text-fg-subtle">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function SafetyList({ items, lang, rows }: { items: GuideItem[]; lang: Lang; rows?: Row<GuideItem>[] }) {
  const list = rows ?? sameRows(items);
  if (!list.length) return null;
  return (
    <Section icon={<ShieldAlert className="text-danger-text" />} title="Safety first">
      <ul className="flex flex-col gap-2.5 rounded-(--radius-card) bg-danger-soft/60 p-4 shadow-[inset_0_0_0_1px_oklch(0.58_0.2_27/0.18)]">
        {list.map((row, i) =>
          row.kind === "removed" ? (
            <RemovedLine key={i} text={row.was.text} />
          ) : (
            <li key={i} className={cn("flex gap-2.5 text-[0.9375rem] leading-6", markTint(markOf(row)))}>
              <ShieldAlert className="mt-1 size-4 shrink-0 text-danger-text" />
              <div className="min-w-0">
                <Bilingual english={row.item.text} translated={lang.tr?.safety[row.index]} />{" "}
                <Sources item={row.item} />
                <ChangeBadge mark={markOf(row)} />
                {row.kind === "changed" && <Was text={row.was.text} />}
                <Flags flags={row.item.flags} />
              </div>
            </li>
          ),
        )}
      </ul>
    </Section>
  );
}

function StepCard({
  step,
  index,
  lang,
  mark,
  was,
}: {
  step: GuideStep;
  index: number;
  lang: Lang;
  mark?: Mark;
  was?: GuideStep;
}) {
  const open = useRecords((s) => s.open);
  const owner = step.citations.find((c) => c.startsWith("MAN-"));
  return (
    <li
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-3 rounded-(--radius-card) p-4 transition-[opacity,translate] duration-250 ease-out starting:translate-y-1.5 starting:opacity-0 sm:grid-cols-[auto_minmax(0,1fr)_11rem]",
        mark === "added"
          ? "bg-success-soft shadow-[0_0_0_1.5px_var(--color-success)]"
          : mark === "changed"
            ? "bg-accent-soft shadow-[0_0_0_1.5px_var(--color-accent)]"
            : "bg-surface shadow-card",
      )}
      style={{ transitionDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <span className="tabular grid size-8 place-items-center rounded-full bg-fg text-sm font-semibold text-bg">
        {index + 1}
      </span>
      <div className="min-w-0 self-center text-[0.9375rem] leading-6">
        <Bilingual english={step.text} translated={lang.tr?.steps[index]} /> <Sources item={step} />
        <ChangeBadge mark={mark} />
        {was && <Was text={wasNote(step, was)} />}
        {step.caution && (
          <p className="mt-2 flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[0.8125rem] leading-5 text-warn-text">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <Bilingual english={step.caution} translated={lang.tr?.step_cautions[index] || null} />
          </p>
        )}
        <Flags flags={step.flags} />
      </div>
      {step.figure_id && (
        <Figure
          id={step.figure_id}
          className="col-span-2 col-start-1 sm:col-span-1 sm:col-start-3 sm:row-span-2"
          onClick={owner ? () => open(owner) : undefined}
        />
      )}
    </li>
  );
}

export function StepList({ steps, lang, rows }: { steps: GuideStep[]; lang: Lang; rows?: Row<GuideStep>[] }) {
  const list = rows ?? sameRows(steps);
  return (
    <Section icon={<ListChecks />} title="Repair steps" aside={plural(steps.length, "step")}>
      {list.length ? (
        <ol className="flex flex-col gap-2.5">
          {list.map((row, i) =>
            row.kind === "removed" ? (
              <li
                key={`removed-${i}`}
                className="flex items-start gap-3 rounded-(--radius-card) border border-dashed border-line-strong px-4 py-3 text-[0.9375rem] leading-6 text-fg-subtle"
              >
                <Badge tone="danger" className="mt-0.5 h-5 shrink-0">
                  Removed
                </Badge>
                <del className="min-w-0 decoration-fg-subtle/70">{row.was.text}</del>
              </li>
            ) : (
              <StepCard
                key={i}
                step={row.item}
                index={row.index}
                lang={lang}
                mark={markOf(row)}
                was={row.kind === "changed" ? row.was : undefined}
              />
            ),
          )}
        </ol>
      ) : (
        <p className="text-sm text-fg-subtle">No steps yet. Edit the guide to add them.</p>
      )}
    </Section>
  );
}

function StockBadge({ part }: { part: GuidePart }) {
  if (!part.in_stock) return <Badge tone="danger">{part.stock_qty} in store</Badge>;
  if (part.stock_qty === part.qty) return <Badge tone="warn">Last one</Badge>;
  return <Badge tone="success">{part.stock_qty} in store</Badge>;
}

export function PartsTable({ parts, rows }: { parts: GuidePart[]; rows?: Row<GuidePart>[] }) {
  const list = rows ?? sameRows(parts);
  if (!list.length) return null;
  return (
    <Section icon={<Package />} title="Parts to collect" aside={plural(parts.length, "part")}>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {list.map((row) => {
            if (row.kind === "removed") {
              return (
                <li key={`removed-${row.was.part_no}`} className="flex items-center gap-3 px-4 py-3 text-fg-subtle">
                  <Badge tone="danger" className="shrink-0">
                    Removed
                  </Badge>
                  <del className="min-w-0 truncate text-sm decoration-fg-subtle/70">
                    <span className="font-mono text-[0.8125rem]">{row.was.part_no}</span> {row.was.name}
                  </del>
                </li>
              );
            }
            const part = row.item;
            const mark = markOf(row);
            return (
              <li
                key={part.part_no}
                className={cn(
                  "flex items-center gap-3 px-4 py-3",
                  mark === "added" && "bg-success-soft",
                  mark === "changed" && "bg-accent-soft",
                )}
              >
                {part.figure_id ? (
                  <Figure id={part.figure_id} className="w-12 shrink-0" />
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-subtle">
                    <Package className="size-5" strokeWidth={1.5} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[0.8125rem] font-medium">{part.part_no}</span>
                    <span className="text-sm">{part.name}</span>
                    <ChangeBadge mark={mark} />
                  </p>
                  <p
                    className="mt-0.5 truncate text-[0.8125rem] text-fg-muted"
                    title={[part.bin_location, part.why].filter(Boolean).join(" · ")}
                  >
                    {part.bin_location || "Location not recorded"}
                    {part.why && <span className="text-fg-subtle"> · {part.why}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="tabular text-sm font-medium">
                    {row.kind === "changed" && row.was.qty !== part.qty && (
                      <del className="mr-1.5 text-fg-subtle decoration-fg-subtle/70">× {row.was.qty}</del>
                    )}
                    × {part.qty} {part.unit}
                  </span>
                  <StockBadge part={part} />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </Section>
  );
}

export function CheckList({ items, lang, rows }: { items: GuideItem[]; lang: Lang; rows?: Row<GuideItem>[] }) {
  const list = rows ?? sameRows(items);
  if (!list.length) return null;
  return (
    <Section icon={<ListChecks />} title="Before restarting">
      <ul className="flex flex-col gap-2">
        {list.map((row, i) =>
          row.kind === "removed" ? (
            <RemovedLine key={i} text={row.was.text} />
          ) : (
            <li key={i} className={cn("flex gap-3 text-[0.9375rem] leading-6", markTint(markOf(row)))}>
              <span aria-hidden className="mt-1 size-4 shrink-0 rounded border-[1.5px] border-line-strong" />
              <div className="min-w-0">
                <Bilingual english={row.item.text} translated={lang.tr?.restart_checks[row.index]} />{" "}
                <Sources item={row.item} />
                <ChangeBadge mark={markOf(row)} />
                {row.kind === "changed" && <Was text={row.was.text} />}
                <Flags flags={row.item.flags} />
              </div>
            </li>
          ),
        )}
      </ul>
    </Section>
  );
}

export function EscalateList({ items, lang, rows }: { items: string[]; lang: Lang; rows?: Row<string>[] }) {
  const list = rows ?? sameRows(items);
  if (!list.length) return null;
  return (
    <Section icon={<PhoneCall />} title="Stop and call the manager if">
      <ul className="flex flex-col gap-2">
        {list.map((row, i) =>
          row.kind === "removed" ? (
            <RemovedLine key={i} text={row.was} />
          ) : (
            <li key={i} className={cn("flex gap-3 text-[0.9375rem] leading-6", markTint(markOf(row)))}>
              <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-danger" />
              <div className="min-w-0">
                <Bilingual english={row.item} translated={lang.tr?.escalate_if[row.index]} />
                <ChangeBadge mark={markOf(row)} />
                {row.kind === "changed" && <Was text={row.was} />}
              </div>
            </li>
          ),
        )}
      </ul>
    </Section>
  );
}

export function OpenQuestions({ items, rows }: { items: string[]; rows?: Row<string>[] }) {
  const list = rows ?? sameRows(items);
  if (!list.length) return null;
  return (
    <Section icon={<CircleAlert />} title="For the manager" aside="Not printed">
      <ul className="flex flex-col gap-2 rounded-(--radius-card) border border-dashed border-line-strong p-4">
        {list.map((row, i) =>
          row.kind === "removed" ? (
            <RemovedLine key={i} text={row.was} />
          ) : (
            <li key={i} className={cn("flex gap-3 text-[0.9375rem] leading-6 text-fg-muted", markTint(markOf(row)))}>
              <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-fg-subtle" />
              <div className="min-w-0">
                {row.item}
                <ChangeBadge mark={markOf(row)} />
                {row.kind === "changed" && <Was text={row.was} />}
              </div>
            </li>
          ),
        )}
      </ul>
    </Section>
  );
}

function Fact({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-(--radius-card) bg-surface p-3.5 shadow-card">
      <span className="flex items-center gap-1.5 text-xs font-medium text-fg-subtle [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <span className="tabular truncate text-lg font-semibold tracking-tight">{value}</span>
    </div>
  );
}

/** Time, parts and evidence at a glance, all worked out by code. */
export function Facts({ guide }: { guide: Guide }) {
  const { downtime } = guide;
  const shortParts = guide.parts.filter((p) => !p.in_stock).length;
  const manuals = new Set(guide.manual_sections.map((s) => s.manual_id)).size;
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <Fact
        icon={<Clock />}
        label="Manual says"
        value={downtime.manual_minutes ? `~${formatMinutes(downtime.manual_minutes)}` : "No time given"}
      />
      <Fact
        icon={<History />}
        label={downtime.history_records > 1 ? "Past repairs, median" : "Last repair took"}
        value={downtime.history_minutes ? formatMinutes(downtime.history_minutes) : "No record"}
      />
      <Fact
        icon={<Package />}
        label="Parts"
        value={
          guide.parts.length ? (shortParts ? `${shortParts} short` : `${guide.parts.length} in store`) : "None needed"
        }
      />
      <Fact
        icon={<BookOpen />}
        label="Based on"
        value={`${plural(guide.similar_incidents.length, "fix", "fixes")} · ${plural(manuals, "manual")}`}
      />
    </div>
  );
}

export function SourcesList({ guide }: { guide: Guide }) {
  const open = useRecords((s) => s.open);
  return (
    <Section icon={<BookOpen />} title="Where this comes from">
      {guide.similar_incidents.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {guide.similar_incidents.map((match, i) => (
            <SimilarCard key={match.id} match={match} index={i} />
          ))}
        </div>
      )}
      {guide.manual_sections.length > 0 && (
        <Card className="overflow-hidden">
          <p className="border-b border-line bg-surface-2/60 px-4 py-2 text-xs text-fg-muted">
            Manual: <span className="font-medium text-fg">{guide.manual_sections[0].equipment_model}</span>
            {guide.manual_sections[0].asset_tags.length > 0 &&
              `, the model of ${guide.manual_sections[0].asset_tags.join(" and ")}`}
          </p>
          <ul className="divide-y divide-line">
            {guide.manual_sections.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => open(section.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-[background-color] duration-150 ease-out hover:bg-surface-2"
                >
                  <span className="tabular w-12 shrink-0 font-mono text-xs text-fg-subtle">p.{section.page}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{section.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!guide.similar_incidents.length && !guide.manual_sections.length && (
        <p className="text-sm text-fg-subtle">No plant record or manual matched. Every line is general practice.</p>
      )}
    </Section>
  );
}
