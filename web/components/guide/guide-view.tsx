"use client";

import { CircleCheck, Languages, Lock, PackageX, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Banner, RecurrenceBanner } from "@/components/banners";
import { CitationChip, CitedText } from "@/components/cited-text";
import { Badge } from "@/components/ui/badge";
import { Card, SectionLabel } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import type { Guide } from "@/lib/api";
import { useRecords } from "@/lib/stores/records";
import { formatDateTime } from "@/lib/utils";
import { AuditTrail, GuideActions } from "./guide-actions";
import { GuideEditor } from "./guide-editor";
import {
  CheckList,
  EscalateList,
  Facts,
  OpenQuestions,
  PartsTable,
  SafetyList,
  SourcesList,
  StepList,
} from "./guide-sections";
import { StatusBadge } from "./meta";

function StatusBanner({ guide }: { guide: Guide }) {
  const last = (action: string) => [...guide.events].reverse().find((e) => e.action === action);
  if (guide.status === "rejected") {
    const event = last("rejected");
    return (
      <Banner tone="danger" icon={<Undo2 />} title={`Sent back by ${event?.by ?? "QA"}`}>
        {event?.comment ?? "QA asked for changes."} Edit the guide, then send it again.
      </Banner>
    );
  }
  if (guide.status === "approved") {
    const event = last("approved");
    return (
      <Banner tone="success" icon={<ShieldCheck />} title={`Approved by ${event?.by ?? "QA"}`}>
        {event ? `${formatDateTime(event.at)}. ` : ""}
        {event?.comment ? `“${event.comment}” ` : ""}Ready to print for the workers.
      </Banner>
    );
  }
  if (guide.status === "closed") {
    return (
      <Banner tone="success" icon={<Lock />} title="Closed and saved to plant memory">
        What was done is now a record the next search will find:
        {guide.closure_record_id && <CitationChip id={guide.closure_record_id} />}
      </Banner>
    );
  }
  return null;
}

/** A repair guide: evidence, steps, parts, translations, history and the next action. */
export function GuideView({ guide, onChange }: { guide: Guide; onChange: (g: Guide) => void }) {
  const { remember, rememberSections } = useRecords();
  const [editing, setEditing] = useState(false);
  const [lang, setLang] = useState("en");

  useEffect(() => {
    remember(guide.similar_incidents.flatMap((m) => (m.record ? [m.record] : [])));
    rememberSections(guide.manual_sections);
  }, [guide, remember, rememberSections]);

  const tr = guide.translations.find((t) => t.language === lang) ?? null;
  const author = guide.events.find((e) => e.action === "created");
  const trFlags = guide.translations.flatMap((t) => t.flags.map((f) => `${t.language_name}: ${f}`));
  const langOptions = [
    { value: "en", label: "English" },
    ...guide.translations.map((t) => ({ value: t.language, label: t.language_name })),
  ];

  return (
    <article className="flex flex-col gap-5 transition-[opacity,translate] duration-250 ease-out starting:translate-y-2 starting:opacity-0">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={guide.status} />
          {guide.version > 1 && <Badge>v{guide.version}</Badge>}
          {guide.asset_tag && <Badge tone="accent">{guide.asset_tag}</Badge>}
          {guide.error_codes.map((code) => (
            <Badge key={code} className="font-mono">
              {code}
            </Badge>
          ))}
          <span className="ml-auto font-mono text-xs text-fg-subtle">{guide.id}</span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{guide.title}</h2>
        {author && (
          <p className="text-[0.8125rem] text-fg-muted">
            Drafted for {author.by} · {formatDateTime(author.at)}
            {guide.equipment_model && <span className="text-fg-subtle"> · {guide.equipment_model}</span>}
          </p>
        )}
      </header>

      <StatusBanner guide={guide} />
      {guide.recurrence_note && <RecurrenceBanner note={guide.recurrence_note} recurrence={guide.recurrence} />}
      {guide.flags.length > 0 && (
        <Banner tone="warn" icon={<PackageX />} title="Check before it goes to the floor">
          <ul className="flex flex-col gap-1">
            {guide.flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </Banner>
      )}

      <Facts guide={guide} />
      <div className="flex flex-col gap-1.5">
        <p className="text-[0.9375rem] leading-7 text-pretty">{guide.summary}</p>
        <p className="text-[0.8125rem] text-fg-muted">
          <CitedText text={guide.downtime.note} />
        </p>
      </div>

      {editing ? (
        <GuideEditor
          guide={guide}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            onChange(saved);
            setEditing(false);
          }}
        />
      ) : (
        <>
          {guide.translations.length > 0 && (
            <div className="flex flex-col gap-3 rounded-(--radius-card) bg-surface-2/70 p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[0.8125rem] font-medium">
                  <Languages className="size-4 text-fg-subtle" />
                  Shop-floor languages
                </p>
                <Segmented label="Show the guide in" size="sm" options={langOptions} value={lang} onChange={setLang} />
              </div>
              {trFlags.length > 0 ? (
                <ul className="flex flex-col gap-1 text-[0.8125rem] text-warn-text">
                  {trFlags.map((flag) => (
                    <li key={flag}>⚠ {flag}</li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-1.5 text-[0.8125rem] text-fg-muted">
                  <CircleCheck className="size-3.5 text-success-text" />
                  Every number, part number and alarm code was found in each translation.
                </p>
              )}
            </div>
          )}
          <SafetyList items={guide.safety} lang={{ tr }} />
          <StepList steps={guide.steps} lang={{ tr }} />
          <PartsTable parts={guide.parts} />
          <CheckList items={guide.restart_checks} lang={{ tr }} />
          <EscalateList items={guide.escalate_if} lang={{ tr }} />
          <OpenQuestions items={guide.open_questions} />
        </>
      )}

      <SourcesList guide={guide} />

      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <SectionLabel>History</SectionLabel>
        <AuditTrail guide={guide} />
      </Card>
      <p className="text-xs text-fg-subtle">{guide.notice}</p>

      <GuideActions guide={guide} onChange={onChange} onEdit={() => setEditing(true)} editing={editing} />
    </article>
  );
}
