"use client";

import { Ban, CircleCheck, Factory, Languages, Lock, PackageX, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Banner, RecurrenceBanner } from "@/components/banners";
import { CitationChip, CitedText } from "@/components/cited-text";
import { Badge } from "@/components/ui/badge";
import { Card, SectionLabel } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { ApiError, api, type Guide, type GuideRevision } from "@/lib/api";
import { refreshPlant } from "@/lib/stores/plant";
import { track } from "@/lib/telemetry";
import { useRecords } from "@/lib/stores/records";
import { useActorName, useSession } from "@/lib/stores/session";
import { formatDateTime } from "@/lib/utils";
import { AuditTrail, canWithdraw, GuideActions, WithdrawDialog } from "./guide-actions";
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
import { GuideStages } from "./stages";
import { ReviseComposer } from "./revise-composer";
import { auditNote, diffGuide, toEdit, type Ask, type Revision } from "./revision";
import { RevisionSummary } from "./revision-summary";

function StatusBanner({ guide }: { guide: Guide }) {
  const last = (action: string) => [...guide.events].reverse().find((e) => e.action === action);
  if (guide.status === "withdrawn") {
    const event = last("withdrawn");
    return (
      <Banner tone="neutral" icon={<Ban className="text-fg-muted" />} title={`Withdrawn by ${event?.by ?? "the manager"}`}>
        <span className="text-fg-muted">
          {event ? `${formatDateTime(event.at)}. ` : ""}
          {event?.comment ? `“${event.comment}”` : "Not needed."}
        </span>
      </Banner>
    );
  }
  if (guide.status === "rejected") {
    const event = last("rejected");
    return (
      <Banner tone="danger" icon={<Undo2 />} title={`Sent back by ${event?.by ?? "QA"}`}>
        {event?.comment ?? "QA asked for changes."} Edit the guide, then approve it; it goes back to QA.
      </Banner>
    );
  }
  if (guide.status === "approved") {
    const event = last("approved");
    return (
      <Banner tone="success" icon={<ShieldCheck />} title={`Approved by ${event?.by ?? "the manager"}`}>
        {event ? `${formatDateTime(event.at)}. ` : ""}
        {event?.comment ? `“${event.comment}” ` : ""}Ready to print for the workers.
      </Banner>
    );
  }
  if (guide.status === "in_review" && guide.qa_reasons.length) {
    return (
      <Banner tone="warn" icon={<ShieldAlert />} title="Why QA must check this guide">
        <ul className="list-disc pl-4">
          {guide.qa_reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Banner>
    );
  }
  if (guide.status === "closed" || guide.status === "released") {
    const release = last("released");
    return (
      <Banner
        tone="success"
        icon={release ? <Factory /> : <Lock />}
        title={release ? `Released to production by ${release.by}` : "Closed and saved to plant memory"}
      >
        {release ? `${formatDateTime(release.at)}. ` : "QA does the line clearance and releases the machine. "}
        What was done is now a record the next search will find:
        {guide.closure_record_id && <CitationChip id={guide.closure_record_id} />}
      </Banner>
    );
  }
  return null;
}

/** A repair guide: evidence, steps, parts, translations, history and the next action. */
export function GuideView({ guide, onChange: setGuide }: { guide: Guide; onChange: (g: Guide) => void }) {
  // Every change to a guide may start or end a machine's stop.
  const onChange = (g: Guide) => {
    setGuide(g);
    refreshPlant();
  };
  const { remember, rememberSections } = useRecords();
  const role = useSession((s) => s.role);
  const by = useActorName();
  const [editing, setEditing] = useState(false);
  const [lang, setLang] = useState("en");
  const [revision, setRevision] = useState<Revision | null>(null);
  const [keeping, setKeeping] = useState(false);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    remember(guide.similar_incidents.flatMap((m) => (m.record ? [m.record] : [])));
    rememberSections(guide.manual_sections);
  }, [guide, remember, rememberSections]);

  // A proposal not kept yet would be lost on leaving the page.
  useEffect(() => {
    if (!revision) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [revision]);

  const canRevise = role === "manager" && (guide.status === "draft" || guide.status === "rejected") && !editing;
  const shown = revision?.proposal ?? guide;
  const diff = useMemo(() => (revision ? diffGuide(guide, revision.proposal) : null), [guide, revision]);

  const propose = (result: GuideRevision, ask: Ask) => {
    if (!result.proposal) return;
    setRevision({ proposal: result.proposal, warnings: result.warnings, asks: [...(revision?.asks ?? []), ask] });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() =>
      summaryRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" }),
    );
  };

  const undo = async (before: Guide, saved: Guide) => {
    try {
      const restored = await api.editGuide(
        guide.id,
        toEdit(before, by, { note: "Undid the last change", base_updated_at: saved.updated_at }),
      );
      onChange(restored);
      toast("Change undone");
    } catch (err) {
      toast.error("Couldn’t undo", { description: err instanceof Error ? err.message : undefined });
    }
  };

  const keep = async () => {
    if (!revision) return;
    setKeeping(true);
    const before = guide;
    try {
      const saved = await api.editGuide(
        guide.id,
        toEdit(revision.proposal, by, { note: auditNote(revision.asks), base_updated_at: guide.updated_at }),
      );
      onChange(saved);
      setRevision(null);
      toast.success("Changes kept", {
        description: "Sources, values and parts were checked again.",
        duration: 10_000,
        action: { label: "Undo", onClick: () => void undo(before, saved) },
      });
    } catch (err) {
      const stale = err instanceof ApiError && err.status === 409;
      toast.error("Couldn’t keep the changes", {
        description: err instanceof Error ? err.message : undefined,
        action: stale ? { label: "Reload", onClick: () => window.location.reload() } : undefined,
      });
    } finally {
      setKeeping(false);
    }
  };

  const tr = shown.translations.find((t) => t.language === lang) ?? null;
  const author = guide.events.find((e) => e.action === "created");
  const trFlags = shown.translations.flatMap((t) => t.flags.map((f) => `${t.language_name}: ${f}`));
  const langOptions = [
    { value: "en", label: "English" },
    ...shown.translations.map((t) => ({ value: t.language, label: t.language_name })),
  ];

  return (
    <article className="flex flex-col gap-5 transition-[opacity,translate] duration-250 ease-out starting:translate-y-2 starting:opacity-0">
      <header className="flex flex-col gap-2" data-tour="guide-header">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={guide.status} />
          {guide.version > 1 && <Badge>v{guide.version}</Badge>}
          {guide.asset_tag && <Badge tone="accent">{guide.asset_tag}</Badge>}
          {guide.error_codes.map((code) => (
            <Badge key={code} className="font-mono">
              {code}
            </Badge>
          ))}
          <span className="ml-auto flex items-center gap-1">
            {role === "manager" && canWithdraw(guide) && !revision && <WithdrawDialog guide={guide} onDone={onChange} />}
            <span className="font-mono text-xs text-fg-subtle">{guide.id}</span>
          </span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
          {shown.title}
          {diff?.title && (
            <Badge tone="accent" className="ml-2 translate-y-[-3px] align-middle">
              Changed
            </Badge>
          )}
        </h2>
        {author && (
          <p className="text-[0.8125rem] text-fg-muted">
            Drafted for {author.by} · {formatDateTime(author.at)}
            {guide.equipment_model && <span className="text-fg-subtle"> · {guide.equipment_model}</span>}
          </p>
        )}
        <GuideStages guide={guide} className="mt-3 max-w-xl" />
      </header>

      <StatusBanner guide={guide} />
      {revision && diff && <RevisionSummary ref={summaryRef} revision={revision} count={diff.count} />}
      {shown.recurrence_note && (
        <div data-tour="guide-repeat">
          <RecurrenceBanner note={shown.recurrence_note} recurrence={shown.recurrence} />
        </div>
      )}
      {shown.flags.length > 0 && (
        <Banner tone="warn" icon={<PackageX />} title="Check before it goes to the floor">
          <ul className="flex flex-col gap-1">
            {shown.flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </Banner>
      )}

      <div data-tour="guide-facts">
        <Facts guide={shown} />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-[0.9375rem] leading-7 text-pretty">
          {shown.summary}
          {diff?.summary && (
            <Badge tone="accent" className="ml-1.5 h-5 translate-y-[-1px] align-middle">
              Changed
            </Badge>
          )}
        </p>
        <p className="text-[0.8125rem] text-fg-muted">
          <CitedText text={shown.downtime.note} />
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
          {shown.translations.length > 0 && (
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
          <SafetyList items={shown.safety} lang={{ tr }} rows={diff?.safety} />
          <div data-tour="guide-steps">
            <StepList steps={shown.steps} lang={{ tr }} rows={diff?.steps} />
          </div>
          <div data-tour="guide-parts">
            <PartsTable parts={shown.parts} rows={diff?.parts} />
          </div>
          <CheckList items={shown.restart_checks} lang={{ tr }} rows={diff?.checks} />
          <EscalateList items={shown.escalate_if} lang={{ tr }} rows={diff?.escalate} />
          <OpenQuestions items={shown.open_questions} rows={diff?.questions} />
        </>
      )}

      <SourcesList guide={guide} />

      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <SectionLabel>History</SectionLabel>
        <AuditTrail guide={guide} />
      </Card>
      <p className="text-xs text-fg-subtle">{guide.notice}</p>

      <GuideActions
        guide={guide}
        onChange={onChange}
        onEdit={() => setEditing(true)}
        editing={editing}
        composer={canRevise ? <ReviseComposer guide={guide} revision={revision} onProposal={propose} /> : undefined}
        review={
          revision && diff
            ? {
                count: diff.count,
                keeping,
                onKeep: keep,
                onDiscard: () => {
                  setRevision(null);
                  track("change_discarded", { guide: guide.id });
                },
              }
            : undefined
        }
      />
    </article>
  );
}
