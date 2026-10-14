"use client";

import { AlertTriangle, ClipboardList, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { api, type GuideStatus, type GuideSummary } from "@/lib/api";
import { useSession } from "@/lib/stores/session";
import { formatDateTime, plural } from "@/lib/utils";
import { StatusBadge } from "./meta";

type Filter = "all" | GuideStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in_review", label: "Waiting for QA" },
  { value: "approved", label: "Approved" },
  { value: "draft", label: "Drafts" },
  { value: "rejected", label: "Sent back" },
  { value: "closed", label: "Waiting for release" },
  { value: "released", label: "Released" },
];

function Row({ guide }: { guide: GuideSummary }) {
  return (
    <li>
      <Link
        href={`/guides/view/?id=${encodeURIComponent(guide.id)}`}
        className="grid grid-cols-1 gap-2 px-4 py-3.5 transition-[background-color] duration-150 ease-out hover:bg-surface-2 md:grid-cols-[8.5rem_minmax(0,1fr)_auto] md:items-center md:gap-4"
      >
        <span className="flex items-center gap-2 md:contents">
          <StatusBadge status={guide.status} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{guide.title}</span>
          <span className="block truncate text-[0.8125rem] text-fg-muted">
            {guide.asset_tag ?? "Machine not identified"} · {plural(guide.steps, "step")} · by {guide.author ?? "unknown"}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-3 text-xs text-fg-subtle md:justify-end">
          {guide.flags > 0 && (
            <span className="flex items-center gap-1 text-warn-text">
              <AlertTriangle className="size-3.5" />
              {plural(guide.flags, "check")}
            </span>
          )}
          {guide.copies_printed > 0 && (
            <span className="flex items-center gap-1">
              <Printer className="size-3.5" />
              {guide.copies_printed}
            </span>
          )}
          <span className="tabular">{formatDateTime(guide.updated_at)}</span>
        </span>
      </Link>
    </li>
  );
}

export function GuidesList() {
  const role = useSession((s) => s.role);
  // QA lands on their queue until they pick another filter.
  const [picked, setPicked] = useState<Filter | null>(null);
  const filter: Filter = picked ?? (role === "qa" ? "in_review" : "all");
  const [loaded, setLoaded] = useState<{ filter: Filter; guides: GuideSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guides = loaded?.filter === filter ? loaded.guides : null;

  useEffect(() => {
    let live = true;
    api.guides(filter === "all" ? null : filter).then(
      (list) => {
        if (!live) return;
        setLoaded({ filter, guides: list });
        setError(null);
      },
      (err: unknown) => live && setError(err instanceof Error ? err.message : "Couldn’t load guides."),
    );
    return () => {
      live = false;
    };
  }, [filter]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Repair guides</h1>
          <p className="mt-1.5 text-[0.9375rem] text-fg-muted">
            Every guide from draft to approval, printing, closure and release, with who did what.
          </p>
        </div>
      </header>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-tour="guides-filters">
        <Segmented label="Show" size="sm" options={FILTERS} value={filter} onChange={setPicked} />
      </div>
      <Card className="overflow-hidden">
        {error ? (
          <p className="p-5 text-sm text-danger-text">{error}</p>
        ) : guides === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-muted">
            <Spinner /> Loading
          </div>
        ) : guides.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <ClipboardList className="size-6 text-fg-subtle" />
            <div>
              <p className="font-medium">{filter === "in_review" ? "Nothing waiting for QA" : "No guides here yet"}</p>
              <p className="mt-1 text-sm text-fg-muted">Guides appear here once a manager drafts one for a breakdown.</p>
            </div>
            <Link href="/" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Report a breakdown
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {guides.map((guide) => (
              <Row key={guide.id} guide={guide} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
