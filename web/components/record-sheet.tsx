"use client";

import { Drawer } from "@base-ui/react/drawer";
import { AlertTriangle, BookOpen, Clock, X } from "lucide-react";

import { OutcomeBadge, RecordId } from "@/components/incident-meta";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { figureUrl, type Incident, type ManualSection } from "@/lib/api";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { isManualId, useRecords } from "@/lib/stores/records";
import { cn, formatDate, formatMinutes, INDUSTRY_LABEL, SECTION_KIND_LABEL, SOURCE_LABEL } from "@/lib/utils";

const FIELD_LABEL: Record<string, string> = {
  area_or_equipment: "Equipment or area",
  description: "What happened",
  suspected_cause: "Suspected cause",
  root_cause: "Root cause",
  action_taken: "What was done",
  downtime_minutes: "Downtime",
  date: "Date",
};

function Row({ field, record }: { field: keyof Incident; record: Incident }) {
  const value = record[field];
  if (value === null || value === undefined || value === "") return null;
  const flagged = record.confidence_flags.includes(field);
  return (
    <div className="flex flex-col gap-1 py-3 first:pt-0">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
        {FIELD_LABEL[field]}
        {flagged && (
          <Badge tone="warn" className="h-4.5 px-1.5 text-[0.6875rem]">
            Unsure
          </Badge>
        )}
      </dt>
      <dd className="whitespace-pre-wrap text-fg">
        {field === "downtime_minutes" ? `${value} minutes` : String(value)}
      </dd>
    </div>
  );
}

function RecordBody({ record }: { record: Incident }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <RecordId id={record.id} />
        <span className="text-fg-subtle">·</span>
        <span className="text-xs text-fg-muted">{formatDate(record.date)}</span>
      </div>
      <Drawer.Title className="mt-2 text-lg leading-7 font-semibold tracking-tight text-balance">
        {record.area_or_equipment}
      </Drawer.Title>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <OutcomeBadge outcome={record.outcome} />
        <Badge>{INDUSTRY_LABEL[record.industry]}</Badge>
        <Badge>{SOURCE_LABEL[record.source]}</Badge>
      </div>
      {record.confidence_flags.length > 0 && (
        <p className="mt-4 flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[0.8125rem] text-warn-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Read from a photo. Fields marked “Unsure” were hard to read.
        </p>
      )}
      <dl className="mt-5 divide-y divide-line">
        {(
          ["description", "suspected_cause", "root_cause", "action_taken", "downtime_minutes"] as const
        ).map((field) => (
          <Row key={field} field={field} record={record} />
        ))}
      </dl>
      {record.source_ref && (
        <p className="mt-4 text-xs text-fg-subtle">
          Source: <span className="font-mono">{record.source_ref}</span>
        </p>
      )}
    </>
  );
}

function SectionBody({ section }: { section: ManualSection }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <RecordId id={section.id} />
        <span className="text-fg-subtle">·</span>
        <span className="text-xs text-fg-muted">Page {section.page}</span>
      </div>
      <Drawer.Title className="mt-2 text-lg leading-7 font-semibold tracking-tight text-balance">
        {section.title}
      </Drawer.Title>
      <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-fg-muted">
        <BookOpen className="size-3.5 shrink-0" />
        {section.manual_title}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="accent">{SECTION_KIND_LABEL[section.kind]}</Badge>
        {section.error_codes.map((code) => (
          <Badge key={code} className="font-mono">
            {code}
          </Badge>
        ))}
        {section.repair_minutes ? (
          <Badge>
            <Clock />
            About {formatMinutes(section.repair_minutes)}
          </Badge>
        ) : null}
      </div>
      <p className="mt-5 whitespace-pre-wrap text-fg">{section.text}</p>
      {section.figure_ids.map((id) => (
        <figure key={id} className="mt-5 overflow-hidden rounded-xl bg-white shadow-[inset_0_0_0_1px_var(--color-line)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
          <img src={figureUrl(id)} alt="" className="w-full object-contain" loading="lazy" />
        </figure>
      ))}
      <p className="mt-4 text-xs text-fg-subtle">Applies to {section.asset_tags.join(", ") || "this equipment"}.</p>
    </>
  );
}

/** One record or manual section, opened from any citation chip or card. Side panel on desktop, sheet on phones. */
export function RecordSheet() {
  const { openId, cache, sections, close } = useRecords();
  const wide = useMediaQuery("(min-width: 768px)");
  const manual = openId !== null && isManualId(openId);
  const record = openId && !manual ? cache[openId] : undefined;
  const section = openId && manual ? sections[openId] : undefined;

  return (
    <Drawer.Root
      open={openId !== null}
      onOpenChange={(open) => !open && close()}
      swipeDirection={wide ? "right" : "down"}
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-black/30 opacity-[calc(1-var(--drawer-swipe-progress))] transition-opacity duration-[400ms] ease-(--ease-drawer) data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 dark:bg-black/60" />
        <Drawer.Viewport
          className={cn("fixed inset-0 z-50 flex", wide ? "items-stretch justify-end p-2" : "items-end")}
        >
          <Drawer.Popup
            className={cn(
              "relative flex flex-col overflow-y-auto overscroll-contain bg-surface text-fg shadow-raised outline-none",
              "transition-transform duration-[400ms] ease-(--ease-drawer) data-swiping:select-none data-swiping:duration-0",
              "data-ending-style:duration-[calc(var(--drawer-swipe-strength)*350ms)]",
              wide
                ? "h-full w-[min(28rem,calc(100vw-1rem))] rounded-2xl [transform:translateX(var(--drawer-swipe-movement-x))] data-ending-style:[transform:translateX(calc(100%+1rem))] data-starting-style:[transform:translateX(calc(100%+1rem))]"
                : "max-h-[88dvh] w-full rounded-t-2xl pb-[env(safe-area-inset-bottom,0px)] [transform:translateY(var(--drawer-swipe-movement-y))] data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)]",
            )}
          >
            {!wide && <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-surface-3" />}
            <Drawer.Close
              aria-label="Close"
              className="absolute top-3 right-3 grid size-8 place-items-center rounded-lg text-fg-subtle transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-2 hover:text-fg active:scale-[0.97]"
            >
              <X className="size-4" />
            </Drawer.Close>
            <Drawer.Content className="px-5 pt-5 pb-6 sm:px-6">
              {record ? (
                <RecordBody record={record} />
              ) : section ? (
                <SectionBody section={section} />
              ) : (
                <div className="flex items-center gap-2 py-10 text-sm text-fg-muted">
                  <Spinner /> Loading record
                  <Drawer.Title className="sr-only">Loading record</Drawer.Title>
                </div>
              )}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
