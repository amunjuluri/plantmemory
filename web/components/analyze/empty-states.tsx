"use client";

import { AlertCircle, FileCheck2, RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";

const POINTS = [
  {
    icon: Search,
    title: "Finds past incidents by meaning",
    body: "“Web brk after PR2” and “sheet breaks at the second press” match, even with no words in common.",
  },
  {
    icon: RotateCcw,
    title: "Flags repeats",
    body: "Warns when the same problem came back, and when a past fix didn’t hold.",
  },
  {
    icon: FileCheck2,
    title: "Drafts a cited note",
    body: "Every claim links to the record it came from. You review, edit and approve.",
  },
];

export function IdleState() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    api
      .incidents({ limit: 1 })
      .then((page) => setCount(page.total))
      .catch(() => undefined);
  }, []);

  return (
    <div className="flex flex-col gap-6 rounded-(--radius-card) border border-dashed border-line-strong p-6 sm:p-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">How it works</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {count === null
            ? "Searching your plant’s past incidents."
            : `Searching ${count} past incidents in plant memory.`}
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {POINTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex flex-col gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-text">
              <Icon className="size-4" />
            </span>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-[0.8125rem] leading-5 text-fg-muted">{body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={`animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--color-surface-2)_25%,var(--color-surface-3)_50%,var(--color-surface-2)_75%)] bg-[length:200%_100%] ${className}`}
    />
  );
}

export function LoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="flex flex-col gap-3 p-4">
            <Shimmer className="h-3 w-32" />
            <Shimmer className="h-4 w-48" />
            <Shimmer className="h-3 w-full" />
            <Shimmer className="h-10 w-full" />
          </Card>
        ))}
      </div>
      <Card className="flex flex-col gap-3 p-5">
        <Shimmer className="h-4 w-40" />
        <Shimmer className="h-3 w-full" />
        <Shimmer className="h-3 w-11/12" />
        <Shimmer className="h-3 w-3/4" />
      </Card>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-5">
      <span className="grid size-8 place-items-center rounded-lg bg-danger-soft text-danger-text">
        <AlertCircle className="size-4" />
      </span>
      <div>
        <p className="font-medium">The draft couldn’t be finished</p>
        <p className="mt-1 text-sm text-fg-muted">{message}</p>
      </div>
      <Button onClick={onRetry} size="sm">
        Try again
      </Button>
    </Card>
  );
}
