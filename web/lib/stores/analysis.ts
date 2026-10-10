import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { analyzeStream, ApiError, type AgentStep, type Draft, type Industry } from "@/lib/api";

export type StepStatus = "pending" | "active" | "done" | "error";
export type StepState = { status: StepStatus; summary?: string | null; detail?: string | null };

export const STEPS: { id: AgentStep; label: string }[] = [
  { id: "structure_incident", label: "Understanding the report" },
  { id: "search_similar", label: "Searching plant memory" },
  { id: "check_recurrence", label: "Checking for repeats" },
  { id: "draft_report", label: "Drafting the note" },
];

const freshSteps = (): Record<AgentStep, StepState> => ({
  structure_incident: { status: "pending" },
  search_similar: { status: "pending" },
  check_recurrence: { status: "pending" },
  draft_report: { status: "pending" },
});

type AnalysisState = {
  text: string;
  industry: Industry | null;
  status: "idle" | "running" | "done" | "error";
  steps: Record<AgentStep, StepState>;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  /** The draft as the agent wrote it, and the reviewer's working copy. */
  original: Draft | null;
  draft: Draft | null;
  approvedId: string | null;
  /** True once the reviewer has changed the agent's draft. */
  edited: boolean;
  setText: (text: string) => void;
  setIndustry: (industry: Industry | null) => void;
  run: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
  editDraft: (update: (draft: Draft) => Draft) => void;
  revertDraft: () => void;
  markApproved: (id: string) => void;
};

let controller: AbortController | null = null;

export const useAnalysis = create<AnalysisState>()(
  persist(
    (set, get) => ({
  text: "",
  industry: null,
  status: "idle",
  steps: freshSteps(),
  startedAt: null,
  finishedAt: null,
  error: null,
  original: null,
  draft: null,
  approvedId: null,
  edited: false,

  setText: (text) => set({ text }),
  setIndustry: (industry) => set({ industry }),

  run: async () => {
    const { text, industry, status } = get();
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
      original: null,
      draft: null,
      approvedId: null,
      edited: false,
    });

    const setStep = (id: AgentStep, state: StepState) =>
      set((s) => ({ steps: { ...s.steps, [id]: state } }));

    try {
      for await (const event of analyzeStream(text.trim(), industry, signal)) {
        if (event.type === "step" && event.step) {
          const id = event.step as AgentStep;
          if (event.status === "started") setStep(id, { status: "active" });
          else if (event.status === "done") setStep(id, { status: "done", summary: event.summary });
          else setStep(id, { status: "error", detail: event.detail });
        } else if (event.type === "draft" && event.draft) {
          set({ status: "done", original: event.draft, draft: event.draft, finishedAt: Date.now() });
        } else if (event.type === "error") {
          throw new ApiError(event.detail ?? "The agent could not finish this draft.", 502);
        }
      }
      if (get().status === "running") {
        throw new ApiError("The connection closed before the draft was ready.", 0);
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
        ) as Record<AgentStep, StepState>,
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
      status: "idle",
      steps: freshSteps(),
      startedAt: null,
      finishedAt: null,
      error: null,
      original: null,
      draft: null,
      approvedId: null,
      edited: false,
    });
  },

  editDraft: (update) => set((s) => (s.draft ? { draft: update(s.draft), edited: true } : {})),
  revertDraft: () => set((s) => ({ draft: s.original, edited: false })),
  markApproved: (id) =>
    set((s) => ({ approvedId: id, draft: s.draft ? { ...s.draft, status: "approved" } : null })),
}),
    {
      // Keep the reviewer's work across a page refresh in this tab (not across tabs).
      name: "plantmemory-analysis",
      storage: createJSONStorage(() => sessionStorage),
      // Restored after mount (see AnalyzeView) so the first render matches the prerendered HTML.
      skipHydration: true,
      partialize: (s) => ({
        text: s.text,
        industry: s.industry,
        original: s.original,
        draft: s.draft,
        approvedId: s.approvedId,
        edited: s.edited,
        steps: s.status === "done" ? s.steps : freshSteps(),
        status: s.status === "done" ? "done" : "idle",
        startedAt: s.status === "done" ? s.startedAt : null,
        finishedAt: s.status === "done" ? s.finishedAt : null,
      }),
    },
  ),
);
