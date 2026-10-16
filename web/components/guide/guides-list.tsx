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

type Filter = "open" | "in_review" | "closed" | "released" | "withdrawn" | "all";

/** Grouped by what someone has to do: everything still open (drafts, sent back, with QA,
 * approved), QA's two queues, then the finished ones. */
const FILTERS: { value: Filter; label: string; statuses: GuideStatus[] | null }[] = [
  { value: "open", label: "Open", statuses: ["draft", "rejected", "in_review", "approved"] },
  { value: "in_review", label: "Waiting for QA", statuses: ["in_review"] },
  { value: "closed", label: "Waiting for release", statuses: ["closed"] },
  { value: "released", label: "Released", statuses: ["released"] },
  { value: "withdrawn", label: "Withdrawn", statuses: ["withdrawn"] },
  { value: "all", label: "All", statuses: null },
];

const matches = (filter: Filter, guide: GuideSummary) => {
  const statuses = FILTERS.find((f) => f.value === filter)?.statuses;
  return !statuses || statuses.includes(guide.status);
};

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
  const filter: Filter = picked ?? (role === "qa" ? "in_review" : "open");
  const [all, setAll] = useState<GuideSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guides = all?.filter((g) => matches(filter, g)) ?? null;
  const options = FILTERS.map((f) => ({
    value: f.value,
    label: (
      <>
        {f.label}
        {all && (
          <span className="tabular ml-1.5 text-fg-subtle">{all.filter((g) => matches(f.value, g)).length}</span>
        )}
      </>
    ),
  }));

  // One list, filtered here: a few hundred rows at most, and every filter shows its count.
  useEffect(() => {
    let live = true;
    api.guides().then(
      (list) => {
        if (!live) return;
        setAll(list);
        setError(null);
      },
      (err: unknown) => live && setError(err instanceof Error ? err.message : "Couldn’t load guides."),
    );
    return () => {
      live = false;
    };
  }, []);

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
        <Segmented label="Show" size="sm" options={options} value={filter} onChange={setPicked} />
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
              <p className="font-medium">
                {filter === "in_review"
                  ? "Nothing waiting for QA"
                  : filter === "closed"
                    ? "No machine waiting for release"
                    : filter === "open"
                      ? "No open guides"
                      : "No guides here yet"}
              </p>
              <p className="mt-1 text-sm text-fg-muted">Guides appear here once a manager drafts one for a breakdown.</p>
            </div>
            <Link href="/" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Report a breakdown
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line" data-tour="guides-list">
            {guides.map((guide) => (
              <Row key={guide.id} guide={guide} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
