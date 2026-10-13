"use client";

import { AlertCircle, BookOpen, Inbox, Package, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { OutcomeBadge, RecordId } from "@/components/incident-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { Figure } from "@/components/guide/meta";
import { api, type Incident, type Industry, type ManualSection, type ManualSummary, type Part } from "@/lib/api";
import { useRecords } from "@/lib/stores/records";
import { formatDate, plural, SECTION_KIND_LABEL, SOURCE_LABEL } from "@/lib/utils";

const SEED_MANUALS = new Set(["RTP37", "BPM250", "SA600"]);

const PAGE = 25;
const FILTERS: { value: "all" | Industry; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pharma", label: "Pharma" },
  { value: "healthcare", label: "Healthcare" },
  { value: "paper", label: "Paper" },
  { value: "generic", label: "General" },
];

function SourceBadge({ source }: { source: Incident["source"] }) {
  return <Badge tone={source === "seed" || source === "public_record" ? "neutral" : "accent"}>{SOURCE_LABEL[source]}</Badge>;
}

function Row({ record }: { record: Incident }) {
  const open = useRecords((s) => s.open);
  return (
    <li>
      <button
        type="button"
        onClick={() => open(record.id)}
        className="grid w-full grid-cols-1 gap-2 px-4 py-3.5 text-left transition-[background-color] duration-150 ease-out hover:bg-surface-2 md:grid-cols-[7.5rem_6.5rem_minmax(0,1fr)_auto] md:items-center md:gap-4"
      >
        <span className="flex items-center gap-2 md:contents">
          <span className="tabular text-[0.8125rem] text-fg-muted">{formatDate(record.date)}</span>
          <span className="text-fg-subtle md:hidden">·</span>
          <RecordId id={record.id} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{record.area_or_equipment}</span>
          <span className="block truncate text-[0.8125rem] text-fg-muted">{record.description}</span>
        </span>
        <span className="flex flex-wrap gap-1.5 md:justify-end">
          <OutcomeBadge outcome={record.outcome} />
          <SourceBadge source={record.source} />
        </span>
      </button>
    </li>
  );
}

function IncidentsPanel() {
  const remember = useRecords((s) => s.remember);
  const [filter, setFilter] = useState<"all" | Industry>("all");
  const [items, setItems] = useState<Incident[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    (offset: number, industry: "all" | Industry) =>
      api.incidents({ offset, limit: PAGE, industry: industry === "all" ? null : industry }).then(
        (page) => {
          remember(page.items);
          setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
          setTotal(page.total);
          setError(null);
        },
        (err: unknown) => setError(err instanceof Error ? err.message : "Couldn’t load records."),
      ),
    [remember],
  );

  useEffect(() => {
    let live = true;
    void fetchPage(0, filter).finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [filter, fetchPage]);

  const changeFilter = (next: "all" | Industry) => {
    setLoading(true);
    setItems([]);
    setFilter(next);
  };

  const load = (offset: number) => {
    setLoading(true);
    void fetchPage(offset, filter).finally(() => setLoading(false));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {total === null
            ? "Every incident PlantMemory can search."
            : `${plural(total, "incident")}. Closed guides, logbook pages and CMMS imports are added here.`}
        </p>
        <Segmented label="Industry" size="sm" options={FILTERS} value={filter} onChange={changeFilter} />
      </div>

      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[7.5rem_6.5rem_minmax(0,1fr)_auto] gap-4 border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-fg-subtle md:grid">
          <span>Date</span>
          <span>Record</span>
          <span>Incident</span>
          <span className="text-right">Outcome · Source</span>
        </div>
        {error ? (
          <div className="flex flex-col items-start gap-3 p-5">
            <p className="flex items-center gap-2 text-sm text-danger-text">
              <AlertCircle className="size-4" />
              {error}
            </p>
            <Button size="sm" onClick={() => load(0)}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 && !loading ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <Inbox className="size-6 text-fg-subtle" />
            <p className="font-medium">No incidents yet</p>
            <p className="text-sm text-fg-muted">Approve a draft or digitize a logbook page to add one.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((record) => (
              <Row key={record.id} record={record} />
            ))}
          </ul>
        )}
        {loading && (
          <div className="flex items-center justify-center gap-2 border-t border-line py-4 text-sm text-fg-muted">
            <Spinner /> Loading
          </div>
        )}
      </Card>

      {!loading && total !== null && items.length < total && (
        <Button className="self-center" onClick={() => load(items.length)}>
          Show more
        </Button>
      )}
    </div>
  );
}

function ManualsPanel() {
  const { open, rememberSections } = useRecords();
  const [manuals, setManuals] = useState<ManualSummary[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<string, ManualSection[]>>({});

  const load = useCallback(() => {
    api.manuals().then(setManuals, () => setManuals([]));
  }, []);
  useEffect(load, [load]);

  const toggle = (id: string) => {
    setExpanded((cur) => (cur === id ? null : id));
    if (!sections[id]) {
      api.manualSections(id).then((list) => {
        rememberSections(list);
        setSections((s) => ({ ...s, [id]: list }));
      }, () => undefined);
    }
  };

  const remove = async (id: string) => {
    await api.deleteManual(id);
    load();
  };

  if (manuals === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-muted">
        <Spinner /> Loading
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">{plural(manuals.length, "equipment manual")} that guides can cite by page.</p>
        <Link href="/add/?tab=manual" className="text-sm font-medium text-accent-text hover:underline">
          Add a manual
        </Link>
      </div>
      {manuals.map((m) => (
        <Card key={m.manual_id} className="overflow-hidden">
          <button
            type="button"
            onClick={() => toggle(m.manual_id)}
            aria-expanded={expanded === m.manual_id}
            className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 text-left transition-[background-color] duration-150 ease-out hover:bg-surface-2"
          >
            <BookOpen className="size-4.5 shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{m.equipment_model}</span>
              <span className="block truncate text-[0.8125rem] text-fg-muted">{m.manual_title}</span>
            </span>
            <span className="flex flex-wrap gap-1.5">
              {m.asset_tags.map((t) => (
                <Badge key={t} tone="accent">
                  {t}
                </Badge>
              ))}
              <Badge>{plural(m.sections, "section")}</Badge>
              <Badge>{plural(m.error_codes, "alarm")}</Badge>
            </span>
          </button>
          {expanded === m.manual_id && (
            <div className="border-t border-line">
              {sections[m.manual_id] ? (
                <ul className="divide-y divide-line">
                  {sections[m.manual_id].map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => open(s.id)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-[background-color] duration-150 ease-out hover:bg-surface-2"
                      >
                        <span className="tabular w-10 shrink-0 font-mono text-xs text-fg-subtle">p.{s.page}</span>
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <Badge>{SECTION_KIND_LABEL[s.kind]}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex items-center gap-2 px-4 py-4 text-sm text-fg-muted">
                  <Spinner /> Loading sections
                </div>
              )}
              {!SEED_MANUALS.has(m.manual_id) && (
                <div className="border-t border-line px-4 py-2.5">
                  <Button variant="danger" size="sm" onClick={() => void remove(m.manual_id)}>
                    <Trash2 />
                    Remove this manual
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function PartsPanel() {
  const [parts, setParts] = useState<Part[] | null>(null);
  useEffect(() => {
    api.parts().then(setParts, () => setParts([]));
  }, []);
  if (parts === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-muted">
        <Spinner /> Loading
      </div>
    );
  }
  const low = parts.filter((p) => p.stock_qty <= 1).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        {plural(parts.length, "spare part")} in the plant store. {low > 0 && `${low} at one or none.`}
      </p>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {parts.map((p) => (
            <li key={p.part_no} className="flex items-center gap-3 px-4 py-3">
              {p.figure_id ? (
                <Figure id={p.figure_id} className="w-11 shrink-0" />
              ) : (
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-subtle">
                  <Package className="size-5" strokeWidth={1.5} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono text-[0.8125rem] font-medium">{p.part_no}</span>
                  <span className="truncate text-sm">{p.name}</span>
                </p>
                <p className="truncate text-[0.8125rem] text-fg-muted">
                  {p.asset_tags.join(", ")} · {p.bin_location}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={p.stock_qty === 0 ? "danger" : p.stock_qty === 1 ? "warn" : "success"}>
                  {p.stock_qty} {p.unit}
                </Badge>
                {p.lead_time_days != null && <span className="text-xs text-fg-subtle">{p.lead_time_days} d lead</span>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

type Tab = "incidents" | "manuals" | "parts";
const TABS: { value: Tab; label: string }[] = [
  { value: "incidents", label: "Incidents" },
  { value: "manuals", label: "Manuals" },
  { value: "parts", label: "Spare parts" },
];

export function MemoryView() {
  const [tab, setTab] = useState<Tab>("incidents");
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Plant memory</h1>
          <p className="mt-1.5 text-[0.9375rem] text-fg-muted">
            Everything repair guides draw on: past incidents and fixes, equipment manuals, and the parts store.
          </p>
        </div>
        <Segmented label="Show" options={TABS} value={tab} onChange={setTab} className="self-start" />
      </header>
      {tab === "incidents" && <IncidentsPanel />}
      {tab === "manuals" && <ManualsPanel />}
      {tab === "parts" && <PartsPanel />}
    </div>
  );
}
