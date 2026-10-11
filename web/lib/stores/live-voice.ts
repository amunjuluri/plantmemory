import { create } from "zustand";

import { API_BASE, type IntakeMode, type IntakeTurnResult } from "@/lib/api";

/**
 * A live spoken conversation with Gemini Live, through the API's WebSocket
 * (/api/intake/live). The microphone is streamed as 16 kHz PCM; the reply comes back as
 * 24 kHz PCM and is played as it arrives, so the assistant answers within about a second.
 * The manager can talk over it to interrupt.
 */

export type LiveMessage = { role: "manager" | "assistant"; text: string; open: boolean };
export type LivePhase = "idle" | "connecting" | "live" | "confirmed" | "ended" | "error";

type LiveState = {
  phase: LivePhase;
  mode: IntakeMode;
  messages: LiveMessage[];
  result: IntakeTurnResult | null;
  error: string | null;
  muted: boolean;
  /** True once the confirmed report's closing words have finished playing. */
  finished: boolean;
  start: (mode: IntakeMode, guideId?: string) => Promise<void>;
  stop: () => void;
  confirm: () => void;
  sendText: (text: string) => void;
  toggleMute: () => void;
};

const OUTPUT_RATE = 24_000;

// Averages the microphone down to 16 kHz (a box filter is enough for speech) and posts
// 100 ms chunks of 16-bit PCM. Inlined so the static export needs no extra file.
const RECORDER = `
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0; this.sum = 0; this.count = 0;
    this.buf = new Int16Array(1600); this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.count++; this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        const s = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0; this.count = 0;
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(1600); this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-recorder", PcmRecorder);
`;

let socket: WebSocket | null = null;
let stream: MediaStream | null = null;
let micContext: AudioContext | null = null;
let playContext: AudioContext | null = null;
let micAnalyser: AnalyserNode | null = null;
let playAnalyser: AnalyserNode | null = null;
let playing = new Set<AudioBufferSourceNode>();
let playhead = 0;
let finishTimer: ReturnType<typeof setTimeout> | null = null;
const samples = new Uint8Array(512);

function level(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (const v of samples) sum += (v - 128) * (v - 128);
  return Math.min(1, Math.sqrt(sum / samples.length) / 40);
}

/** Loudness right now, 0 to 1, read every frame by the orb (not React state). */
export function liveLevels() {
  const speaking = playContext ? playhead > playContext.currentTime + 0.05 : false;
  return { mic: useLiveVoice.getState().muted ? 0 : level(micAnalyser), out: level(playAnalyser), speaking };
}

function socketUrl(mode: IntakeMode, guideId?: string) {
  const base = API_BASE || window.location.origin;
  const url = new URL("/api/intake/live", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("mode", mode);
  if (guideId) url.searchParams.set("guide_id", guideId);
  return url.toString();
}

function flushPlayback() {
  for (const source of playing) {
    try {
      source.stop();
    } catch {
      // already ended
    }
  }
  playing = new Set();
  playhead = playContext?.currentTime ?? 0;
}

function play(data: ArrayBuffer) {
  if (!playContext || !playAnalyser) return;
  const pcm = new Int16Array(data);
  const buffer = playContext.createBuffer(1, pcm.length, OUTPUT_RATE);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;
  const source = playContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playAnalyser);
  playhead = Math.max(playhead, playContext.currentTime + 0.03);
  source.start(playhead);
  playhead += buffer.duration;
  playing.add(source);
  source.onended = () => playing.delete(source);
}

function release() {
  if (finishTimer) clearTimeout(finishTimer);
  finishTimer = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  void micContext?.close();
  micContext = null;
  micAnalyser = null;
  if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  socket = null;
}

function micError(err: unknown): string {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "Microphone access was blocked. Allow it in the browser, or type instead.";
  }
  if (err instanceof DOMException && err.name === "NotFoundError") {
    return "No microphone found. Type instead.";
  }
  return "Couldn't start the microphone. Type instead.";
}

/** Add streamed words to the open message of that speaker, or start a new one. */
function appendWords(messages: LiveMessage[], role: LiveMessage["role"], text: string): LiveMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === role && last.open) {
    return [...messages.slice(0, -1), { ...last, text: last.text + text }];
  }
  // A new speaker closes the other one's message.
  return [...messages.map((m) => (m.open ? { ...m, open: false } : m)), { role, text: text.trimStart(), open: true }];
}

export const useLiveVoice = create<LiveState>((set, get) => {
  const finishAfterPlayback = () => {
    const remaining = playContext ? Math.max(0, playhead - playContext.currentTime) : 0;
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = setTimeout(() => set({ finished: true }), remaining * 1000 + 250);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      play(event.data);
      return;
    }
    const msg = JSON.parse(String(event.data));
    switch (msg.type) {
      case "ready":
        set({ phase: "live" });
        break;
      case "transcript":
        set({ messages: appendWords(get().messages, msg.role, msg.text) });
        break;
      case "turn_complete":
        set({ messages: get().messages.map((m) => ({ ...m, open: false })) });
        break;
      case "interrupted":
        flushPlayback();
        break;
      case "report":
        set({ result: msg.result });
        break;
      case "confirmed":
        set({ result: msg.result, phase: "confirmed" });
        release();
        finishAfterPlayback();
        break;
      case "error":
        set({ phase: "error", error: msg.message });
        release();
        break;
    }
  };

  return {
    phase: "idle",
    mode: "breakdown",
    messages: [],
    result: null,
    error: null,
    muted: false,
    finished: false,

    start: async (mode, guideId) => {
      if (get().phase === "connecting" || get().phase === "live") return;
      release();
      flushPlayback();
      set({ phase: "connecting", mode, messages: [], result: null, error: null, muted: false, finished: false });
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
        set({ phase: "error", error: "This browser can't stream audio. Type instead." });
        return;
      }
      // Created inside the tap, so the browser lets them play sound.
      micContext = new AudioContext();
      playContext ??= new AudioContext({ sampleRate: OUTPUT_RATE });
      void playContext.resume();
      if (!playAnalyser) {
        playAnalyser = playContext.createAnalyser();
        playAnalyser.fftSize = 512;
        playAnalyser.connect(playContext.destination);
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch (err) {
        release();
        set({ phase: "error", error: micError(err) });
        return;
      }
      const context = micContext;
      if (!context || get().phase !== "connecting") {
        stream.getTracks().forEach((t) => t.stop()); // stopped while asking for the microphone
        stream = null;
        return;
      }
      const url = URL.createObjectURL(new Blob([RECORDER], { type: "application/javascript" }));
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = context.createMediaStreamSource(stream);
      micAnalyser = context.createAnalyser();
      micAnalyser.fftSize = 512;
      const recorder = new AudioWorkletNode(context, "pcm-recorder");
      source.connect(micAnalyser);
      source.connect(recorder);

      const ws = new WebSocket(socketUrl(mode, guideId));
      ws.binaryType = "arraybuffer";
      socket = ws;
      recorder.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (ws.readyState === WebSocket.OPEN && get().phase === "live" && !get().muted) ws.send(e.data);
      };
      ws.onmessage = onMessage;
      ws.onclose = () => {
        if (socket !== ws) return;
        const phase = get().phase;
        if (phase === "connecting" || phase === "live") {
          set({ phase: "error", error: "The voice connection closed. Start again, or type." });
        }
        release();
      };
    },

    stop: () => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "end" }));
      release();
      flushPlayback();
      if (get().phase !== "confirmed") set({ phase: "ended" });
    },

    confirm: () => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "confirm" }));
    },

    sendText: (text) => {
      const clean = text.trim();
      if (!clean || socket?.readyState !== WebSocket.OPEN) return;
      flushPlayback();
      socket.send(JSON.stringify({ type: "text", text: clean }));
      const closed = get().messages.map((m) => ({ ...m, open: false }));
      set({ messages: [...closed, { role: "manager", text: clean, open: false }] });
    },

    toggleMute: () => set({ muted: !get().muted }),
  };
});
