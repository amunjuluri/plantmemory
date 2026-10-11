import { create } from "zustand";

import { api, ApiError, type IntakeMode, type IntakeState, type IntakeTurnResult } from "@/lib/api";

const MAX_SECONDS = 60;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

type VoiceState = {
  state: IntakeState;
  phase: "idle" | "recording" | "sending" | "error";
  error: string | null;
  last: IntakeTurnResult | null;
  /** Microphone loudness, 0 to 1, while recording. */
  level: number;
  startedAt: number | null;
  reset: (mode: IntakeMode) => void;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  sendText: (text: string) => Promise<void>;
};

const EMPTY_FIELDS: IntakeState["fields"] = {
  equipment: null,
  symptom: null,
  machine_stopped: null,
  error_code: null,
  started: null,
  product_or_batch: null,
  already_tried: null,
  action_taken: null,
  root_cause: null,
  parts_used: null,
  downtime_minutes: null,
  outcome: null,
};

const fresh = (mode: IntakeMode): IntakeState => ({
  mode,
  fields: EMPTY_FIELDS,
  history: [],
  language: null,
  turns: 0,
});

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let frame = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let discard = false;

function release() {
  cancelAnimationFrame(frame);
  if (timer) clearTimeout(timer);
  timer = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  void audioContext?.close();
  audioContext = null;
  recorder = null;
}

function micError(err: unknown): string {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "Microphone access was blocked. Allow it in the browser, or type instead.";
  }
  if (err instanceof DOMException && err.name === "NotFoundError") {
    return "No microphone found. Type the report instead.";
  }
  return "Couldn't start the microphone. Type the report instead.";
}

export const useVoice = create<VoiceState>((set, get) => {
  const send = async (input: { audio?: Blob; text?: string }) => {
    set({ phase: "sending", error: null, level: 0 });
    try {
      const result = await api.intakeTurn(get().state, input);
      set({ phase: "idle", state: result.state, last: result });
    } catch (err) {
      set({ phase: "error", error: err instanceof ApiError ? err.message : "Couldn't send that. Try again." });
    }
  };

  return {
    state: fresh("breakdown"),
    phase: "idle",
    error: null,
    last: null,
    level: 0,
    startedAt: null,

    reset: (mode) => {
      discard = true;
      recorder?.stop();
      release();
      set({ state: fresh(mode), phase: "idle", error: null, last: null, level: 0, startedAt: null });
    },

    start: async () => {
      if (get().phase === "recording" || get().phase === "sending") return;
      if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        set({ phase: "error", error: "This browser can't record audio. Type the report instead." });
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (err) {
        set({ phase: "error", error: micError(err) });
        return;
      }
      const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      discard = false;
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        const type = recorder?.mimeType || mimeType || "audio/webm";
        release();
        if (discard || !chunks.length) {
          set({ phase: "idle", level: 0, startedAt: null });
          return;
        }
        void send({ audio: new Blob(chunks, { type }) });
      };

      // A live level meter so the manager can see the app is hearing them.
      audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let lastPush = 0;
      const tick = (now: number) => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const v of samples) peak = Math.max(peak, Math.abs(v - 128));
        if (now - lastPush > 60) {
          set({ level: Math.min(1, peak / 64) });
          lastPush = now;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      recorder.start();
      timer = setTimeout(() => get().stop(), MAX_SECONDS * 1000);
      set({ phase: "recording", error: null, startedAt: Date.now() });
    },

    stop: () => {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    },

    cancel: () => {
      discard = true;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else release();
      set({ phase: "idle", level: 0, startedAt: null });
    },

    sendText: async (text) => {
      if (!text.trim() || get().phase === "sending") return;
      await send({ text: text.trim() });
    },
  };
});
