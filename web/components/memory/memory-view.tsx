"use client";

import { AlertCircle, Inbox } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { OutcomeBadge, RecordId } from "@/components/incident-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { api, type Incident, type Industry } from "@/lib/api";
import { useRecords } from "@/lib/stores/records";
import { formatDate, plural, SOURCE_LABEL } from "@/lib/utils";

const PAGE = 25;
const FILTERS: { value: "all" | Industry; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paper", label: "Paper" },
  { value: "pharma", label: "Pharma" },
  { value: "generic", label: "General" },
];

function SourceBadge({ source }: { source: Incident["source"] }) {
  return <Badge tone={source === "seed" ? "neutral" : "accent"}>{SOURCE_LABEL[source]}</Badge>;
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

export function MemoryView() {
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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Plant memory</h1>
          <p className="mt-1.5 text-[0.9375rem] text-fg-muted">
            {total === null
              ? "Every incident PlantMemory can search."
              : `${plural(total, "incident")} PlantMemory can search. Approved drafts and logbook pages are added here.`}
          </p>
        </div>
        <Segmented label="Industry" size="sm" options={FILTERS} value={filter} onChange={changeFilter} />
      </header>

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
