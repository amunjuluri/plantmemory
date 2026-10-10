import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "18 Jun 2026" from an ISO date. No locale or time zone, so server and client agree. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Cosine similarity as a whole-number percentage. */
export function percent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export const OUTCOME_LABEL = {
  resolved: "Resolved",
  recurred: "Came back",
  unknown: "Outcome unknown",
} as const;

export const SOURCE_LABEL = {
  seed: "Sample record",
  logbook_photo: "Logbook photo",
  voice_note: "Voice note",
  approved_draft: "Approved draft",
} as const;

export const INDUSTRY_LABEL = { paper: "Paper", pharma: "Pharma", generic: "General" } as const;
