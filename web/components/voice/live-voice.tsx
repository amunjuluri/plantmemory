"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";

import type { IntakeFields, IntakeMode, IntakeTurnResult } from "@/lib/api";
import { liveLevels, useLiveVoice } from "@/lib/stores/live-voice";
import { cn } from "@/lib/utils";
import { CloseIcon, KeyboardIcon, MicIcon, MicOffIcon, SendIcon, TranscriptIcon, VoiceIcon } from "./icons";
import { ReportSoFar } from "./report-so-far";

const HINT: Record<IntakeMode, string> = {
  breakdown: "Say which machine, what is wrong, and any alarm on the screen. Telugu, Hindi, English or mixed.",
  closure: "Say what was done. “Did what the guide said” is fine; it will ask the rest.",
};

type OrbState = "connecting" | "listening" | "speaking" | "muted" | "idle";

/**
 * The orb: a soft sphere of slowly turning colour, blue while listening and teal while the
 * assistant speaks, that swells with whoever is talking. Levels are read every frame and
 * written straight to the elements, not through React, so the panel never re-lays out.
 */
function Orb({ state, onSpeaking }: { state: OrbState; onSpeaking: (s: boolean) => void }) {
  const sphere = useRef<HTMLSpanElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const speakingRef = useRef(false);

  useEffect(() => {
    let frame = 0;
    let mic = 0;
    let out = 0;
    const tick = (now: number) => {
      const levels = liveLevels();
      mic += (levels.mic - mic) * 0.2;
      out += (levels.out - out) * 0.25;
      if (levels.speaking !== speakingRef.current) {
        speakingRef.current = levels.speaking;
        onSpeaking(levels.speaking);
      }
      const v = Math.min(1, levels.speaking ? out * 1.3 : mic);
      const rest = 0.012 * Math.sin(now / 700);
      if (sphere.current) sphere.current.style.scale = String(1 + rest + v * 0.16);
      if (glow.current) {
        glow.current.style.scale = String(1 + v * 0.45);
        glow.current.style.opacity = String(0.35 + v * 0.55);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onSpeaking]);

  const colour = state === "speaking" ? "speak" : state === "listening" ? "listen" : "idle";

  return (
    <div className="relative grid aspect-square h-full max-h-36 place-items-center" aria-hidden>
      <span
        ref={glow}
        className={cn(
          "absolute inset-[17%] rounded-full blur-2xl transition-[background-color] duration-500 ease-out will-change-[scale,opacity]",
          colour === "speak" ? "bg-success/45" : colour === "listen" ? "bg-accent/45" : "bg-fg-subtle/25",
        )}
      />
      <span
        ref={sphere}
        className={cn(
          "relative size-[67%] overflow-hidden rounded-full will-change-[scale] transition-[opacity] duration-500 ease-out",
          "shadow-[inset_0_-10px_24px_oklch(0.2_0.05_259/0.25),0_12px_32px_-12px_oklch(0.2_0.05_259/0.5)]",
          state === "connecting" && "opacity-70",
        )}
      >
        <span className={cn("orb-swirl orb-swirl-idle", colour === "idle" ? "opacity-100" : "opacity-0")} />
        <span className={cn("orb-swirl orb-swirl-listen", colour === "listen" ? "opacity-100" : "opacity-0")} />
        <span className={cn("orb-swirl orb-swirl-speak", colour === "speak" ? "opacity-100" : "opacity-0")} />
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_34%_26%,oklch(1_0_0/0.6),transparent_52%)]" />
        <span
          className={cn(
            "absolute inset-0 grid place-items-center text-white transition-[opacity,scale] duration-200 ease-out",
            state === "muted" ? "scale-100 opacity-100" : "scale-75 opacity-0",
          )}
        >
          <MicOffIcon className="size-8 drop-shadow-sm" />
        </span>
      </span>
      <svg
        viewBox="0 0 100 100"
        className={cn(
          "absolute inset-[8%] size-[84%] transition-opacity duration-300 ease-out",
          state === "connecting" ? "opacity-100" : "opacity-0",
        )}
        style={{ animation: "orbit 1.1s linear infinite" }}
      >
        <circle cx="50" cy="50" r="48" fill="none" strokeWidth="1.5" strokeLinecap="round" className="stroke-accent" strokeDasharray="60 242" />
      </svg>
    </div>
  );
}

function Elapsed() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = Math.floor((now - start) / 1000);
  return (
    <span className="tabular text-fg-subtle">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

const STATUS: Record<string, { label: string; dot: string; ping?: boolean }> = {
  connecting: { label: "Connecting", dot: "bg-fg-subtle animate-pulse" },
  listening: { label: "Listening", dot: "bg-accent", ping: true },
  speaking: { label: "Speaking", dot: "bg-success", ping: true },
  muted: { label: "Muted", dot: "bg-warn" },
  confirmed: { label: "Confirmed", dot: "bg-success" },
  error: { label: "Stopped", dot: "bg-danger" },
  ended: { label: "Ended", dot: "bg-fg-subtle" },
  idle: { label: "Ready", dot: "bg-fg-subtle" },
};

function RoundButton({ className, pressed, ...props }: ComponentProps<"button"> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full text-fg [&_svg]:size-5",
        "transition-[background-color,color,box-shadow,scale] duration-160 ease-out active:not-disabled:scale-[0.94] disabled:opacity-40",
        pressed
          ? "bg-fg text-bg"
          : "bg-surface-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:not-disabled:bg-surface-3",
        className,
      )}
      {...props}
    />
  );
}

let pendingStop: ReturnType<typeof setTimeout> | null = null;

/** A live spoken conversation that fills a report. Speak in any language; type if needed. */
export function LiveVoice({
  mode,
  guideId,
  title,
  doneLabel,
  onDone,
  onFields,
  onClose,
}: {
  mode: IntakeMode;
  guideId?: string;
  title?: string;
  doneLabel: string;
  onDone: (result: IntakeTurnResult) => void;
  onFields?: (fields: IntakeFields) => void;
  onClose: () => void;
}) {
  const { phase, messages, result, error, muted, finished, start, stop, sendText, toggleMute } = useLiveVoice();
  const [typing, setTyping] = useState(false);
  const [transcript, setTranscript] = useState(false);
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
    if (transcript) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages, transcript]);

  const live = phase === "live";
  const connecting = phase === "connecting";
  const active = live || connecting;
  const ready = Boolean(result?.done);
  const last = messages[messages.length - 1];

  const orbState: OrbState = connecting
    ? "connecting"
    : !live
      ? "idle"
      : muted
        ? "muted"
        : speaking
          ? "speaking"
          : "listening";
  const status = STATUS[active ? orbState : phase];

  const finish = () => {
    if (!result) return;
    stop();
    onDone(result);
  };

  return (
    <div
      data-tour="voice"
      className="flex h-[32rem] flex-col transition-[opacity,translate] duration-300 ease-out starting:translate-y-1 starting:opacity-0"
    >
      <div className="flex h-8 shrink-0 items-center justify-between gap-3">
        {title ? <p className="truncate text-sm font-medium">{title}</p> : <span />}
        <span
          className="inline-flex h-7 shrink-0 items-center gap-2 rounded-full bg-surface-2 px-2.5 text-xs font-medium shadow-[inset_0_0_0_1px_var(--color-line)]"
          aria-live="polite"
        >
          <span className="relative grid size-2 place-items-center">
            {status.ping && (
              <span
                className={cn("absolute inset-0 rounded-full", status.dot)}
                style={{ animation: "ping-soft 1.6s var(--ease-out) infinite" }}
              />
            )}
            <span className={cn("relative size-2 rounded-full transition-[background-color] duration-300", status.dot)} />
          </span>
          <span key={status.label} className="transition-opacity duration-200 ease-out starting:opacity-0">
            {status.label}
          </span>
          {live && <Elapsed />}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 place-items-center py-1">
          <Orb state={orbState} onSpeaking={setSpeaking} />
        </div>

        {/* Live captions: only the latest line, in a fixed box, so the panel never grows. */}
        <div
          className="flex h-[4.25rem] shrink-0 flex-col justify-end overflow-hidden px-2 text-center [mask-image:linear-gradient(to_bottom,transparent,black_1.75rem)]"
          aria-live="polite"
        >
          {error ? (
            <p role="alert" className="text-sm text-danger-text text-balance">
              {error}
            </p>
          ) : last ? (
            <p
              key={messages.length}
              className={cn(
                "indic text-[0.9375rem] text-balance transition-[opacity,translate,filter] duration-300 ease-out starting:translate-y-1.5 starting:opacity-0 starting:blur-[2px]",
                last.role === "manager" ? "text-fg-muted" : "text-fg",
              )}
            >
              {last.text}
              {last.open && (
                <span aria-hidden className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-current opacity-60" />
              )}
            </p>
          ) : (
            <p className="mx-auto max-w-xs text-[0.8125rem] text-fg-muted text-balance">
              {phase === "ended"
                ? "Conversation ended."
                : connecting
                  ? "Turn your volume up: it answers out loud. Allow the microphone if asked."
                  : HINT[mode]}
            </p>
          )}
        </div>

        <div className="mt-2 shrink-0">
          <ReportSoFar mode={mode} result={result} live={live} />
        </div>

        {/* The written conversation, over the orb rather than below it. */}
        <div
          inert={!transcript}
          className={cn(
            "absolute inset-0 bg-surface transition-[opacity,translate] duration-250 ease-out",
            transcript ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0",
          )}
        >
          <ol
            ref={list}
            className="flex h-full flex-col gap-2 overflow-y-auto overscroll-contain py-2 [mask-image:linear-gradient(to_bottom,transparent,black_1rem,black_calc(100%-1rem),transparent)]"
          >
            {messages.length === 0 && <li className="m-auto text-[0.8125rem] text-fg-subtle">Nothing said yet.</li>}
            {messages.map((message, i) => (
              <li
                key={i}
                className={cn(
                  "indic max-w-[88%] rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-6",
                  message.role === "manager"
                    ? "self-end rounded-br-md bg-accent text-accent-fg"
                    : "self-start rounded-bl-md bg-surface-2 text-fg",
                )}
              >
                {message.text}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Controls: one fixed-height bar whose contents crossfade. */}
      <div className="mt-4 grid h-11 shrink-0 [&>*]:col-start-1 [&>*]:row-start-1">
        {active && typing ? (
          <form
            key="typing"
            className="flex items-center gap-2 transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0"
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
              onKeyDown={(e) => e.key === "Escape" && setTyping(false)}
              placeholder="Type instead…"
              maxLength={4000}
              disabled={!live}
              className="indic h-10 min-w-0 flex-1 rounded-full bg-surface-2 px-4 shadow-[inset_0_0_0_1px_var(--color-line)] focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-soft)] focus-visible:outline-none"
            />
            <RoundButton
              type="submit"
              aria-label="Send"
              disabled={!draft.trim() || !live}
              className="bg-accent text-accent-fg shadow-none hover:not-disabled:bg-accent-hover"
            >
              <SendIcon />
            </RoundButton>
            <RoundButton aria-label="Back to voice" onClick={() => setTyping(false)}>
              <VoiceIcon />
            </RoundButton>
          </form>
        ) : active ? (
          <div key="voice" className="flex items-center gap-2 transition-opacity duration-200 ease-out starting:opacity-0">
            <RoundButton onClick={toggleMute} pressed={muted} aria-label={muted ? "Unmute" : "Mute"} disabled={!live}>
              {muted ? <MicOffIcon /> : <MicIcon />}
            </RoundButton>
            <RoundButton onClick={() => setTyping(true)} aria-label="Type instead" disabled={!live}>
              <KeyboardIcon />
            </RoundButton>
            <RoundButton onClick={() => setTranscript((t) => !t)} pressed={transcript} aria-label="Show what was said">
              <TranscriptIcon />
            </RoundButton>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              {ready && (
                <button
                  type="button"
                  onClick={finish}
                  className="h-10 min-w-0 truncate rounded-full bg-accent px-4 text-sm font-medium text-accent-fg shadow-[inset_0_1px_0_oklch(1_0_0/0.16)] transition-[background-color,opacity,scale] duration-200 ease-out hover:bg-accent-hover active:scale-[0.97] starting:scale-90 starting:opacity-0"
                >
                  {doneLabel}
                </button>
              )}
              <button
                type="button"
                aria-label="End"
                onClick={() => {
                  stop();
                  onClose();
                }}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-danger text-sm font-medium text-white [&_svg]:size-5",
                  "transition-[background-color,scale,padding] duration-200 ease-out hover:bg-danger/90 active:scale-[0.94]",
                  ready ? "w-10" : "pr-4 pl-3",
                )}
              >
                <CloseIcon />
                {!ready && "End"}
              </button>
            </div>
          </div>
        ) : (
          <div
            key="after"
            className="flex items-center justify-center gap-2 transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0"
          >
            {phase === "confirmed" && result ? (
              <button
                type="button"
                onClick={finish}
                className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-accent-fg transition-[background-color,scale] duration-160 ease-out hover:bg-accent-hover active:scale-[0.97]"
              >
                {doneLabel}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void start(mode, guideId)}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-surface-2 pr-4 pl-3 text-sm font-medium shadow-[inset_0_0_0_1px_var(--color-line)] transition-[background-color,scale] duration-160 ease-out hover:bg-surface-3 active:scale-[0.97] [&_svg]:size-5"
                >
                  <VoiceIcon />
                  Start again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="h-10 rounded-full px-4 text-sm font-medium text-fg-muted transition-[background-color,color,scale] duration-160 ease-out hover:bg-surface-2 hover:text-fg active:scale-[0.97]"
                >
                  Close
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
