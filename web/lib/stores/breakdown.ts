import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { ApiError, guideStream, type Asset, type Guide, type GuideStepId } from "@/lib/api";
import { track } from "@/lib/telemetry";

export type StepStatus = "pending" | "active" | "done" | "error";
export type StepState = { status: StepStatus; summary?: string | null; detail?: string | null };

export const GUIDE_STEPS: { id: GuideStepId; label: string }[] = [
  { id: "understand", label: "Understanding the report" },
  { id: "search_history", label: "Searching past fixes" },
  { id: "search_manuals", label: "Reading the equipment manual" },
  { id: "find_parts", label: "Checking spare parts" },
  { id: "write_guide", label: "Writing the repair guide" },
];

/** Sample reports for the demo: the form offers them, and the welcome tour starts with the first. */
export const EXAMPLES = [
  { label: "TP-02 punch tight", text: "TP-02 stopped in the middle of the batch. Screen shows E-104 punch tight.", asset: "TP-02" },
  { label: "Autoclave door seal (Telugu)", text: "ఆటోక్లేవ్ AC-2 సైకిల్ మొదలవ్వట్లేదు, door seal fault అని చూపిస్తోంది", asset: "AC-2" },
  { label: "Blisters not sealing", text: "BL-3 blisters not sealing properly, tablets falling out of the strips. Screen shows E-44 sealing temperature.", asset: "BL-3" },
  { label: "Something new", text: "The coating pan spray gun keeps dripping and the pan has stopped.", asset: null },
];

const freshSteps = (): Record<GuideStepId, StepState> => ({
  understand: { status: "pending" },
  search_history: { status: "pending" },
  search_manuals: { status: "pending" },
  find_parts: { status: "pending" },
  write_guide: { status: "pending" },
});

/** One question before drafting: the report is too vague, or names another machine. */
export type Clarify = { question: string; machines: Asset[] };

type BreakdownState = {
  text: string;
  assetTag: string | null;
  status: "idle" | "running" | "done" | "error" | "clarify";
  clarify: Clarify | null;
  steps: Record<GuideStepId, StepState>;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  guide: Guide | null;
  setText: (text: string) => void;
  setAssetTag: (tag: string | null) => void;
  /** `confirmed`: the manager picked this machine when asked, so it isn't questioned again. */
  run: (by: string, confirmed?: boolean) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  setGuide: (guide: Guide) => void;
};

let controller: AbortController | null = null;

export const useBreakdown = create<BreakdownState>()(
  persist(
    (set, get) => ({
      text: "",
      assetTag: null,
      status: "idle",
      clarify: null,
      steps: freshSteps(),
      startedAt: null,
      finishedAt: null,
      error: null,
      guide: null,

      setText: (text) => set({ text }),
      setAssetTag: (assetTag) => set({ assetTag }),

      run: async (by, confirmed = false) => {
        const { text, assetTag, status } = get();
        if (status === "running" || text.trim().length < 5) return;
        controller?.abort();
        controller = new AbortController();
        const signal = controller.signal;
        set({
          status: "running",
          clarify: null,
          steps: freshSteps(),
          startedAt: Date.now(),
          finishedAt: null,
          error: null,
          guide: null,
        });
        const setStep = (id: GuideStepId, state: StepState) =>
          set((s) => ({ steps: { ...s.steps, [id]: state } }));

        try {
          for await (const event of guideStream(
            { text: text.trim(), asset_tag: assetTag, by, machine_confirmed: confirmed },
            signal,
          )) {
            if (event.type === "step" && event.step) {
              const id = event.step as GuideStepId;
              if (event.status === "started") setStep(id, { status: "active" });
              else if (event.status === "done") setStep(id, { status: "done", summary: event.summary });
              else setStep(id, { status: "error", detail: event.detail });
            } else if (event.type === "guide" && event.guide) {
              set({ status: "done", guide: event.guide, finishedAt: Date.now() });
            } else if (event.type === "clarify" && event.question) {
              set({
                status: "clarify",
                clarify: { question: event.question, machines: event.machines },
                steps: freshSteps(),
                finishedAt: Date.now(),
              });
            } else if (event.type === "error") {
              throw new ApiError(event.detail ?? "The guide could not be drafted.", 502);
            }
          }
          if (get().status === "running") {
            throw new ApiError("The connection closed before the guide was ready.", 0);
          }
        } catch (err) {
          if (signal.aborted) return;
          set((s) => ({
            status: "error",
            finishedAt: Date.now(),
            error: err instanceof Error ? err.message : "Something went wrong.",
            steps: Object.fromEntries(
              Object.entries(s.steps).map(([id, step]) => [
                id,
                step.status === "active" ? { status: "error" } : step,
              ]),
            ) as Record<GuideStepId, StepState>,
          }));
        }
      },

      cancel: () => {
        controller?.abort();
        set({ status: "idle", clarify: null, steps: freshSteps(), startedAt: null, finishedAt: null });
      },

      reset: () => {
        controller?.abort();
        set({
          text: "",
          assetTag: null,
          status: "idle",
          clarify: null,
          steps: freshSteps(),
          startedAt: null,
          finishedAt: null,
          error: null,
          guide: null,
        });
      },

      setGuide: (guide) => set({ guide }),
    }),
    {
      // Keep the manager's work across a refresh in this tab.
      name: "plantmemory-breakdown",
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: (s) => ({
        text: s.text,
        assetTag: s.assetTag,
        guide: s.guide,
        steps: s.status === "done" ? s.steps : freshSteps(),
        status: s.status === "done" ? "done" : "idle",
        startedAt: s.status === "done" ? s.startedAt : null,
        finishedAt: s.status === "done" ? s.finishedAt : null,
      }),
    },
  ),
);

// Drafting as the manager sees it, network included: started, done in how long, or failed.
useBreakdown.subscribe((now, before) => {
  if (now.status === before.status) return;
  if (now.status === "running") {
    track("draft_started", {
      machine: now.assetTag ?? "auto",
      // Which script the report is in, not what it says.
      script: /[\u0900-\u0DFF]/.test(now.text) ? "indian" : "latin",
      length: now.text.trim().length,
    });
  } else if (before.status === "running") {
    const seconds = now.startedAt && now.finishedAt ? Math.round((now.finishedAt - now.startedAt) / 100) / 10 : null;
    if (now.status === "clarify") {
      track("draft_clarify", { seconds, machines: now.clarify?.machines.length ?? 0 });
    } else if (now.status === "done") {
      track("draft_done", { seconds, machine: now.guide?.asset_tag ?? null, steps: now.guide?.steps.length ?? 0 });
    } else if (now.status === "error") track("draft_failed", { seconds, reason: now.error });
    else track("draft_stopped", { seconds: now.startedAt ? Math.round((Date.now() - now.startedAt) / 100) / 10 : null });
  }
});
