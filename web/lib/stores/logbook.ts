import { create } from "zustand";

import { api, ApiError, type Incident, type Industry } from "@/lib/api";
import { prepareImage } from "@/lib/image";

type LogbookState = {
  industry: Industry | null;
  status: "idle" | "reading" | "review" | "saving" | "saved" | "error";
  previewUrl: string | null;
  fileName: string | null;
  startedAt: number | null;
  records: Incident[];
  pageNotes: string | null;
  error: string | null;
  savedIds: string[];
  setIndustry: (industry: Industry | null) => void;
  read: (file: File) => Promise<void>;
  update: (id: string, patch: Partial<Incident>) => void;
  remove: (id: string) => void;
  save: () => Promise<void>;
  reset: () => void;
};

let controller: AbortController | null = null;

export const useLogbook = create<LogbookState>((set, get) => ({
  industry: null,
  status: "idle",
  previewUrl: null,
  fileName: null,
  startedAt: null,
  records: [],
  pageNotes: null,
  error: null,
  savedIds: [],

  setIndustry: (industry) => set({ industry }),

  read: async (file) => {
    controller?.abort();
    controller = new AbortController();
    const previous = get().previewUrl;
    if (previous) URL.revokeObjectURL(previous);
    set({
      status: "reading",
      previewUrl: URL.createObjectURL(file),
      fileName: file.name,
      startedAt: Date.now(),
      records: [],
      pageNotes: null,
      error: null,
      savedIds: [],
    });
    try {
      const { blob, name } = await prepareImage(file);
      const result = await api.readLogbook(blob, name, get().industry, controller.signal);
      set({ status: "review", records: result.records, pageNotes: result.page_notes ?? null });
    } catch (err) {
      if (controller.signal.aborted) return;
      set({ status: "error", error: err instanceof ApiError ? err.message : "Couldn’t read that photo." });
    }
  },

  update: (id, patch) =>
    set((s) => ({
      records: s.records.map((r) => {
        if (r.id !== id) return r;
        // Editing a field the AI was unsure about counts as checking it.
        const touched = Object.keys(patch);
        return {
          ...r,
          ...patch,
          confidence_flags: r.confidence_flags.filter((f) => !touched.includes(f)),
        };
      }),
    })),

  remove: (id) => set((s) => ({ records: s.records.filter((r) => r.id !== id) })),

  save: async () => {
    const { records } = get();
    if (!records.length) return;
    set({ status: "saving", error: null });
    try {
      const saved = await api.confirmLogbook(records);
      set({ status: "saved", savedIds: saved.map((r) => r.id) });
    } catch (err) {
      set({ status: "review", error: err instanceof ApiError ? err.message : "Couldn’t save. Try again." });
    }
  },

  reset: () => {
    controller?.abort();
    const previous = get().previewUrl;
    if (previous) URL.revokeObjectURL(previous);
    set({
      status: "idle",
      previewUrl: null,
      fileName: null,
      startedAt: null,
      records: [],
      pageNotes: null,
      error: null,
      savedIds: [],
    });
  },
}));
