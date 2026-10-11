"use client";

import { Check, Keyboard, Mic, MicOff, PhoneOff, RotateCcw, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { IntakeFields, IntakeMode, IntakeTurnResult } from "@/lib/api";
import { liveLevels, useLiveVoice } from "@/lib/stores/live-voice";
import { cn, formatMinutes } from "@/lib/utils";

type Chip = { key: keyof IntakeFields; label: string; show: (f: IntakeFields) => string | null };

const CHIPS: Record<IntakeMode, Chip[]> = {
  breakdown: [
    { key: "equipment", label: "Machine", show: (f) => f.equipment ?? null },
    { key: "symptom", label: "Problem", show: (f) => f.symptom ?? null },
    {
      key: "machine_stopped",
      label: "Stopped?",
      show: (f) => (f.machine_stopped == null ? null : f.machine_stopped ? "Stopped" : "Running"),
    },
    { key: "error_code", label: "Alarm", show: (f) => f.error_code ?? null },
  ],
  closure: [
    { key: "action_taken", label: "What was done", show: (f) => f.action_taken ?? null },
    { key: "parts_used", label: "Parts", show: (f) => f.parts_used ?? null },
    {
      key: "downtime_minutes",
      label: "Downtime",
      show: (f) => (f.downtime_minutes == null ? null : formatMinutes(f.downtime_minutes)),
    },
    {
      key: "outcome",
      label: "Fixed?",
      show: (f) => (f.outcome ? { resolved: "Fixed", recurred: "Came back", unknown: "Not sure" }[f.outcome] : null),
    },
  ],
};

const HINT: Record<IntakeMode, string> = {
  breakdown: "Say which machine, what is wrong, and any alarm on the screen.",
  closure: "Say what was done. “Did what the guide said” is fine; it will ask the rest.",
};

/**
 * The orb: a core that breathes while waiting, two halos that swell with the manager's
 * voice (blue) or the assistant's (green), and bars that move while the assistant speaks.
 * Levels are read every frame and written straight to the elements, not through React.
 */
function Orb({
  connecting,
  muted,
  speaking,
  onSpeaking,
}: {
  connecting: boolean;
  muted: boolean;
  speaking: boolean;
  onSpeaking: (s: boolean) => void;
}) {
  const halos = useRef<(HTMLSpanElement | null)[]>([]);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const speakingRef = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let mic = 0;
    let out = 0;
    const tick = (now: number) => {
      const levels = liveLevels();
      mic += (levels.mic - mic) * 0.25;
      out += (levels.out - out) * 0.3;
      if (levels.speaking !== speakingRef.current) {
        speakingRef.current = levels.speaking;
        onSpeaking(levels.speaking);
      }
      const v = levels.speaking ? out : mic;
      halos.current.forEach((el, i) => {
        if (!el) return;
        const amount = v * (i === 0 ? 0.32 : 0.55);
        if (reduce) el.style.opacity = String(0.12 + amount);
        else el.style.transform = `scale(${1 + amount})`;
      });
      bars.current.forEach((el, i) => {
        if (!el) return;
        const wave = 0.55 + 0.45 * Math.sin(now / 140 + i * 1.3);
        el.style.transform = `scaleY(${0.25 + Math.min(1, out * 1.6) * wave * 0.75})`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onSpeaking]);

  return (
    <div className="relative grid size-36 place-items-center" aria-hidden>
      {[0, 1].map((i) => (
        <span
          key={i}
          ref={(el) => {
            halos.current[i] = el;
          }}
          className={cn(
            "absolute rounded-full transition-[background-color] duration-300 ease-out will-change-transform",
            i === 0 ? "inset-5" : "inset-2",
            muted ? "bg-fg-subtle/10" : speaking ? "bg-success/20" : "bg-accent/15",
            i === 1 && "opacity-60",
          )}
        />
      ))}
      {connecting && (
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" style={{ animation: "orbit 1.1s linear infinite" }}>
          <circle cx="50" cy="50" r="47" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-accent" strokeDasharray="70 226" />
        </svg>
      )}
      <span
        className={cn(
          "relative grid size-24 place-items-center rounded-full text-white shadow-[0_10px_30px_-10px_oklch(0.2_0.05_259/0.55),inset_0_1px_0_oklch(1_0_0/0.25)] transition-[background-color] duration-300 ease-out",
          muted ? "bg-fg-subtle" : speaking ? "bg-success" : "bg-accent",
        )}
        style={{ animation: connecting || speaking ? undefined : "breathe 2.8s var(--ease-in-out) infinite" }}
      >
        {speaking ? (
          <span className="flex h-9 items-center gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                ref={(el) => {
                  bars.current[i] = el;
                }}
                className="h-full w-1.5 origin-center rounded-full bg-white will-change-transform"
              />
            ))}
          </span>
        ) : muted ? (
          <MicOff className="size-8" strokeWidth={1.75} />
        ) : (
          <Mic className="size-8" strokeWidth={1.75} />
        )}
      </span>
    </div>
  );
}

let pendingStop: ReturnType<typeof setTimeout> | null = null;

/** A live spoken conversation that fills a report. Speak in any language; type if needed. */
export function LiveVoice({
  mode,
  guideId,
  doneLabel,
  onDone,
  onFields,
  onClose,
}: {
  mode: IntakeMode;
  guideId?: string;
  doneLabel: string;
  onDone: (result: IntakeTurnResult) => void;
  onFields?: (fields: IntakeFields) => void;
  onClose: () => void;
}) {
  const { phase, messages, result, error, muted, finished, start, stop, sendText, toggleMute } = useLiveVoice();
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const doneRef = useRef(onDone);
  const fieldsRef = useRef(onFields);
  useEffect(() => {
    doneRef.current = onDone;
    fieldsRef.current = onFields;
  });

  // Leaving the panel ends the conversation. Deferred, so React's dev-mode remount (which
  // unmounts and mounts again at once) doesn't end the session the tap just started.
  useEffect(() => {
    if (pendingStop) clearTimeout(pendingStop);
    return () => {
      pendingStop = setTimeout(() => useLiveVoice.getState().stop(), 0);
    };
  }, []);

  useEffect(() => {
    if (result) fieldsRef.current?.(result.state.fields);
  }, [result]);

  // Confirmed by voice: hand over once the closing words have played.
  useEffect(() => {
    if (finished && result) doneRef.current(result);
  }, [finished, result]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages]);


  const fields = result?.state.fields;
  const live = phase === "live";
  const connecting = phase === "connecting";
  const ready = Boolean(result?.done);

  const status = connecting
    ? "Connecting…"
    : phase === "confirmed"
      ? "Confirmed"
      : phase === "error"
        ? "Stopped"
        : phase === "ended"
          ? "Ended"
          : muted
            ? "Muted. Tap the microphone to talk."
            : speaking
              ? "Speaking. Talk any time to interrupt."
              : "Listening. Telugu, Hindi, English or mixed.";

  return (
    <div className="flex flex-col gap-4 transition-[opacity,translate] duration-250 ease-out starting:translate-y-1 starting:opacity-0">
      <div className="flex flex-col items-center gap-2 pt-1">
        <Orb connecting={connecting} muted={muted || !live} speaking={speaking} onSpeaking={setSpeaking} />
        <p className="text-center text-[0.8125rem] font-medium" aria-live="polite">
          {status}
        </p>
        {messages.length === 0 && live && (
          <p className="max-w-xs text-center text-[0.8125rem] text-fg-muted text-pretty">{HINT[mode]}</p>
        )}
      </div>

      {messages.length > 0 && (
        <ol ref={list} className="flex max-h-60 flex-col gap-2 overflow-y-auto overscroll-contain" aria-live="polite">
          {messages.map((message, i) => (
            <li
              key={i}
              className={cn(
                "indic max-w-[88%] rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-6 transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0",
                message.role === "manager"
                  ? "self-end rounded-br-md bg-accent text-accent-fg"
                  : "self-start rounded-bl-md bg-surface-2 text-fg",
              )}
            >
              {message.text}
              {message.open && (
                <span aria-hidden className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-current opacity-60" />
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap justify-center gap-1.5" aria-label="What the report has so far">
        {CHIPS[mode].map((chip) => {
          const value = fields ? chip.show(fields) : null;
          return (
            <span
              key={chip.key}
              className={cn(
                "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs transition-[background-color,color] duration-200 ease-out",
                value
                  ? "bg-success-soft text-success-text"
                  : "bg-surface-2 text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]",
              )}
            >
              {value ? (
                <Check className="size-3 shrink-0 transition-[scale,opacity] duration-200 ease-out starting:scale-50 starting:opacity-0" strokeWidth={3} />
              ) : null}
              <span className="font-medium">{chip.label}</span>
              {value && <span className="max-w-48 truncate text-success-text/80">{value}</span>}
            </span>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}

      {ready && result && (
        <div className="flex flex-col gap-2.5 rounded-xl bg-success-soft/60 p-3 shadow-[inset_0_0_0_1px_oklch(0.6_0.14_155/0.2)] transition-[opacity,translate] duration-250 ease-out starting:translate-y-1 starting:opacity-0">
          <p className="flex items-center gap-2 text-sm font-medium text-success-text">
            <Check className="size-4" strokeWidth={2.5} />
            {mode === "closure" ? "All filled in. Check the fields below." : "Report complete"}
          </p>
          <p className="text-[0.8125rem] leading-5 text-fg-muted">{result.summary}</p>
          <Button
            variant="primary"
            className="self-start"
            onClick={() => {
              stop();
              onDone(result);
            }}
          >
            {doneLabel}
          </Button>
        </div>
      )}

      {typing && live && (
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendText(draft);
            setDraft("");
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type instead…"
            maxLength={4000}
            className="indic h-10 min-w-0 flex-1 rounded-(--radius-control) bg-surface px-3 shadow-[inset_0_0_0_1px_var(--color-line-strong)] focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-soft)] focus-visible:outline-none"
          />
          <Button type="submit" variant="secondary" size="icon" aria-label="Send" disabled={!draft.trim()}>
            <SendHorizontal />
          </Button>
        </form>
      )}

      <div className="flex items-center justify-center gap-2">
        {live || connecting ? (
          <>
            <Button variant="secondary" size="icon" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"} disabled={!live}>
              {muted ? <MicOff /> : <Mic />}
            </Button>
            <Button variant="secondary" size="icon" onClick={() => setTyping((t) => !t)} aria-pressed={typing} aria-label="Type instead" disabled={!live}>
              <Keyboard />
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                stop();
                onClose();
              }}
            >
              <PhoneOff />
              End
            </Button>
          </>
        ) : (
          <>
            {phase !== "confirmed" && (
              <Button variant="secondary" onClick={() => void start(mode, guideId)}>
                <RotateCcw />
                Start again
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
