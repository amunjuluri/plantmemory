"use client";

import { ArrowRight, Clock, FileText, History, OctagonAlert, RefreshCw, TrendingUp, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { CitationChip, CitedText } from "@/components/cited-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { api, ApiError, sampleFile, type Asset, type LogAnalysis, type LogCodeSummary } from "@/lib/api";
import { useBreakdown } from "@/lib/stores/breakdown";
import { useRecords } from "@/lib/stores/records";
import { useActorName } from "@/lib/stores/session";
import { cn, formatMinutes, logTime, plural } from "@/lib/utils";

type AlarmsState = {
  status: "idle" | "reading" | "done" | "error";
  fileName: string | null;
  result: LogAnalysis | null;
  error: string | null;
  read: (file: File, asset: string | null) => Promise<void>;
  reset: () => void;
};

/** Kept outside the page so the result survives switching tabs. */
const useAlarms = create<AlarmsState>((set) => ({
  status: "idle",
  fileName: null,
  result: null,
  error: null,
  read: async (file, asset) => {
    set({ status: "reading", fileName: file.name, result: null, error: null });
    try {
      set({ status: "done", result: await api.analyzeLog(file, asset) });
    } catch (err) {
      set({ status: "error", error: err instanceof ApiError ? err.message : "Couldn’t read that log." });
    }
  },
  reset: () => set({ status: "idle", fileName: null, result: null, error: null }),
}));

const SAMPLES = [
  { file: "alarm_log_tp02.csv", label: "TP-02 HMI alarm export (CSV)", type: "text/csv" },
  { file: "cycle_log_ac2.txt", label: "AC-2 controller log (text)", type: "text/plain" },
];

function Picker({ assets }: { assets: Asset[] }) {
  const read = useAlarms((s) => s.read);
  const [asset, setAsset] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const accept = (file?: File) => file && void read(file, asset || null);

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
          accept(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-4 rounded-(--radius-card) border border-dashed px-6 py-12 text-center transition-[background-color,border-color] duration-150 ease-out",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface",
        )}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-text">
          <FileText className="size-6" strokeWidth={1.75} />
        </span>
        <div>
          <p className="font-medium">Drop a machine or instrument log</p>
          <p className="mt-1 text-sm text-fg-muted">
            An HMI alarm export (CSV) or a controller printout (text). Up to 2 MB.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Select
            label="Machine"
            prefix="Machine"
            variant="control"
            value={asset || null}
            onChange={(v) => setAsset(v ?? "")}
            options={[
              { value: null, label: "Detect from the log" },
              ...assets.map((a) => ({ value: a.tag, label: a.tag, detail: a.equipment_model })),
            ]}
          />
          <Button variant="primary" onClick={() => input.current?.click()}>
            Choose log file
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,.log,.tsv,text/plain,text/csv"
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-subtle">No log handy? Try a sample:</span>
        {SAMPLES.map((s) => (
          <button
            key={s.file}
            type="button"
            onClick={() =>
              sampleFile(s.file, s.type).then(
                (file) => accept(file),
                () => toast.error("Couldn’t load the sample"),
              )
            }
            className="h-8 rounded-full bg-surface-2 px-3 text-[0.8125rem] text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-3 hover:text-fg active:scale-[0.97]"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Estimate({ code }: { code: LogCodeSummary }) {
  const d = code.downtime;
  if (!d || (!d.manual_minutes && !d.history_minutes)) return null;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {d.manual_minutes ? (
        <span className="flex items-center gap-1.5 text-sm">
          <Clock className="size-4 text-fg-subtle" />
          <span className="text-fg-muted">Manual:</span>
          <span className="tabular font-semibold">~{formatMinutes(d.manual_minutes)}</span>
        </span>
      ) : null}
      {d.history_minutes ? (
        <span className="flex items-center gap-1.5 text-sm">
          <History className="size-4 text-fg-subtle" />
          <span className="text-fg-muted">{d.history_records > 1 ? "Past repairs, median:" : "Last time:"}</span>
          <span className="tabular font-semibold">{formatMinutes(d.history_minutes)}</span>
        </span>
      ) : null}
    </div>
  );
}

function ErrorCard({ code, onGuide }: { code: LogCodeSummary; onGuide: () => void }) {
  return (
    <Card className="overflow-hidden shadow-[0_0_0_1px_oklch(0.58_0.2_27/0.35),0_4px_16px_-6px_oklch(0.58_0.2_27/0.2)] transition-[opacity,translate] duration-250 ease-out starting:translate-y-2 starting:opacity-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-danger-soft/60 px-4 py-3">
        <OctagonAlert className="size-4.5 text-danger-text" />
        {code.code && <Badge tone="danger" className="font-mono">{code.code}</Badge>}
        <h3 className="font-semibold">{code.message}</h3>
        <span className="ml-auto text-[0.8125rem] text-danger-text">
          {code.stops_machine ? "Stopped the machine" : "Error"}
          {code.last_seen && ` at ${logTime(code.last_seen)}`}
          {code.count > 1 && ` · ${code.count} times`}
        </span>
      </div>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {code.immediate_actions.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <SectionLabel>Do first, from the manual</SectionLabel>
              {code.section && <CitationChip id={code.section.id} />}
            </div>
            <ol className="flex flex-col gap-1.5">
              {code.immediate_actions.map((action, i) => (
                <li key={i} className="flex gap-2.5 text-[0.9375rem] leading-6">
                  <span className="tabular mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[0.6875rem] font-semibold text-fg-muted">
                    {i + 1}
                  </span>
                  {action}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">This code is not in any manual’s alarm table.</p>
        )}
        {code.likely_causes.length > 0 && (
          <div className="flex flex-col gap-2">
            <SectionLabel>Likely causes</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {code.likely_causes.map((cause) => (
                <Badge key={cause}>{cause}</Badge>
              ))}
            </div>
          </div>
        )}
        <Estimate code={code} />
        {code.history.length > 0 && (
          <p className="text-[0.8125rem] text-fg-muted">
            Happened before:
            {code.history.map((m) => (
              <CitationChip key={m.id} id={m.id} />
            ))}
          </p>
        )}
        <Button variant="primary" className="self-start" onClick={onGuide}>
          Draft repair guide
          <ArrowRight />
        </Button>
      </div>
    </Card>
  );
}

function WarningCard({ code, onGuide }: { code: LogCodeSummary; onGuide: () => void }) {
  const rising = code.trend?.includes("rising");
  return (
    <Card className="flex flex-col gap-3 p-4 transition-[opacity,translate] duration-250 ease-out starting:translate-y-2 starting:opacity-0">
      <div className="flex flex-wrap items-center gap-2">
        <TriangleAlert className="size-4 text-warn" />
        {code.code && <Badge tone="warn" className="font-mono">{code.code}</Badge>}
        <h3 className="font-medium">{code.message}</h3>
        {rising && (
          <Badge tone="warn">
            <TrendingUp />
            Rising
          </Badge>
        )}
        <span className="tabular ml-auto text-[0.8125rem] text-fg-muted">{plural(code.count, "time")}</span>
      </div>
      {code.trend && (
        <p className="text-[0.8125rem] leading-5 text-fg-muted">
          <CitedText text={code.trend} />
        </p>
      )}
      {code.immediate_actions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {code.immediate_actions.map((a, i) => (
            <li key={i} className="flex gap-2 text-sm text-fg">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-warn" />
              {a}
            </li>
          ))}
        </ul>
      )}
      {rising && (
        <Button variant="secondary" size="sm" className="self-start" onClick={onGuide}>
          Plan a fix before it stops
        </Button>
      )}
    </Card>
  );
}

function Result({ result }: { result: LogAnalysis }) {
  const router = useRouter();
  const by = useActorName();
  const { remember, rememberSections } = useRecords();
  const reset = useAlarms((s) => s.reset);

  useEffect(() => {
    const codes = [...result.errors, ...result.warnings];
    remember(codes.flatMap((c) => c.history.flatMap((m) => (m.record ? [m.record] : []))));
    rememberSections(codes.flatMap((c) => (c.section ? [c.section] : [])));
  }, [result, remember, rememberSections]);

  const toGuide = async (code: LogCodeSummary) => {
    const store = useBreakdown.persist;
    if (!store.hasHydrated()) await store.rehydrate();
    const { setText, setAssetTag, run } = useBreakdown.getState();
    setText(code.guide_prompt);
    setAssetTag(result.asset_tag ?? null);
    void run(by);
    router.push("/");
  };

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="flex items-center gap-2">
          {result.asset_tag ? <Badge tone="accent">{result.asset_tag}</Badge> : <Badge>Machine not identified</Badge>}
          <span className="truncate text-sm text-fg-muted">{result.source_ref}</span>
        </span>
        {result.start && (
          <span className="tabular text-sm text-fg-muted">
            {logTime(result.start)} → {logTime(result.end)}
          </span>
        )}
        <span className="text-sm text-fg-muted">
          {plural(result.total_events, "event")} · {plural(result.errors.length, "error")} ·{" "}
          {plural(result.warnings.length, "warning")}
        </span>
        <Badge className="ml-auto">{result.parser === "table" ? "Read as an alarm table" : "Read by Gemini"}</Badge>
        <Button variant="ghost" size="sm" onClick={reset}>
          <RefreshCw />
          Another log
        </Button>
      </Card>

      {result.notes.length > 0 && (
        <ul className="flex flex-col gap-1 text-[0.8125rem] text-fg-muted">
          {result.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}

      {result.errors.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionLabel>Stopped the machine</SectionLabel>
          {result.errors.map((code) => (
            <ErrorCard key={code.code ?? code.message} code={code} onGuide={() => void toGuide(code)} />
          ))}
        </section>
      ) : (
        <Card className="p-5 text-sm text-fg-muted">No errors in this log. The machine did not stop on an alarm.</Card>
      )}

      {result.warnings.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionLabel>Warnings (machine kept running)</SectionLabel>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {result.warnings.map((code) => (
              <WarningCard key={code.code ?? code.message} code={code} onGuide={() => void toGuide(code)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function AlarmsView() {
  const { status, fileName, result, error, reset } = useAlarms();
  const [assets, setAssets] = useState<Asset[]>([]);
  useEffect(() => {
    api.assets().then(setAssets, () => undefined);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Read a machine log</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-muted text-pretty">
          Errors that stopped the machine come first, with the manual’s first actions and how long the fix usually
          takes. Warnings that keep rising are flagged before they stop the line.
        </p>
      </header>
      {status === "idle" && <Picker assets={assets} />}
      {status === "reading" && (
        <Card className="flex items-center gap-3 p-5" aria-live="polite">
          <span className="size-4 animate-spin-fast rounded-full border-2 border-accent border-r-transparent" />
          <div>
            <p className="font-medium">Reading {fileName}</p>
            <p className="text-sm text-fg-muted">Matching each alarm to the manual and past fixes. About 5 to 15 seconds.</p>
          </div>
        </Card>
      )}
      {status === "error" && (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="font-medium">Couldn’t read that log</p>
          <p className="text-sm text-fg-muted">{error}</p>
          <Button size="sm" onClick={reset}>
            Try another file
          </Button>
        </Card>
      )}
      {status === "done" && result && <Result result={result} />}
    </div>
  );
}
