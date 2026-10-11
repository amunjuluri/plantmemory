"use client";

import { CircleCheck, Columns3, RefreshCw, Sheet } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { RecordEditor } from "@/components/logbook/record-editor";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiError, sampleFile, type CmmsImportResult, type Incident } from "@/lib/api";
import { cn, plural } from "@/lib/utils";

type CmmsState = {
  status: "idle" | "reading" | "review" | "saving" | "saved" | "error";
  fileName: string | null;
  result: CmmsImportResult | null;
  records: Incident[];
  error: string | null;
  savedIds: string[];
  read: (file: File) => Promise<void>;
  update: (id: string, patch: Partial<Incident>) => void;
  remove: (id: string) => void;
  save: () => Promise<void>;
  reset: () => void;
};

const useCmms = create<CmmsState>((set, get) => ({
  status: "idle",
  fileName: null,
  result: null,
  records: [],
  error: null,
  savedIds: [],
  read: async (file) => {
    set({ status: "reading", fileName: file.name, result: null, records: [], error: null, savedIds: [] });
    try {
      const result = await api.importCmms(file);
      set({ status: "review", result, records: result.records });
    } catch (err) {
      set({ status: "error", error: err instanceof ApiError ? err.message : "Couldn’t read that export." });
    }
  },
  update: (id, patch) =>
    set((s) => ({
      records: s.records.map((r) =>
        r.id === id
          ? { ...r, ...patch, confidence_flags: r.confidence_flags.filter((f) => !Object.keys(patch).includes(f)) }
          : r,
      ),
    })),
  remove: (id) => set((s) => ({ records: s.records.filter((r) => r.id !== id) })),
  save: async () => {
    const { records } = get();
    if (!records.length) return;
    set({ status: "saving", error: null });
    try {
      const saved = await api.confirmLogbook(records);
      set({ status: "saved", savedIds: saved.map((r) => r.id) });
    } catch (err) {
      set({ status: "review", error: err instanceof ApiError ? err.message : "Couldn’t save. Try again." });
    }
  },
  reset: () => set({ status: "idle", fileName: null, result: null, records: [], error: null, savedIds: [] }),
}));

function Picker() {
  const read = useCmms((s) => s.read);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void read(file);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-4 rounded-(--radius-card) border border-dashed px-6 py-12 text-center transition-[background-color,border-color] duration-150 ease-out",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface",
        )}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-text">
          <Sheet className="size-6" strokeWidth={1.75} />
        </span>
        <div>
          <p className="font-medium">Drop a maintenance history export</p>
          <p className="mt-1 text-sm text-fg-muted">
            From SAP PM (IW29 or IW39 list, saved as a spreadsheet), Maximo, or any Excel or CSV file.
          </p>
        </div>
        <Button variant="primary" onClick={() => input.current?.click()}>
          Choose file
        </Button>
        <p className="text-xs text-fg-subtle">CSV or Excel (.xlsx), up to 500 rows</p>
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && read(e.target.files[0])}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-subtle">No export handy? Try a sample:</span>
        <button
          type="button"
          onClick={() =>
            sampleFile("sap_iw29_export.csv", "text/csv").then(read, () => toast.error("Couldn’t load the sample"))
          }
          className="h-8 rounded-full bg-surface-2 px-3 text-[0.8125rem] text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-3 hover:text-fg active:scale-[0.97]"
        >
          SAP PM notification list (IW29)
        </button>
      </div>
    </div>
  );
}

function MappingCard({ result }: { result: CmmsImportResult }) {
  const m = result.mapping;
  const rows: [string, string[]][] = [
    ["Date", [m.date_column]],
    ["Machine", m.equipment_columns],
    ["What happened", m.description_columns],
    ["Cause", m.cause_columns],
    ["What was done", m.action_columns],
    ["Downtime", m.downtime_column ? [`${m.downtime_column} (${m.downtime_unit})`] : []],
    ["Completed when", m.status_column ? [`${m.status_column} = ${m.completed_values.join(", ") || "?"}`] : []],
  ];
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Columns3 className="size-4 text-fg-subtle" />
        <h3 className="font-medium">{m.system ?? "Maintenance export"}</h3>
        <Badge>{plural(result.rows, "row")}</Badge>
      </div>
      <p className="text-[0.8125rem] text-fg-muted">
        Gemini matched the columns; every row was then copied exactly as written. Nothing was paraphrased.
      </p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
        {rows.map(([label, cols]) => (
          <div key={label} className="contents">
            <dt className="text-fg-subtle">{label}</dt>
            <dd className="min-w-0 truncate">{cols.length ? cols.join(" + ") : <span className="text-fg-subtle">not in export</span>}</dd>
          </div>
        ))}
      </dl>
      {result.skipped.length > 0 && (
        <p className="text-[0.8125rem] text-warn-text">Skipped: {result.skipped.join(" ")}</p>
      )}
    </Card>
  );
}

export function CmmsImport() {
  const { status, fileName, result, records, error, savedIds, update, remove, save, reset } = useCmms();

  if (status === "idle") return <Picker />;
  if (status === "reading") {
    return (
      <Card className="flex items-center gap-3 p-5" aria-live="polite">
        <span className="size-4 animate-spin-fast rounded-full border-2 border-accent border-r-transparent" />
        <div>
          <p className="font-medium">Reading {fileName}</p>
          <p className="text-sm text-fg-muted">Matching the export’s columns to incident fields.</p>
        </div>
      </Card>
    );
  }
  if (status === "error") {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <p className="font-medium">Couldn’t read that export</p>
        <p className="text-sm text-fg-muted">{error}</p>
        <Button size="sm" onClick={reset}>
          Try another file
        </Button>
      </Card>
    );
  }
  if (status === "saved") {
    return (
      <Card className="flex flex-col items-start gap-4 p-6 transition-[opacity,scale] duration-250 ease-out starting:scale-[0.98] starting:opacity-0">
        <span className="grid size-10 place-items-center rounded-full bg-success-soft text-success-text">
          <CircleCheck className="size-5" />
        </span>
        <div>
          <p className="text-lg font-semibold tracking-tight">Saved {plural(savedIds.length, "record")} to plant memory</p>
          <p className="mt-1 text-sm text-fg-muted">Repair guides will now find these past fixes too.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/memory/" className={buttonVariants({ variant: "secondary" })}>
            View in Memory
          </Link>
          <Button variant="primary" onClick={reset}>
            Import another file
          </Button>
        </div>
      </Card>
    );
  }

  const flagged = records.reduce((n, r) => n + r.confidence_flags.length, 0);
  return (
    <div className="flex flex-col gap-4">
      {result && <MappingCard result={result} />}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{plural(records.length, "record")} to check</h2>
        {flagged > 0 && <p className="text-sm text-warn-text">{plural(flagged, "outcome")} not stated in the export</p>}
      </div>
      {records.map((record, i) => (
        <RecordEditor key={record.id} record={record} index={i} update={update} remove={remove} noun="Row" />
      ))}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-10 md:bottom-4">
        <div className="flex items-center justify-between gap-3 rounded-(--radius-card) bg-surface/90 p-3 shadow-raised backdrop-blur-xl">
          <Button variant="ghost" size="sm" onClick={reset}>
            <RefreshCw />
            Start over
          </Button>
          <Button variant="primary" onClick={save} loading={status === "saving"} disabled={!records.length}>
            Save {plural(records.length, "record")}
          </Button>
        </div>
      </div>
    </div>
  );
}
