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

export function SafetyList({ items, lang }: { items: GuideItem[]; lang: Lang }) {
  if (!items.length) return null;
  return (
    <Section icon={<ShieldAlert className="text-danger-text" />} title="Safety first">
      <ul className="flex flex-col gap-2.5 rounded-(--radius-card) bg-danger-soft/60 p-4 shadow-[inset_0_0_0_1px_oklch(0.58_0.2_27/0.18)]">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-[0.9375rem] leading-6">
            <ShieldAlert className="mt-1 size-4 shrink-0 text-danger-text" />
            <div className="min-w-0">
              <Bilingual english={item.text} translated={lang.tr?.safety[i]} /> <Sources item={item} />
              <Flags flags={item.flags} />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function StepCard({ step, index, lang }: { step: GuideStep; index: number; lang: Lang }) {
  const open = useRecords((s) => s.open);
  const owner = step.citations.find((c) => c.startsWith("MAN-"));
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-3 rounded-(--radius-card) bg-surface p-4 shadow-card transition-[opacity,translate] duration-250 ease-out starting:translate-y-1.5 starting:opacity-0 sm:grid-cols-[auto_minmax(0,1fr)_11rem]"
      style={{ transitionDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <span className="tabular grid size-8 place-items-center rounded-full bg-fg text-sm font-semibold text-bg">
        {index + 1}
      </span>
      <div className="min-w-0 self-center text-[0.9375rem] leading-6">
        <Bilingual english={step.text} translated={lang.tr?.steps[index]} /> <Sources item={step} />
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

export function StepList({ steps, lang }: { steps: GuideStep[]; lang: Lang }) {
  return (
    <Section icon={<ListChecks />} title="Repair steps" aside={plural(steps.length, "step")}>
      {steps.length ? (
        <ol className="flex flex-col gap-2.5">
          {steps.map((step, i) => (
            <StepCard key={i} step={step} index={i} lang={lang} />
          ))}
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

export function PartsTable({ parts }: { parts: GuidePart[] }) {
  if (!parts.length) return null;
  return (
    <Section icon={<Package />} title="Parts to collect" aside={plural(parts.length, "part")}>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {parts.map((part) => (
            <li key={part.part_no} className="flex items-center gap-3 px-4 py-3">
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
                </p>
                <p className="mt-0.5 truncate text-[0.8125rem] text-fg-muted">
                  {part.bin_location || "Location not recorded"}
                  {part.why && <span className="text-fg-subtle"> · {part.why}</span>}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="tabular text-sm font-medium">
                  × {part.qty} {part.unit}
                </span>
                <StockBadge part={part} />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

export function CheckList({ items, lang }: { items: GuideItem[]; lang: Lang }) {
  if (!items.length) return null;
  return (
    <Section icon={<ListChecks />} title="Before restarting">
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-[0.9375rem] leading-6">
            <span aria-hidden className="mt-1 size-4 shrink-0 rounded border-[1.5px] border-line-strong" />
            <div className="min-w-0">
              <Bilingual english={item.text} translated={lang.tr?.restart_checks[i]} /> <Sources item={item} />
              <Flags flags={item.flags} />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function EscalateList({ items, lang }: { items: string[]; lang: Lang }) {
  if (!items.length) return null;
  return (
    <Section icon={<PhoneCall />} title="Stop and call the manager if">
      <ul className="flex flex-col gap-2">
        {items.map((text, i) => (
          <li key={i} className="flex gap-3 text-[0.9375rem] leading-6">
            <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-danger" />
            <Bilingual english={text} translated={lang.tr?.escalate_if[i]} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function OpenQuestions({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <Section icon={<CircleAlert />} title="For the manager" aside="Not printed">
      <ul className="flex flex-col gap-2 rounded-(--radius-card) border border-dashed border-line-strong p-4">
        {items.map((q, i) => (
          <li key={i} className="flex gap-3 text-[0.9375rem] leading-6 text-fg-muted">
            <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-fg-subtle" />
            {q}
          </li>
        ))}
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
                  <span className="hidden shrink-0 text-xs text-fg-subtle sm:inline">{section.manual_id}</span>
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
