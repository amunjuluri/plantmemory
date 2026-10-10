"use client";

import { AlertCircle, CircleCheck, Info, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import type { Industry } from "@/lib/api";
import { useLogbook } from "@/lib/stores/logbook";
import { cn, plural } from "@/lib/utils";
import { Dropzone } from "./dropzone";
import { RecordEditor } from "./record-editor";

const INDUSTRIES: { value: "auto" | Industry; label: string }[] = [
  { value: "auto", label: "Detect" },
  { value: "paper", label: "Paper" },
  { value: "pharma", label: "Pharma" },
];

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular">{Math.floor((now - since) / 1000)}s</span>;
}

function PhotoPanel() {
  const { previewUrl, fileName, status, startedAt } = useLogbook();
  if (!previewUrl) return null;
  const reading = status === "reading";
  return (
    <Card className="overflow-hidden">
      <div className="relative bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
        <img
          src={previewUrl}
          alt="The logbook page being read"
          className={cn("max-h-[70dvh] w-full object-contain transition-[opacity] duration-300", reading && "opacity-80")}
        />
        {reading && (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1/4 animate-[scan_2.2s_var(--ease-in-out)_infinite_alternate] bg-gradient-to-b from-transparent via-accent/25 to-transparent" />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
        <span className="truncate text-fg-muted">{fileName}</span>
        {reading && startedAt && (
          <span className="shrink-0 text-xs text-fg-subtle">
            Reading… <Elapsed since={startedAt} />
          </span>
        )}
      </div>
    </Card>
  );
}

function ReviewList() {
  const { records, pageNotes, status, error, save, reset } = useLogbook();
  const flagged = records.reduce((n, r) => n + r.confidence_flags.length, 0);

  if (status === "reading") {
    return (
      <Card className="flex flex-col gap-2 p-5" aria-live="polite">
        <p className="font-medium">Reading the handwriting</p>
        <p className="text-sm text-fg-muted">
          Gemini is transcribing each entry and expanding short forms. This usually takes 10 to 40
          seconds.
        </p>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <span className="grid size-8 place-items-center rounded-lg bg-danger-soft text-danger-text">
          <AlertCircle className="size-4" />
        </span>
        <div>
          <p className="font-medium">Couldn’t read that photo</p>
          <p className="mt-1 text-sm text-fg-muted">{error}</p>
        </div>
        <Button size="sm" onClick={reset}>
          Try another photo
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {records.length ? `Found ${plural(records.length, "entry", "entries")}` : "No entries left"}
        </h2>
        {flagged > 0 && (
          <p className="text-sm text-warn-text">{plural(flagged, "field")} marked “Check”</p>
        )}
      </div>
      {pageNotes && (
        <p className="flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
          <Info className="mt-0.5 size-4 shrink-0" />
          {pageNotes}
        </p>
      )}
      {records.map((record, i) => (
        <RecordEditor key={record.id} record={record} index={i} />
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

function Saved() {
  const { savedIds, reset } = useLogbook();
  return (
    <Card className="flex flex-col items-start gap-4 p-6 transition-[opacity,scale] duration-250 ease-out starting:scale-[0.98] starting:opacity-0">
      <span className="grid size-10 place-items-center rounded-full bg-success-soft text-success-text">
        <CircleCheck className="size-5" />
      </span>
      <div>
        <p className="text-lg font-semibold tracking-tight">
          Saved {plural(savedIds.length, "record")} to plant memory
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          They’ll show up the next time anyone searches for a similar problem.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/memory/" className={buttonVariants({ variant: "secondary" })}>
          View in Memory
        </Link>
        <Button variant="primary" onClick={reset}>
          Digitize another page
        </Button>
      </div>
    </Card>
  );
}

export function LogbookView() {
  const { status, industry, setIndustry } = useLogbook();
  const idle = status === "idle";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Digitize a logbook page</h1>
          <p className="mt-1.5 text-[0.9375rem] text-fg-muted text-pretty">
            Turn handwritten entries into searchable records. Anything hard to read is marked for you to
            check. Nothing is saved until you confirm.
          </p>
        </div>
        {idle && (
          <Segmented
            label="Industry"
            size="sm"
            options={INDUSTRIES}
            value={industry ?? "auto"}
            onChange={(value) => setIndustry(value === "auto" ? null : value)}
          />
        )}
      </header>

      {idle ? (
        <Dropzone />
      ) : status === "saved" ? (
        <Saved />
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-20">
            <PhotoPanel />
          </div>
          <ReviewList />
        </div>
      )}
    </div>
  );
}
