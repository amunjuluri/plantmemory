"use client";

import { Check, Keyboard, Mic, SendHorizontal, Square, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { IntakeFields, IntakeMode, IntakeTurnResult } from "@/lib/api";
import { useVoice } from "@/lib/stores/voice";
import { cn, formatMinutes } from "@/lib/utils";

const SPEECH_LANG: Record<string, string> = {
  te: "te-IN",
  hi: "hi-IN",
  ta: "ta-IN",
  kn: "kn-IN",
  mr: "mr-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  ml: "ml-IN",
  en: "en-IN",
};

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
    { key: "root_cause", label: "Cause", show: (f) => f.root_cause ?? null },
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

const PROMPT: Record<IntakeMode, string> = {
  breakdown: "Say which machine, what is wrong, and whether it has stopped.",
  closure: "Say what was done, what caused it, how long it was down, and whether it is fixed.",
};

function speak(text: string, language: string | null | undefined) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const lang = SPEECH_LANG[language ?? "en"] ?? "en-IN";
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
  if (!voice) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  window.speechSynthesis.speak(utterance);
  return true;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((now - since) / 1000);
  return <span className="tabular">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}

/** A short spoken conversation that fills a report. Speak in any language; type if needed. */
export function VoicePanel({
  mode,
  doneLabel,
  onDone,
  onClose,
}: {
  mode: IntakeMode;
  doneLabel: string;
  onDone: (result: IntakeTurnResult) => void;
  onClose?: () => void;
}) {
  const { state, phase, error, last, level, startedAt, reset, start, stop, cancel, sendText } = useVoice();
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const spoken = useRef(0);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    reset(mode);
    return () => useVoice.getState().cancel();
  }, [mode, reset]);

  // Read each new question aloud, in the manager's language, if the device has a voice for it.
  useEffect(() => {
    const questions = state.history.filter((m) => m.role === "assistant");
    if (questions.length > spoken.current) {
      spoken.current = questions.length;
      speak(questions[questions.length - 1].text, state.language);
    }
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [state.history, state.language]);

  const recording = phase === "recording";
  const sending = phase === "sending";
  const done = Boolean(last?.done);

  const submitText = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendText(text);
  };

  return (
    <div className="flex flex-col gap-4 rounded-(--radius-card) bg-surface p-4 shadow-card transition-[opacity,translate] duration-250 ease-out starting:translate-y-1 starting:opacity-0 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{mode === "breakdown" ? "Speak the report" : "Speak what was done"}</h2>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            Telugu, Hindi, English or mixed. {PROMPT[mode]}
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" aria-label="Close voice report" onClick={onClose}>
            <X />
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label="What the report has so far">
        {CHIPS[mode].map((chip) => {
          const value = chip.show(state.fields);
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
              {value ? <Check className="size-3 shrink-0" strokeWidth={3} /> : null}
              <span className="font-medium">{chip.label}</span>
              {value && <span className="truncate text-success-text/80">{value}</span>}
            </span>
          );
        })}
      </div>

      {state.history.length > 0 && (
        <ol ref={list} className="flex max-h-72 flex-col gap-2 overflow-y-auto overscroll-contain" aria-live="polite">
          {state.history.map((message, i) => (
            <li
              key={i}
              className={cn(
                "flex max-w-[85%] gap-2 rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-6 transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0",
                message.role === "manager"
                  ? "indic self-end rounded-br-md bg-accent text-accent-fg"
                  : "indic self-start rounded-bl-md bg-surface-2 text-fg",
              )}
            >
              <span className="min-w-0">{message.text}</span>
              {message.role === "assistant" && (
                <button
                  type="button"
                  onClick={() => speak(message.text, state.language)}
                  aria-label="Read this question aloud"
                  className="mt-0.5 shrink-0 self-start rounded-md p-0.5 text-fg-subtle transition-[color,scale] duration-150 ease-out hover:text-fg active:scale-[0.94]"
                >
                  <Volume2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}

      {done && last ? (
        <div className="flex flex-col gap-3 rounded-xl bg-success-soft/60 p-3 shadow-[inset_0_0_0_1px_oklch(0.6_0.14_155/0.2)]">
          <p className="flex items-center gap-2 text-sm font-medium text-success-text">
            <Check className="size-4" strokeWidth={2.5} />
            Report complete
          </p>
          <p className="text-[0.8125rem] leading-5 text-fg-muted">{last.summary}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onDone(last)}>
              {doneLabel}
            </Button>
            <Button variant="ghost" onClick={() => reset(mode)}>
              Start over
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="relative grid size-24 place-items-center">
            {recording && (
              <span
                aria-hidden
                className="absolute inset-0 rounded-full bg-danger/15 transition-[scale] duration-75 ease-out"
                style={{ scale: `${1 + level * 0.45}` }}
              />
            )}
            <button
              type="button"
              onClick={() => (recording ? stop() : start())}
              disabled={sending}
              aria-label={recording ? "Stop and send" : "Start speaking"}
              className={cn(
                "relative grid size-18 place-items-center rounded-full text-white shadow-[0_8px_24px_-8px_oklch(0.2_0.05_259/0.45)] transition-[background-color,scale] duration-160 ease-out active:scale-[0.95] disabled:opacity-60",
                recording ? "bg-danger" : "bg-accent hover:bg-accent-hover",
              )}
            >
              {sending ? (
                <Spinner className="size-6" />
              ) : recording ? (
                <Square className="size-6 fill-current" />
              ) : (
                <Mic className="size-7" strokeWidth={1.75} />
              )}
            </button>
          </div>
          <p className="text-[0.8125rem] text-fg-muted" aria-live="polite">
            {sending ? (
              "Understanding…"
            ) : recording && startedAt ? (
              <>
                Listening <Elapsed since={startedAt} /> · tap to send{" "}
                <button type="button" onClick={cancel} className="ml-1 underline underline-offset-2 hover:text-fg">
                  cancel
                </button>
              </>
            ) : state.history.length ? (
              "Tap to answer"
            ) : (
              "Tap to speak"
            )}
          </p>
          {typing ? (
            <form
              className="flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void submitText();
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type instead…"
                maxLength={4000}
                className="h-10 min-w-0 flex-1 rounded-(--radius-control) bg-surface px-3 shadow-[inset_0_0_0_1px_var(--color-line-strong)] focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-soft)] focus-visible:outline-none"
              />
              <Button type="submit" variant="secondary" size="icon" aria-label="Send" disabled={!draft.trim() || sending}>
                <SendHorizontal />
              </Button>
            </form>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setTyping(true)} disabled={recording}>
              <Keyboard />
              Type instead
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
