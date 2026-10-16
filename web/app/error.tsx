"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { reportError } from "@/lib/telemetry";

/** A page that crashed while rendering: reported to Error Reporting, with a way back. */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError(error, { kind: "render", fatal: true, digest: error.digest });
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 py-16">
      <span className="grid size-10 place-items-center rounded-xl bg-danger-soft text-danger-text">
        <AlertTriangle className="size-5" />
      </span>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">This page stopped working</h1>
        <p className="mt-1.5 text-sm text-fg-muted text-pretty">
          It has been reported to us automatically. Your guides and records are safe; try the page again, or go
          back to Breakdown.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => retry()}>
          <RotateCcw />
          Try again
        </Button>
        <Link href="/" className={buttonVariants({ variant: "secondary" })}>
          Back to Breakdown
        </Link>
      </div>
    </div>
  );
}
