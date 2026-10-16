"use client";

import { Ban, Check, CheckCheck, ClipboardCheck, Factory, Lock, Pencil, Printer, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AutoHeight } from "@/components/ui/auto-height";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { TranslatingLoader } from "@/components/ui/loaders";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { VoiceIcon } from "@/components/voice/icons";
import { LiveVoice } from "@/components/voice/live-voice";
import { api, type Guide, type GuidePart, type IntakeFields, type Outcome } from "@/lib/api";
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
      <Modal open={open} onOpenChange={setOpen} title="Send back to the manager" description="Say what needs to change. The manager edits the guide and approves it again; it comes back to QA.">
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

const WITHDRAW_REASONS = [
  "The machine restarted on its own",
  "Reported by mistake",
  "Same breakdown as another guide",
];

/** Whether this guide may still be withdrawn: not once a copy is on the floor. */
export const canWithdraw = (guide: Guide) =>
  ["draft", "rejected", "in_review", "approved"].includes(guide.status) && guide.copies_printed === 0;

/** Take back a guide that isn't needed, with a reason. It stays in the list, and the
 * machine no longer counts as stopped because of it. */
export function WithdrawDialog({ guide, onDone }: { guide: Guide; onDone: (g: Guide) => void }) {
  const by = useActorName();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      onDone(await api.withdrawGuide(guide.id, by, reason.trim()));
      setOpen(false);
      toast("Guide withdrawn", {
        description: guide.asset_tag ? `${guide.asset_tag} no longer counts as stopped for it.` : "It stays in the list with your reason.",
      });
    } catch (err) {
      toast.error("Couldn’t withdraw it", { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="-my-1 h-7 px-2 text-fg-subtle hover:text-fg"
        data-tour="withdraw"
      >
        <Ban />
        Withdraw
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Withdraw this guide?"
        description="For a guide that isn’t needed. It stays in the list with your reason, and the machine no longer counts as stopped because of it."
      >
        <div className="flex flex-wrap gap-1.5">
          {WITHDRAW_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className="h-8 rounded-full bg-surface-2 px-3 text-[0.8125rem] text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-3 hover:text-fg active:scale-[0.97] aria-pressed:bg-accent-soft aria-pressed:text-accent-text aria-pressed:shadow-none"
            >
              {r}
            </button>
          ))}
        </div>
        <Textarea
          aria-label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Or say why, e.g. the same stop as GDE-… drafted earlier."
          className="mt-3 min-h-20"
          maxLength={2000}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} loading={busy} disabled={reason.trim().length < 3}>
            Withdraw guide
          </Button>
        </div>
      </Modal>
    </>
  );
}

const partKey = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, "");

const names = (part: GuidePart, text: string) =>
  partKey(text).includes(partKey(part.part_no)) ||
  (part.name.length > 2 && text.toLowerCase().includes(part.name.toLowerCase()));

/** Which of the guide's parts a spoken or typed answer names. Anything else it names is
 * kept as other parts; "None" ticks nothing. */
function readParts(text: string, parts: GuidePart[]): { picked: string[]; other: string } {
  if (/^\s*(none|no parts?|nothing)\b/i.test(text)) return { picked: [], other: "" };
  return {
    picked: parts.filter((p) => names(p, text)).map((p) => p.part_no),
    other: text
      .split(/[;,]/)
      .map((piece) => piece.trim())
      .filter((piece) => piece && !parts.some((p) => names(p, piece)))
      .join("; "),
  };
}

/** What is saved: the ticked parts as "RTP-PN-U-10 Upper punch x1", then any others. With
 * nothing ticked from a guide that listed parts, "None", so memory says none were needed. */
function partsText(parts: GuidePart[], picked: string[], other: string): string | null {
  const used = parts
    .filter((p) => picked.includes(p.part_no))
    .map((p) => `${p.part_no} ${p.name} x${p.qty}`.replace(/\s+/g, " "));
  if (other.trim()) used.push(other.trim());
  return used.length ? used.join("; ") : parts.length ? "None" : null;
}

/** The guide's parts as a tick list, so what was replaced is clear at a glance. */
function PartsUsed({
  parts,
  picked,
  onPick,
  other,
  onOther,
}: {
  parts: GuidePart[];
  picked: string[];
  onPick: (picked: string[]) => void;
  other: string;
  onOther: (other: string) => void;
}) {
  const none = !picked.length && !other.trim();
  return (
    <div role="group" aria-labelledby="close-parts-label" className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p id="close-parts-label" className="text-[0.8125rem] font-medium">
          Parts used
        </p>
        {parts.length > 0 && (
          <p className="text-xs text-fg-subtle tabular" aria-live="polite">
            {none ? "None replaced" : `${picked.length} of ${parts.length} from the guide`}
          </p>
        )}
      </div>
      {parts.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-(--radius-control) shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
          {parts.map((part) => {
            const on = picked.includes(part.part_no);
            return (
              <li key={part.part_no} className="border-line not-first:border-t">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 transition-[background-color] duration-150 ease-out hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      onPick(on ? picked.filter((p) => p !== part.part_no) : [...picked, part.part_no])
                    }
                    className="size-4 shrink-0 accent-(--color-accent)"
                  />
                  <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                    <span className="truncate text-sm">{part.name || part.part_no}</span>
                    {part.name && <span className="truncate font-mono text-xs text-fg-subtle">{part.part_no}</span>}
                  </span>
                  <span className="shrink-0 text-[0.8125rem] text-fg-muted tabular">
                    ×{part.qty}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <Input
        aria-label={parts.length ? "Other parts used" : "Parts used"}
        value={other}
        onChange={(e) => onOther(e.target.value)}
        placeholder={parts.length ? "Other parts, if any" : "Part numbers or names, or leave empty"}
        maxLength={600}
      />
    </div>
  );
}

function CloseDialog({ guide, onDone }: { guide: Guide; onDone: (g: Guide) => void }) {
  const by = useActorName();
  const [open, setOpen] = useState(false);
  const [voice, setVoice] = useState(false);
  const [action, setAction] = useState("");
  const [cause, setCause] = useState("");
  const [picked, setPicked] = useState(() => guide.parts.map((p) => p.part_no));
  const [other, setOther] = useState("");
  const [minutes, setMinutes] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("resolved");
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState(false);

  // Fields fill in while the manager talks; the panel's chips show them until it hands back.
  const fill = (f: IntakeFields) => {
    if (f.action_taken) setAction(f.action_taken);
    if (f.root_cause) setCause(f.root_cause);
    if (f.parts_used) {
      const read = readParts(f.parts_used, guide.parts);
      setPicked(read.picked);
      setOther(read.other);
    }
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
        parts_used: partsText(guide.parts, picked, other),
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
      <Button onClick={() => setOpen(true)} data-tour="close-breakdown">
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
        {/* While talking, the voice panel takes the form's place (its chips show what is
            filled), so the sheet doesn't grow past the screen; the height change animates. */}
        <AutoHeight className="-m-1 p-1">
          {voice ? (
            <div key="voice" className="rounded-xl p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
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
          ) : (
            <div
              key="form"
              className="flex flex-col gap-4 transition-opacity duration-200 ease-out starting:opacity-0"
            >
              {heard ? (
                <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-[0.8125rem] text-success-text">
                  <Check className="size-4 shrink-0" strokeWidth={2.5} />
                  Filled in from what you said. Check the fields, then save.
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
              <PartsUsed parts={guide.parts} picked={picked} onPick={setPicked} other={other} onOther={setOther} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <Field label="Downtime (min)" htmlFor="close-minutes">
                  <Input
                    id="close-minutes"
                    inputMode="numeric"
                    className="tabular"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  />
                </Field>
                <Field label="Is it fixed?">
                  <Segmented label="Outcome" options={OUTCOMES} value={outcome} onChange={setOutcome} className="w-full [&>*]:h-9" />
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={save} loading={busy} disabled={action.trim().length < 3}>
                  Save and close
                </Button>
              </div>
            </div>
          )}
        </AutoHeight>
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
      <Button data-primary variant="primary" onClick={() => setOpen(true)}>
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

/** Ghost buttons read as loose text on a phone, where they share a row with the primary's
 * width: there they look like the other secondary buttons. */
const PHONE_SECONDARY = "max-sm:bg-surface max-sm:text-fg max-sm:shadow-card";

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
/** A proposed change on screen: the bar offers keep or discard instead of the next step. */
type Review = { count: number; keeping: boolean; onKeep: () => void; onDiscard: () => void };

export function GuideActions({
  guide,
  onChange,
  onEdit,
  editing,
  composer,
  review,
}: {
  guide: Guide;
  onChange: (g: Guide) => void;
  onEdit: () => void;
  editing: boolean;
  /** Asking for a change by voice or typed, shown above the next step. */
  composer?: React.ReactNode;
  review?: Review;
}) {
  const router = useRouter();
  const role = useSession((s) => s.role);
  const by = useActorName();
  const [busy, setBusy] = useState<"approve" | null>(null);
  const bar = useActionBarSpace(!editing);
  if (editing) return null;

  const translating = (then: string) =>
    toast.loading("Translating into the shop-floor languages…", {
      description: `${then} About 5 seconds.`,
      icon: <TranslatingLoader className="text-fg-muted" />,
    });

  // The manager approves what they checked. Whether QA must approve it first is decided in
  // code, never by the manager: a reason known now, or one found while translating (a
  // translated line lost a number).
  const approveAsManager = async () => {
    setBusy("approve");
    const id = translating(needsQa ? "Then it goes to QA." : "Then it’s ready to print.");
    try {
      const result = await api.approveGuide(guide.id, by);
      onChange(result);
      if (result.status === "approved") {
        toast.success("Approved. Opening the print view.", { id, icon: undefined });
        router.push(`/guides/print/?id=${encodeURIComponent(result.id)}`);
      } else {
        toast.success("Approved. QA checks it next", {
          id,
          icon: undefined,
          description: `${result.qa_reasons[0] ?? ""} Switch to QA in the top bar to review it.`.trim(),
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
  const reasons = guide.status === "rejected" ? ["QA sent an earlier version back.", ...guide.qa_reasons] : guide.qa_reasons;
  const needsQa = reasons.length > 0;

  let hint: React.ReactNode = null;
  let actions: React.ReactNode = null;
  const s = guide.status;
  if (s === "draft" || s === "rejected") {
    if (role === "qa") {
      hint = "The manager approves this. It comes to QA only if code finds a reason.";
    } else {
      hint = needsQa ? (
        <>
          QA must check it first: {reasons[0]}
          {reasons.length > 1 && ` (+${reasons.length - 1} more)`}{" "}
          <span className="max-sm:hidden">Fix it with Edit, or approve and it goes to QA.</span>
        </>
      ) : (
        <>
          <span className="max-sm:hidden">Every line cites the manual or a past fix. </span>Check the steps, then approve
          and print.
        </>
      );
      actions = (
        <>
          <Button onClick={onEdit} aria-label="Edit by hand">
            <Pencil />
            Edit
          </Button>
          <Button
            data-primary
            data-tour="approve-button"
            variant="primary"
            onClick={approveAsManager}
            loading={busy === "approve"}
          >
            <CheckCheck />
            {needsQa ? "Approve for QA" : "Approve and print"}
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
          <Button data-primary variant="primary" onClick={approveAsQa} loading={busy === "approve"}>
            <CheckCheck />
            Approve for printing
          </Button>
        </>
      );
    } else {
      hint = ownGuide
        ? `You approved this guide, so QA must be someone else. Switch to QA (top bar) with another name.${why}`
        : `Switch to QA in the top bar to review it.${why}`;
    }
  } else if (s === "approved") {
    hint =
      guide.copies_printed > 0
        ? `${guide.copies_printed} cop${guide.copies_printed > 1 ? "ies" : "y"} printed. Close it once the repair is done.`
        : "Print it for the workers.";
    actions = (
      <>
        <CloseDialog guide={guide} onDone={onChange} />
        <Link
          data-primary
          href={`/guides/print/?id=${encodeURIComponent(guide.id)}`}
          className={buttonVariants({ variant: "primary" })}
        >
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
  } else if (s === "withdrawn") {
    hint = "Kept in the list with the reason. Nothing more to do.";
  }
  if (review) {
    const changes = review.count === 1 ? "1 change" : `${review.count} changes`;
    hint = (
      <>
        <span className="sm:hidden">{changes} · not saved yet</span>
        <span className="max-sm:hidden">
          {changes} proposed. Nothing is saved until you keep {review.count === 1 ? "it" : "them"}.
        </span>
      </>
    );
    actions = (
      <>
        <Button variant="ghost" onClick={review.onDiscard} disabled={review.keeping} className={PHONE_SECONDARY}>
          Discard
        </Button>
        <Button data-primary variant="primary" onClick={review.onKeep} loading={review.keeping}>
          <Check />
          Keep changes
        </Button>
      </>
    );
  }

  return (
    <div ref={bar} className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-10 md:bottom-4 print:hidden">
      <div data-tour="guide-actions" className="flex flex-col gap-3 rounded-(--radius-card) bg-surface/90 p-3 shadow-raised backdrop-blur-xl">
        {composer}
        <div className="flex flex-wrap items-center justify-between gap-3 pl-1">
          <p className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-fg-muted">
            <ClipboardCheck className="size-4 shrink-0" />
            <span>
              {!review && <span className="font-medium text-fg">{STATUS_LABEL[s]}. </span>}
              {hint}
            </span>
          </p>
          {actions && (
            // On a phone the next step gets a full-width row at the bottom, under the thumb,
            // and the other actions share the row above in equal widths.
            <div className="ml-auto flex flex-wrap gap-2 max-sm:w-full max-sm:[&>*]:flex-1 max-sm:[&>[data-primary]]:basis-full">
              {actions}
            </div>
          )}
        </div>
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
  translated: "Language added",
  printed: "Printed",
  closed: "Closed",
  released: "Released to production",
  withdrawn: "Withdrawn",
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
