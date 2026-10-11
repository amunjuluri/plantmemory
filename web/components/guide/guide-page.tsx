"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ErrorState, Shimmer } from "@/components/ui/states";
import { api, type Guide } from "@/lib/api";
import { GuideView } from "./guide-view";

export function GuidePage() {
  const id = useSearchParams().get("id");
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    let live = true;
    api.guide(id).then(
      (g) => live && (setGuide(g), setError(null)),
      (err: unknown) => live && setError(err instanceof Error ? err.message : "Couldn’t load the guide."),
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Link
        href="/guides/"
        className="inline-flex items-center gap-1.5 self-start rounded-lg text-sm text-fg-muted transition-[color] duration-150 ease-out hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        All guides
      </Link>
      {!id ? (
        <ErrorState title="No guide chosen" message="Open a guide from the list." />
      ) : error ? (
        <ErrorState title="Couldn’t load the guide" message={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : guide ? (
        <GuideView guide={guide} onChange={setGuide} />
      ) : (
        <div className="flex flex-col gap-3" aria-hidden>
          <Shimmer className="h-5 w-40" />
          <Shimmer className="h-7 w-3/4" />
          <Shimmer className="h-24 w-full" />
          <Shimmer className="h-40 w-full" />
        </div>
      )}
    </div>
  );
}
