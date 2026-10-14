"use client";

import { ArrowUp, Check, MessageCircleQuestion, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MicIcon } from "@/components/voice/icons";
import { ApiError, api, type Guide, type GuideRevision } from "@/lib/api";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { MAX_SECONDS, useRecorder, type VoiceNote } from "@/lib/hooks/use-recorder";
import { useActorName } from "@/lib/stores/session";
import { cn } from "@/lib/utils";
import { toEdit, type Ask, type Revision } from "./revision";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Five bars that follow the microphone's loudness. Written to the DOM every frame, not
 * through React state. */
function Meter({ level }: { level: () => number }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const weights = [0.55, 0.85, 1, 0.85, 0.55];
    let frame = 0;
    const tick = () => {
      const l = level();
      bars.current.forEach((bar, i) => {
        if (bar) bar.style.scale = `1 ${0.2 + Math.min(1, l * weights[i] * 1.6) * 0.8}`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level]);
  return (
    <span aria-hidden className="flex h-4 items-center gap-[3px]">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          style={{ scale: "1 0.2" }}
          className="h-4 w-[3px] origin-center rounded-full bg-danger transition-[scale] duration-75 ease-out"
        />
      ))}
    </span>
  );
}

type Pending = { label: string; voice: boolean };
type Reply = { text: string; transcript: string };

/**
 * Ask for a change to a draft guide, by voice or typed, in any language. The answer is a
 * proposal: the guide view shows it with every change marked, and the manager keeps or
 * discards it from the action bar.
 */
export function ReviseComposer({
  guide,
  revision,
  onProposal,
}: {
  guide: Guide;
  revision: Revision | null;
  onProposal: (result: GuideRevision, ask: Ask) => void;
}) {
  const by = useActorName();
  const wide = useMediaQuery("(min-width: 40rem)");
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const send = async (body: { text?: string; note?: VoiceNote }) => {
    const typed = body.text?.trim();
    if (!typed && !body.note) return;
    // A message sent while a question is on screen answers it.
    const followUp = reply?.transcript ? { asked: reply.transcript, question: reply.text } : undefined;
    setReply(null);
    setPending({ label: typed ? `“${typed}”` : `Voice note · ${clock(body.note!.seconds)}`, voice: !typed });
    if (typed) setText("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await api.reviseGuide(
        guide.id,
        {
          by,
          text: typed,
          audio: body.note?.blob,
          filename: body.note?.filename,
          base: revision ? toEdit(revision.proposal, by) : undefined,
          history: revision?.asks.map((a) => a.transcript),
          followUp,
        },
        controller.signal,
      );
      if (result.proposal) {
        onProposal(result, {
          // An answer ("in step 9") only makes sense with the request it answers.
          transcript: followUp ? `${followUp.asked} · ${result.transcript}` : result.transcript,
          language: result.language ?? null,
          voice: !typed,
          changes: result.changes,
        });
      } else {
        // Asked back again: keep the whole request so far for the next answer.
        const said = followUp ? `${followUp.asked} · ${result.transcript}` : result.transcript;
        setReply({ text: result.reply ?? "Nothing changed.", transcript: said });
        if (typed) setText(typed);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        if (typed) setText(typed);
        return;
      }
      if (typed) setText(typed);
      const status = err instanceof ApiError ? err.status : 0;
      toast.error(status === 409 ? "This guide can’t be changed now" : "Couldn’t make the change", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      if (abort.current === controller) abort.current = null;
      setPending(null);
    }
  };

  const recorder = useRecorder((note) => void send({ note }));
  const recording = recorder.phase !== "idle";

  // Esc stops a recording without sending it.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && recorder.cancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, recorder]);

  // After a question back, put the cursor where the answer goes (not on phones, where it
  // would open the keyboard over the question).
  useEffect(() => {
    if (!pending && reply && wide) input.current?.focus();
  }, [pending, reply, wide]);

  // Leaving the page cancels a request still running.
  useEffect(() => () => abort.current?.abort(), []);

  const hasText = text.trim().length > 0;
  const placeholder = revision
    ? wide
      ? "Ask for another change, or keep these…"
      : "Ask for another change…"
    : wide
      ? "Say or type a change, e.g. “Step 3: the engineer does this, not the operator”"
      : "Say or type a change…";
  const remaining = MAX_SECONDS - recorder.seconds;

  return (
    <div className="flex flex-col gap-2" data-tour="revise">
      {(reply || recorder.error) && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5 text-[0.8125rem] leading-5 transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0"
        >
          <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          <div className="min-w-0 flex-1">
            <p className="indic text-fg [overflow-wrap:anywhere]">{reply?.text ?? recorder.error}</p>
            {reply?.transcript && (
              <p className="indic mt-0.5 text-fg-subtle [overflow-wrap:anywhere]">You said: “{reply.transcript}”</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setReply(null);
              recorder.clearError();
            }}
            className="-m-1 grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle transition-[background-color,color] duration-150 ease-out hover:bg-surface-3 hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div
        className={cn(
          "flex min-h-11 items-end gap-1 rounded-[calc(var(--radius-control)+0.25rem)] bg-surface p-1 transition-[box-shadow] duration-150 ease-out",
          recording
            ? "shadow-[inset_0_0_0_1px_var(--color-danger),0_0_0_3px_var(--color-danger-soft)]"
            : "shadow-[inset_0_0_0_1px_var(--color-line-strong)] focus-within:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-soft)]",
        )}
      >
        {pending ? (
          <>
            <div role="status" className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pr-1 pl-2.5">
              <Spinner className="shrink-0 text-accent" />
              <div className="min-w-0 text-[0.8125rem] leading-5">
                <p className="indic truncate text-fg">{pending.label}</p>
                <p className="text-fg-subtle">
                  {pending.voice ? "Listening and making the change…" : "Making the change…"}
                  {wide && " Usually about 5 seconds."}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" aria-label="Stop" onClick={() => abort.current?.abort()}>
              <X />
            </Button>
          </>
        ) : recording ? (
          <>
            <Button variant="ghost" size="icon" aria-label="Cancel recording" onClick={recorder.cancel}>
              <X />
            </Button>
            <div role="status" className="flex min-w-0 flex-1 items-center gap-2.5 self-center px-1">
              {recorder.phase === "starting" ? (
                <span className="text-[0.8125rem] text-fg-muted">Starting the microphone…</span>
              ) : (
                <>
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-danger motion-safe:animate-pulse" />
                  <span className="tabular text-[0.8125rem] font-medium">{clock(recorder.seconds)}</span>
                  <Meter level={recorder.level} />
                  <span className="truncate text-[0.8125rem] text-fg-muted">
                    {remaining <= 10
                      ? `Stops in ${remaining} s`
                      : wide
                        ? "Listening. Speak in any language."
                        : "Listening…"}
                  </span>
                </>
              )}
            </div>
            <Button
              variant="primary"
              size="icon"
              aria-label="Stop and send"
              disabled={recorder.phase !== "recording"}
              onClick={recorder.send}
            >
              <Check />
            </Button>
          </>
        ) : (
          <>
            <textarea
              ref={input}
              rows={1}
              value={text}
              maxLength={2000}
              aria-label="Change to make"
              placeholder={placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Not while an Indic or other input method is still composing a word.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send({ text });
                }
              }}
              className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-base leading-6 [field-sizing:content] sm:text-sm placeholder:text-fg-subtle focus-visible:outline-none"
            />
            <Button
              variant={hasText ? "primary" : "ghost"}
              size="icon"
              aria-label={hasText ? "Send" : "Record a voice change"}
              onClick={() => (hasText ? void send({ text }) : void recorder.start())}
            >
              <span className="relative grid size-4 place-items-center">
                <MicIcon
                  className={cn(
                    "absolute size-[1.125rem] transition-[opacity,scale,filter] duration-150 ease-out",
                    hasText && "scale-50 opacity-0 blur-[2px]",
                  )}
                />
                <ArrowUp
                  className={cn(
                    "absolute transition-[opacity,scale,filter] duration-150 ease-out",
                    !hasText && "scale-50 opacity-0 blur-[2px]",
                  )}
                />
              </span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
