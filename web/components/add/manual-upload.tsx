"use client";

import { ArrowRight, BookOpen, CircleCheck, FileUp, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { Figure } from "@/components/guide/meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { api, ApiError, sampleFile, type ManualUploadResult } from "@/lib/api";
import { useBreakdown } from "@/lib/stores/breakdown";
import { useRecords } from "@/lib/stores/records";
import { cn, formatMinutes, plural, SECTION_KIND_LABEL } from "@/lib/utils";

type UploadState = {
  status: "idle" | "reading" | "done" | "error";
  fileName: string | null;
  startedAt: number | null;
  result: ManualUploadResult | null;
  error: string | null;
  upload: (file: File, tags: string) => Promise<void>;
  reset: () => void;
};

const useUpload = create<UploadState>((set) => ({
  status: "idle",
  fileName: null,
  startedAt: null,
  result: null,
  error: null,
  upload: async (file, tags) => {
    set({ status: "reading", fileName: file.name, startedAt: Date.now(), result: null, error: null });
    try {
      set({ status: "done", result: await api.uploadManual(file, tags) });
    } catch (err) {
      set({ status: "error", error: err instanceof ApiError ? err.message : "Couldn’t read that manual." });
    }
  },
  reset: () => set({ status: "idle", fileName: null, startedAt: null, result: null, error: null }),
}));

function Picker() {
  const upload = useUpload((s) => s.upload);
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

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
          setFile(e.dataTransfer.files[0] ?? null);
        }}
        className={cn(
          "flex flex-col gap-5 rounded-(--radius-card) border border-dashed p-6 transition-[background-color,border-color] duration-150 ease-out sm:p-8",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface",
        )}
      >
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent-text">
            <FileUp className="size-6" strokeWidth={1.75} />
          </span>
          <div>
            <p className="font-medium">Add an equipment manual (PDF)</p>
            <p className="mt-1 text-sm text-fg-muted">
              Gemini reads it page by page: procedures, the alarm table, typical repair times and figures. Guides
              then cite it by page.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Manual" hint={file ? file.name : "PDF, up to 40 pages and 20 MB"}>
            <Button onClick={() => input.current?.click()} className="justify-start">
              {file ? "Change file" : "Choose PDF"}
            </Button>
          </Field>
          <Field label="Machines it covers" hint="Their parts and alarms link to this manual." htmlFor="manual-tags">
            <Input id="manual-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. FBD-1" />
          </Field>
        </div>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button variant="primary" className="self-start" disabled={!file} onClick={() => file && upload(file, tags)}>
          Read the manual
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-subtle">Try a sample:</span>
        <button
          type="button"
          onClick={() =>
            sampleFile("manual_fbd120.pdf", "application/pdf").then(
              (f) => upload(f, "FBD-1"),
              () => toast.error("Couldn’t load the sample"),
            )
          }
          className="h-8 rounded-full bg-surface-2 px-3 text-[0.8125rem] text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-3 hover:text-fg active:scale-[0.97]"
        >
          Fluid bed dryer FBD-1 manual (6 pages)
        </button>
      </div>
    </div>
  );
}

function Done({ result }: { result: ManualUploadResult }) {
  const router = useRouter();
  const { open, rememberSections } = useRecords();
  const reset = useUpload((s) => s.reset);
  const { summary, sections } = result;
  const figures = sections.flatMap((s) => s.figure_ids.map((id) => ({ id, section: s })));
  const firstCode = sections.flatMap((s) => (s.kind === "troubleshooting" ? s.error_codes : []))[0];
  const tag = summary.asset_tags[0];

  const tryIt = async () => {
    const store = useBreakdown.persist;
    if (!store.hasHydrated()) await store.rehydrate();
    const { setText, setAssetTag, reset: clear } = useBreakdown.getState();
    clear();
    setText(`${tag ?? summary.equipment_model} stopped${firstCode ? ` with alarm ${firstCode}` : ""}.`);
    setAssetTag(tag ?? null);
    router.push("/");
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5 transition-[opacity,scale] duration-250 ease-out starting:scale-[0.98] starting:opacity-0">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success-soft text-success-text">
            <CircleCheck className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-semibold tracking-tight">{summary.manual_title}</p>
            <p className="mt-0.5 text-sm text-fg-muted">
              {summary.equipment_model}
              {summary.asset_tags.length > 0 && ` · ${summary.asset_tags.join(", ")}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="accent">{plural(summary.sections, "section")}</Badge>
          <Badge>{plural(summary.error_codes, "alarm code")}</Badge>
          <Badge>{plural(summary.figures, "figure")}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {tag && (
            <Button variant="primary" onClick={() => void tryIt()}>
              Try a breakdown on {tag}
              <ArrowRight />
            </Button>
          )}
          <Button variant="ghost" onClick={reset}>
            <RefreshCw />
            Add another manual
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  rememberSections([s]);
                  open(s.id);
                }}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-[background-color] duration-150 ease-out hover:bg-surface-2"
              >
                <span className="tabular w-10 font-mono text-xs text-fg-subtle">p.{s.page}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.title}</span>
                <span className="flex flex-wrap gap-1">
                  <Badge>{SECTION_KIND_LABEL[s.kind]}</Badge>
                  {s.error_codes.slice(0, 4).map((c) => (
                    <Badge key={c} className="font-mono">
                      {c}
                    </Badge>
                  ))}
                  {s.repair_minutes ? <Badge>~{formatMinutes(s.repair_minutes)}</Badge> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {figures.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {figures.map(({ id, section }) => (
            <Figure key={id} id={id} caption={`p.${section.page}: ${section.title}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular">{Math.floor((now - since) / 1000)}s</span>;
}

export function ManualUpload() {
  const { status, fileName, startedAt, result, error, reset } = useUpload();
  if (status === "idle") return <Picker />;
  if (status === "reading") {
    return (
      <Card className="flex items-center gap-3 p-5" aria-live="polite">
        <BookOpen className="size-5 shrink-0 text-accent-text" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Reading {fileName}</p>
          <p className="text-sm text-fg-muted">
            Gemini is reading each page, the alarm table and the figures. Usually 15 to 60 seconds.
          </p>
        </div>
        {startedAt && (
          <span className="text-xs text-fg-subtle">
            <Elapsed since={startedAt} />
          </span>
        )}
      </Card>
    );
  }
  if (status === "error") {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <p className="font-medium">Couldn’t read that manual</p>
        <p className="text-sm text-fg-muted">{error}</p>
        <Button size="sm" onClick={reset}>
          Try another file
        </Button>
      </Card>
    );
  }
  return result ? <Done result={result} /> : null;
}
