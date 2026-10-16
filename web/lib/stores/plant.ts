import { useEffect, useState } from "react";
import { create } from "zustand";

import { api, type MachineStatus, type PlantStatus } from "@/lib/api";

type PlantState = {
  status: PlantStatus | null;
  error: string | null;
  refresh: () => Promise<void>;
};

let inflight: Promise<void> | null = null;

/** Which machines are running, from their repair guides. Shared by the status bar and the
 * breakdown form; refreshed when a guide changes. */
export const usePlant = create<PlantState>((set) => ({
  status: null,
  error: null,
  refresh: () => {
    inflight ??= api
      .plant()
      .then(
        (status) => set({ status, error: null }),
        (err: unknown) => set({ error: err instanceof Error ? err.message : "Couldn’t load the machines." }),
      )
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },
}));

export const refreshPlant = () => void usePlant.getState().refresh();

/** Keeps the plant status fresh while it is on screen: on mount, every minute, and when the
 * tab comes back into view (another person may have approved or released a guide). */
export function usePlantStatus() {
  const state = usePlant();
  useEffect(() => {
    refreshPlant();
    const timer = setInterval(() => document.visibilityState === "visible" && refreshPlant(), 60_000);
    const onShow = () => document.visibilityState === "visible" && refreshPlant();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return state;
}

/** The current time, ticking every `ms`, for durations that keep growing on screen. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** Where a stopped machine's repair stands, in a few words. */
export function stageLabel(m: Pick<MachineStatus, "stage" | "copies_printed">, short = false): string {
  switch (m.stage) {
    case "draft":
      return short ? "Guide in draft" : "Guide drafted, not approved yet";
    case "rejected":
      return short ? "Sent back by QA" : "Guide sent back by QA for changes";
    case "in_review":
      return short ? "Waiting for QA" : "Guide waiting for QA to check it";
    case "approved":
      return m.copies_printed
        ? short
          ? "Repair under way"
          : "Guide printed, repair under way"
        : short
          ? "Approved, not printed"
          : "Guide approved, not printed yet";
    case "closed":
      return short ? "Repaired, QA to release" : "Repaired, waiting for QA’s line clearance";
    default:
      return "Running";
  }
}
