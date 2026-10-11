import { create } from "zustand";

import { api, type Incident, type ManualSection } from "@/lib/api";

/** Manual sections are cited as MAN-<manual>-<page>; everything else is an incident. */
export const isManualId = (id: string) => id.startsWith("MAN-");

type RecordsState = {
  /** Records and manual sections already seen this session, by id, so chips open instantly. */
  cache: Record<string, Incident>;
  sections: Record<string, ManualSection>;
  openId: string | null;
  /** The source a citation chip is hovering over; its card highlights. */
  highlightId: string | null;
  remember: (records: Incident[]) => void;
  rememberSections: (sections: ManualSection[]) => void;
  open: (id: string) => void;
  close: () => void;
  highlight: (id: string | null) => void;
};

export const useRecords = create<RecordsState>((set, get) => ({
  cache: {},
  sections: {},
  openId: null,
  highlightId: null,
  remember: (records) =>
    set((s) => ({ cache: { ...s.cache, ...Object.fromEntries(records.map((r) => [r.id, r])) } })),
  rememberSections: (sections) =>
    set((s) => ({
      sections: { ...s.sections, ...Object.fromEntries(sections.map((x) => [x.id, x])) },
    })),
  open: (id) => {
    set({ openId: id });
    if (isManualId(id)) {
      if (!get().sections[id]) {
        api
          .manualSection(id)
          .then((section) => get().rememberSections([section]))
          .catch(() => undefined);
      }
    } else if (!get().cache[id]) {
      api
        .incident(id)
        .then((record) => get().remember([record]))
        .catch(() => undefined);
    }
  },
  close: () => set({ openId: null }),
  highlight: (id) => set({ highlightId: id }),
}));
