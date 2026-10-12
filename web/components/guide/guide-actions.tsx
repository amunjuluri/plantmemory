"use client";

import { Check, CheckCheck, ClipboardCheck, Factory, Lock, Pencil, Printer, Send, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { TranslatingLoader } from "@/components/ui/loaders";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { VoiceIcon } from "@/components/voice/icons";
import { LiveVoice } from "@/components/voice/live-voice";
import { api, type Guide, type IntakeFields, type Outcome } from "@/lib/api";
import { useLiveVoice } from "@/lib/stores/live-voice";
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
  const [heard, setHeard] = useState(false);

  // Fields fill in while the manager talks, so they can see what will be saved.
  const fill = (f: IntakeFields) => {
    if (f.action_taken) setAction(f.action_taken);
    if (f.root_cause) setCause(f.root_cause);
    if (f.parts_used) setParts(f.parts_used);
    if (f.downtime_minutes != null) setMinutes(String(f.downtime_minutes));
    if (f.outcome) setOutcome(f.outcome);
  };

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
      toast.success("Closed and saved to plant memory", {
        description: `The next search for this problem will find ${closed.closure_record_id}. QA releases the machine to production.`,
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
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setVoice(false);
        }}
        title="What was actually done?"
        description="This is saved to plant memory, so the next breakdown like this finds it."
        className="max-w-xl"
      >
        <div className="flex flex-col gap-4">
          {voice ? (
            <div className="rounded-xl p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <LiveVoice
                mode="closure"
                guideId={guide.id}
                doneLabel="Use these answers"
                onClose={() => setVoice(false)}
                onFields={fill}
                onDone={(result) => {
                  fill(result.state.fields);
                  setVoice(false);
                  setHeard(true);
                }}
              />
            </div>
          ) : heard ? (
            <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-[0.8125rem] text-success-text">
              <Check className="size-4 shrink-0" strokeWidth={2.5} />
              Filled in from what you said. If the fields are right, save to close the breakdown.
            </p>
          ) : (
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => {
                setVoice(true);
                // Started inside the tap, so the browser allows the microphone and audio.
                void useLiveVoice.getState().start("closure", guide.id);
              }}
            >
              <VoiceIcon />
              Speak it instead
            </Button>
          )}
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
                Save and close
              </Button>
            </div>
        </div>
      </Modal>
    </>
  );
}

/** QA's line clearance after the repair: every check ticked before the machine restarts. */
function ReleaseDialog({ guide, onDone }: { guide: Guide; onDone: (g: Guide) => void }) {
  const by = useActorName();
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<string[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && !checks.length) api.config().then((c) => setChecks(c.release_checks), () => undefined);
  }, [open, checks.length]);

  const release = async () => {
    setBusy(true);
    try {
      onDone(await api.releaseGuide(guide.id, by, [...ticked], comment.trim() || undefined));
      setOpen(false);
      toast.success("Released to production", { description: `${guide.asset_tag ?? "The machine"} can restart.` });
    } catch (err) {
      toast.error("Couldn’t release it", { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Factory />
        Release to production
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Release to production"
        description="Line clearance after the repair. Tick each check once you have seen it on the floor."
      >
        <ul className="flex flex-col gap-2">
          {checks.map((check) => {
            const on = ticked.has(check);
            return (
              <li key={check}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)] transition-[background-color] duration-150 ease-out hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setTicked((t) => {
                        const next = new Set(t);
                        if (on) next.delete(check);
                        else next.add(check);
                        return next;
                      })
                    }
                    className="size-4 accent-(--color-accent)"
                  />
                  <span className="text-sm">{check}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <Textarea
          aria-label="Note (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Note (optional), e.g. batch B-2241 resumed at 14:20."
          className="mt-3 min-h-16"
          maxLength={2000}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={release}
            loading={busy}
            disabled={!checks.length || checks.some((c) => !ticked.has(c))}
          >
            Release
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Keeps toasts above the action bar: publishes how far its top is from the bottom of the
 * screen. It is sticky, so that distance changes as the page scrolls to its end. */
function useActionBarSpace(shown: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const space = Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top));
        root.style.setProperty("--action-bar", `${space}px`);
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--action-bar");
    };
  }, [shown]);
  return ref;
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
  const bar = useActionBarSpace(!editing);
  if (editing) return null;

  const translating = (then: string) =>
    toast.loading("Translating into the shop-floor languages…", {
      description: `${then} About 10 to 20 seconds.`,
      icon: <TranslatingLoader className="text-fg-muted" />,
    });

  const submit = async () => {
    setBusy("submit");
    const id = translating("Then it goes to QA.");
    try {
      const sent = await api.submitGuide(guide.id, by);
      onChange(sent);
      const flags = sent.translations.reduce((n, t) => n + t.flags.length, 0);
      toast.success("Sent to QA", {
        id,
        icon: undefined,
        description: flags
          ? `${flags} translated line${flags > 1 ? "s" : ""} flagged for QA to check.`
          : "Switch to QA in the top bar to review it.",
      });
      router.push(`/guides/view/?id=${encodeURIComponent(sent.id)}`);
    } catch (err) {
      toast.error("Couldn’t send to QA", { id, icon: undefined, description: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  // The manager approves what they checked. Code may still send it to QA (e.g. a translated
  // line lost a number); then the reasons are shown.
  const approveAsManager = async () => {
    setBusy("approve");
    const id = translating("Then it’s ready to print.");
    try {
      const result = await api.approveGuide(guide.id, by);
      onChange(result);
      if (result.status === "approved") {
        toast.success("Approved. Opening the print view.", { id, icon: undefined });
        router.push(`/guides/print/?id=${encodeURIComponent(result.id)}`);
      } else {
        toast.warning("QA needs to check this one first", {
          id,
          icon: undefined,
          description: result.qa_reasons[0],
        });
        router.push(`/guides/view/?id=${encodeURIComponent(result.id)}`);
      }
    } catch (err) {
      toast.error("Couldn’t approve", { id, icon: undefined, description: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const approveAsQa = async () => {
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

  const lastBy = (action: string) => [...guide.events].reverse().find((e) => e.action === action)?.by;
  const same = (a?: string) => Boolean(a) && a!.trim().toLowerCase() === by.trim().toLowerCase();
  const ownGuide = same(lastBy("submitted"));
  const reasons = guide.qa_reasons;

  let hint: React.ReactNode = null;
  let actions: React.ReactNode = null;
  const s = guide.status;
  if (s === "draft" || s === "rejected") {
    if (role === "qa") {
      hint = "The manager approves this, or sends it to QA if it needs a check.";
    } else if (reasons.length) {
      hint = (
        <>
          QA must check it first: {reasons[0]}
          {reasons.length > 1 && ` (+${reasons.length - 1} more)`} Edit to fix it, or send it to QA.
        </>
      );
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
    } else {
      hint = "Every line cites the manual or a past fix. Check the steps, then approve and print.";
      actions = (
        <>
          <Button onClick={onEdit}>
            <Pencil />
            Edit
          </Button>
          <Button variant="ghost" onClick={submit} loading={busy === "submit"} disabled={busy === "approve"}>
            Ask QA to check
          </Button>
          <Button variant="primary" onClick={approveAsManager} loading={busy === "approve"} disabled={busy === "submit"}>
            <CheckCheck />
            Approve and print
          </Button>
        </>
      );
    }
  } else if (s === "in_review") {
    const why = reasons.length ? ` Why: ${reasons[0]}${reasons.length > 1 ? ` (+${reasons.length - 1} more)` : ""}` : "";
    if (role === "qa" && !ownGuide) {
      hint = `Check the steps and each translation, then decide.${why}`;
      actions = (
        <>
          <RejectDialog guide={guide} onDone={onChange} />
          <Button variant="primary" onClick={approveAsQa} loading={busy === "approve"}>
            <CheckCheck />
            Approve for printing
          </Button>
        </>
      );
    } else {
      hint = ownGuide
        ? `You sent this guide, so someone else must review it. Switch to QA (top bar) with another name.${why}`
        : `Waiting for QA. Switch to QA in the top bar to review it.${why}`;
    }
  } else if (s === "approved") {
    hint =
      guide.copies_printed > 0
        ? `${guide.copies_printed} cop${guide.copies_printed > 1 ? "ies" : "y"} printed. Close it once the repair is done.`
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
    if (role === "qa" && !same(lastBy("closed"))) {
      hint = "Repair recorded. Do the line clearance, then release the machine.";
      actions = <ReleaseDialog guide={guide} onDone={onChange} />;
    } else {
      hint = "Saved to plant memory. QA does the line clearance and releases the machine.";
    }
  } else if (s === "released") {
    hint = `Released to production by ${lastBy("released") ?? "QA"}.`;
  }

  return (
    <div ref={bar} className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-10 md:bottom-4 print:hidden">
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
  released: "Released to production",
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
              event.action === "approved" || event.action === "closed" || event.action === "released"
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
