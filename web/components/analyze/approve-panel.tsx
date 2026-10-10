"use client";

import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { api, ApiError, type Outcome } from "@/lib/api";
import { useAnalysis } from "@/lib/stores/analysis";
import { useRecords } from "@/lib/stores/records";

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "resolved", label: "Resolved" },
  { value: "recurred", label: "Came back" },
  { value: "unknown", label: "Not known yet" },
];

export function ApprovePanel() {
  const { draft, approvedId, markApproved, reset } = useAnalysis();
  const { remember, open } = useRecords();
  const [rootCause, setRootCause] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("unknown");
  const [downtime, setDowntime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!draft) return null;

  if (approvedId) {
    return (
      <Card className="flex flex-col items-start gap-4 p-5 transition-[opacity,scale] duration-250 ease-out starting:scale-[0.98] starting:opacity-0 sm:flex-row sm:items-center">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success-soft text-success-text">
          <CircleCheck className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Saved to plant memory</p>
          <p className="text-sm text-fg-muted">
            Saved as <span className="font-mono">{approvedId}</span>. The next search can find it.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => open(approvedId)}>
            View record
          </Button>
          <Button size="sm" variant="primary" onClick={reset}>
            New incident
          </Button>
        </div>
      </Card>
    );
  }

  const approve = async () => {
    setSaving(true);
    setError(null);
    const minutes = Number.parseInt(downtime, 10);
    try {
      const record = await api.approve({
        draft,
        root_cause: rootCause.trim() || null,
        action_taken: actionTaken.trim() || null,
        outcome,
        downtime_minutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : null,
      });
      remember([record]);
      markApproved(record.id);
      toast.success("Saved to plant memory", {
        description: `${record.id} will now show up in future searches.`,
        action: { label: "View", onClick: () => open(record.id) },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn’t save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="font-semibold tracking-tight">Approve and save</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Once you’ve checked the draft, save what you found. It becomes part of plant memory.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Root cause" htmlFor="root-cause" hint="Leave empty if it isn’t confirmed yet.">
          <Textarea
            id="root-cause"
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            placeholder="What actually caused it"
            className="min-h-20"
          />
        </Field>
        <Field label="What was done" htmlFor="action" hint="If empty, the suggested actions are saved as planned.">
          <Textarea
            id="action"
            value={actionTaken}
            onChange={(e) => setActionTaken(e.target.value)}
            placeholder="The fix, in a sentence or two"
            className="min-h-20"
          />
        </Field>
        <Field label="Outcome">
          <Segmented label="Outcome" options={OUTCOMES} value={outcome} onChange={setOutcome} className="w-full" />
        </Field>
        <Field label="Downtime" htmlFor="downtime">
          <div className="relative">
            <Input
              id="downtime"
              inputMode="numeric"
              pattern="[0-9]*"
              value={downtime}
              onChange={(e) => setDowntime(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="0"
              className="tabular pr-20"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-fg-subtle">
              minutes
            </span>
          </div>
        </Field>
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-fg-subtle">By approving, you confirm a qualified person reviewed this draft.</p>
        <Button variant="primary" onClick={approve} loading={saving}>
          Approve and save
        </Button>
      </div>
    </Card>
  );
}
