"use client";

import { CheckCheck, ClipboardCheck, Lock, Mic, Pencil, Printer, Send, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { VoicePanel } from "@/components/voice-panel";
import { api, type Guide, type Outcome } from "@/lib/api";
import { useActorName, useSession } from "@/lib/stores/session";
import { cn, formatDateTime } from "@/lib/utils";
import { STATUS_LABEL } from "./meta";

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "resolved", label: "Fixed" },
  { value: "recurred", label: "Came back" },
  { value: "unknown", label: "Not sure yet" },
];

function errorText(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function RejectDialog({ guide, onDone }: { guide: Guide; onDone: (g: Guide) => void }) {
  const by = useActorName();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      onDone(await api.reviewGuide(guide.id, by, "reject", comment));
      setOpen(false);
      toast("Sent back to the manager", { description: "They’ll see your reason at the top of the guide." });
    } catch (err) {
      toast.error("Couldn’t send it back", { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Undo2 />
        Send back
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Send back to the manager" description="Say what needs to change. The manager edits the guide and sends it again.">
        <Textarea
          autoFocus
          aria-label="What needs to change"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="e.g. Step 6 must say the engineer replaces the bushing, not the operator."
          className="min-h-28"
          maxLength={2000}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} loading={busy} disabled={!comment.trim()}>
            Send back
          </Button>
        </div>
      </Modal>
    </>
  );
}

function CloseDialog({ guide, onDone }: { guide: Guide; onDone: (g: Guide) => void }) {
  const by = useActorName();
  const [open, setOpen] = useState(false);
  const [voice, setVoice] = useState(false);
  const [action, setAction] = useState("");
  const [cause, setCause] = useState("");
  const [parts, setParts] = useState(guide.parts.map((p) => p.part_no).join(", "));
  const [minutes, setMinutes] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("resolved");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const closed = await api.closeGuide(guide.id, {
        by,
        action_taken: action.trim(),
        root_cause: cause.trim() || null,
        parts_used: parts.trim() || null,
        downtime_minutes: minutes ? Number(minutes) : null,
        outcome,
      });
      onDone(closed);
      setOpen(false);
      toast.success("Saved to plant memory", {
        description: `The next search for this problem will find ${closed.closure_record_id}.`,
      });
    } catch (err) {
      toast.error("Couldn’t close the guide", { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Lock />
        Close breakdown
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="What was actually done?"
        description="This is saved to plant memory, so the next breakdown like this finds it."
        className="max-w-xl"
      >
        {voice ? (
          <VoicePanel
            mode="closure"
            doneLabel="Use this"
            onClose={() => setVoice(false)}
            onDone={(result) => {
              const f = result.state.fields;
              if (f.action_taken) setAction(f.action_taken);
              if (f.root_cause) setCause(f.root_cause);
              if (f.parts_used) setParts(f.parts_used);
              if (f.downtime_minutes != null) setMinutes(String(f.downtime_minutes));
              if (f.outcome) setOutcome(f.outcome);
              setVoice(false);
            }}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Button variant="secondary" className="self-start" onClick={() => setVoice(true)}>
              <Mic />
              Speak it instead
            </Button>
            <Field label="What was done" htmlFor="close-action">
              <Textarea id="close-action" value={action} onChange={(e) => setAction(e.target.value)} maxLength={4000} />
            </Field>
            <Field label="What caused it" hint="Leave empty if not known yet." htmlFor="close-cause">
              <Textarea id="close-cause" value={cause} onChange={(e) => setCause(e.target.value)} className="min-h-10" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Parts used" htmlFor="close-parts">
                <Input id="close-parts" value={parts} onChange={(e) => setParts(e.target.value)} />
              </Field>
              <Field label="Downtime (minutes)" htmlFor="close-minutes">
                <Input
                  id="close-minutes"
                  inputMode="numeric"
                  className="tabular"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 5))}
                />
              </Field>
            </div>
            <Field label="Is it fixed?">
              <Segmented label="Outcome" options={OUTCOMES} value={outcome} onChange={setOutcome} className="w-full" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} loading={busy} disabled={action.trim().length < 3}>
                Save to memory
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/** The next action for this guide, depending on its state and who is acting. */
export function GuideActions({
  guide,
  onChange,
  onEdit,
  editing,
}: {
  guide: Guide;
  onChange: (g: Guide) => void;
  onEdit: () => void;
  editing: boolean;
}) {
  const router = useRouter();
  const role = useSession((s) => s.role);
  const by = useActorName();
  const [busy, setBusy] = useState<"submit" | "approve" | null>(null);
  if (editing) return null;

  const submit = async () => {
    setBusy("submit");
    const id = toast.loading("Translating into the shop-floor languages…", {
      description: "Then it goes to QA. About 10 to 20 seconds.",
    });
    try {
      const sent = await api.submitGuide(guide.id, by);
      onChange(sent);
      const flags = sent.translations.reduce((n, t) => n + t.flags.length, 0);
      toast.success("Sent to QA", {
        id,
        description: flags
          ? `${flags} translated line${flags > 1 ? "s" : ""} flagged for QA to check.`
          : "Switch to QA in the top bar to review it.",
      });
      router.push(`/guides/view/?id=${encodeURIComponent(sent.id)}`);
    } catch (err) {
      toast.error("Couldn’t send to QA", { id, description: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    setBusy("approve");
    try {
      onChange(await api.reviewGuide(guide.id, by, "approve"));
      toast.success("Approved for printing", { description: "The manager can print it now." });
    } catch (err) {
      toast.error("Couldn’t approve", { description: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const submitter = [...guide.events].reverse().find((e) => e.action === "submitted")?.by;
  const ownGuide = submitter && submitter.trim().toLowerCase() === by.trim().toLowerCase();

  let hint: string | null = null;
  let actions: React.ReactNode = null;
  const s = guide.status;
  if (s === "draft" || s === "rejected") {
    hint =
      role === "qa"
        ? "The manager sends this to QA when it’s ready."
        : "Check the steps, then send it to QA. It’s translated on the way.";
    actions = (
      <>
        <Button onClick={onEdit}>
          <Pencil />
          Edit
        </Button>
        <Button variant="primary" onClick={submit} loading={busy === "submit"}>
          <Send />
          Send to QA
        </Button>
      </>
    );
  } else if (s === "in_review") {
    if (role === "qa" && !ownGuide) {
      hint = "Check the steps and each translation, then decide.";
      actions = (
        <>
          <RejectDialog guide={guide} onDone={onChange} />
          <Button variant="primary" onClick={approve} loading={busy === "approve"}>
            <CheckCheck />
            Approve for printing
          </Button>
        </>
      );
    } else {
      hint = ownGuide
        ? "You sent this guide, so someone else must review it. Switch to QA (top bar) with another name."
        : "Waiting for QA. Switch to QA in the top bar to review it.";
    }
  } else if (s === "approved") {
    hint =
      guide.copies_printed > 0
        ? `${guide.copies_printed} cop${guide.copies_printed > 1 ? "ies" : "y"} printed. Close it once the machine is running.`
        : "Print it for the workers.";
    actions = (
      <>
        <CloseDialog guide={guide} onDone={onChange} />
        <Link href={`/guides/print/?id=${encodeURIComponent(guide.id)}`} className={buttonVariants({ variant: "primary" })}>
          <Printer />
          Print
        </Link>
      </>
    );
  } else if (s === "closed") {
    hint = "Closed and saved to plant memory.";
  }

  return (
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-10 md:bottom-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) bg-surface/90 p-3 pl-4 shadow-raised backdrop-blur-xl">
        <p className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-fg-muted">
          <ClipboardCheck className="size-4 shrink-0" />
          <span>
            <span className="font-medium text-fg">{STATUS_LABEL[s]}.</span> {hint}
          </span>
        </p>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const ACTION_LABEL = {
  created: "Drafted",
  edited: "Edited",
  submitted: "Sent to QA",
  approved: "Approved",
  rejected: "Sent back",
  printed: "Printed",
  closed: "Closed",
} as const;

export function AuditTrail({ guide }: { guide: Guide }) {
  return (
    <ol className="flex flex-col">
      {guide.events.map((event, i) => (
        <li key={i} className="relative flex gap-3 pb-3.5 last:pb-0">
          {i < guide.events.length - 1 && <span aria-hidden className="absolute top-4 bottom-0 left-[4.5px] w-px bg-line-strong" />}
          <span
            aria-hidden
            className={cn(
              "mt-1.5 size-2.5 shrink-0 rounded-full",
              event.action === "approved" || event.action === "closed"
                ? "bg-success"
                : event.action === "rejected"
                  ? "bg-danger"
                  : "bg-fg-subtle",
            )}
          />
          <div className="min-w-0 text-[0.8125rem] leading-5">
            <p>
              <span className="font-medium">{ACTION_LABEL[event.action]}</span>{" "}
              <span className="text-fg-muted">by {event.by}</span>
              <span className="text-fg-subtle"> · {formatDateTime(event.at)}</span>
            </p>
            {event.comment && <p className="mt-0.5 text-fg-muted">“{event.comment}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
