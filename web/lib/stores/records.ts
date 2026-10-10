import { create } from "zustand";

import { api, type Incident } from "@/lib/api";

type RecordsState = {
  /** Records already seen this session, by id, so chips open instantly. */
  cache: Record<string, Incident>;
  openId: string | null;
  /** The record a citation chip is hovering over; its card highlights. */
  highlightId: string | null;
  remember: (records: Incident[]) => void;
  open: (id: string) => void;
  close: () => void;
  highlight: (id: string | null) => void;
};

export const useRecords = create<RecordsState>((set, get) => ({
  cache: {},
  openId: null,
  highlightId: null,
  remember: (records) =>
    set((s) => ({ cache: { ...s.cache, ...Object.fromEntries(records.map((r) => [r.id, r])) } })),
  open: (id) => {
    set({ openId: id });
    if (!get().cache[id]) {
      api
        .incident(id)
        .then((record) => get().remember([record]))
        .catch(() => undefined);
    }
  },
  close: () => set({ openId: null }),
  highlight: (id) => set({ highlightId: id }),
}));
