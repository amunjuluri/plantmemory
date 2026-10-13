import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A short voice note: tap to start, tap to stop. The browser records in its own format
 * (WebM/Opus in Chrome and Firefox, MP4/AAC in Safari); the API accepts both.
 *
 * `level()` is the microphone loudness right now (0 to 1), read every frame by the
 * meter, not React state.
 */

export type RecorderPhase = "idle" | "starting" | "recording";
export type VoiceNote = { blob: Blob; seconds: number; filename: string };

export const MAX_SECONDS = 60;
const MIN_SECONDS = 0.8;
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function micError(err: unknown): string {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "Microphone access is blocked. Allow it in the browser’s site settings, or type the change.";
  }
  if (err instanceof DOMException && err.name === "NotFoundError")
    return "No microphone found. Type the change instead.";
  return "Couldn’t start the microphone. Type the change instead.";
}

export function useRecorder(onNote: (note: VoiceNote) => void) {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const keep = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const samples = useRef(new Uint8Array(256));
  const onNoteRef = useRef(onNote);
  useEffect(() => {
    onNoteRef.current = onNote;
  }, [onNote]);

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void context.current?.close();
    context.current = null;
    analyser.current = null;
    recorder.current = null;
  }, []);

  const finish = useCallback(
    (send: boolean) => {
      const rec = recorder.current;
      keep.current = send;
      if (rec && rec.state !== "inactive") rec.stop();
      else release();
      setPhase("idle");
    },
    [release],
  );

  const start = useCallback(async () => {
    if (phase !== "idle") return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can’t record audio. Type the change instead.");
      return;
    }
    setPhase("starting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (err) {
      release();
      setPhase("idle");
      setError(micError(err));
      return;
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    recorder.current = rec;
    chunks.current = [];
    keep.current = false;
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      const elapsed = (performance.now() - started.current) / 1000;
      const type = rec.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks.current, { type });
      release();
      if (!keep.current) return;
      if (elapsed < MIN_SECONDS || !blob.size) {
        setError("That was too short. Tap the microphone, say the change, then tap send.");
        return;
      }
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      onNoteRef.current({ blob, seconds: Math.round(elapsed), filename: `change.${ext}` });
    };

    // Loudness for the meter. Optional: recording works without it.
    try {
      context.current = new AudioContext();
      analyser.current = context.current.createAnalyser();
      analyser.current.fftSize = 256;
      context.current.createMediaStreamSource(stream.current).connect(analyser.current);
    } catch {
      analyser.current = null;
    }

    rec.start();
    started.current = performance.now();
    setSeconds(0);
    setPhase("recording");
    timer.current = setInterval(() => {
      const s = (performance.now() - started.current) / 1000;
      setSeconds(Math.floor(s));
      if (s >= MAX_SECONDS) finish(true);
    }, 250);
  }, [finish, phase, release]);

  const level = useCallback(() => {
    const node = analyser.current;
    if (!node) return 0;
    node.getByteTimeDomainData(samples.current);
    let sum = 0;
    for (const v of samples.current) sum += (v - 128) * (v - 128);
    return Math.min(1, Math.sqrt(sum / samples.current.length) / 36);
  }, []);

  // Stop the microphone if the component goes away mid-recording.
  useEffect(
    () => () => {
      keep.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    },
    [release],
  );

  return {
    phase,
    seconds,
    error,
    clearError: () => setError(null),
    start,
    /** Stop and hand the note to `onNote`. */
    send: () => finish(true),
    /** Stop and throw the recording away. */
    cancel: () => finish(false),
    level,
  };
}
