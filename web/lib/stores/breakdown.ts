import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { ApiError, guideStream, type Guide, type GuideStepId } from "@/lib/api";

export type StepStatus = "pending" | "active" | "done" | "error";
export type StepState = { status: StepStatus; summary?: string | null; detail?: string | null };

export const GUIDE_STEPS: { id: GuideStepId; label: string }[] = [
  { id: "understand", label: "Understanding the report" },
  { id: "search_history", label: "Searching past fixes" },
  { id: "search_manuals", label: "Reading the equipment manual" },
  { id: "find_parts", label: "Checking spare parts" },
  { id: "write_guide", label: "Writing the repair guide" },
];

const freshSteps = (): Record<GuideStepId, StepState> => ({
  understand: { status: "pending" },
  search_history: { status: "pending" },
  search_manuals: { status: "pending" },
  find_parts: { status: "pending" },
  write_guide: { status: "pending" },
});

type BreakdownState = {
  text: string;
  assetTag: string | null;
  status: "idle" | "running" | "done" | "error";
  steps: Record<GuideStepId, StepState>;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  guide: Guide | null;
  setText: (text: string) => void;
  setAssetTag: (tag: string | null) => void;
  run: (by: string) => Promise<void>;
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
      steps: freshSteps(),
      startedAt: null,
      finishedAt: null,
      error: null,
      guide: null,

      setText: (text) => set({ text }),
      setAssetTag: (assetTag) => set({ assetTag }),

      run: async (by) => {
        const { text, assetTag, status } = get();
        if (status === "running" || text.trim().length < 5) return;
        controller?.abort();
        controller = new AbortController();
        const signal = controller.signal;
        set({
          status: "running",
          steps: freshSteps(),
          startedAt: Date.now(),
          finishedAt: null,
          error: null,
          guide: null,
        });
        const setStep = (id: GuideStepId, state: StepState) =>
          set((s) => ({ steps: { ...s.steps, [id]: state } }));

        try {
          for await (const event of guideStream({ text: text.trim(), asset_tag: assetTag, by }, signal)) {
            if (event.type === "step" && event.step) {
              const id = event.step as GuideStepId;
              if (event.status === "started") setStep(id, { status: "active" });
              else if (event.status === "done") setStep(id, { status: "done", summary: event.summary });
              else setStep(id, { status: "error", detail: event.detail });
            } else if (event.type === "guide" && event.guide) {
              set({ status: "done", guide: event.guide, finishedAt: Date.now() });
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
        set({ status: "idle", steps: freshSteps(), startedAt: null, finishedAt: null });
      },

      reset: () => {
        controller?.abort();
        set({
          text: "",
          assetTag: null,
          status: "idle",
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
