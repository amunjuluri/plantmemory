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
  cmms_import: "SAP / CMMS import",
  guide_closure: "Closed repair guide",
  public_record: "Public record, another site",
} as const;

export const SECTION_KIND_LABEL = {
  safety: "Safety",
  troubleshooting: "Troubleshooting",
  procedure: "Procedure",
  error_codes: "Alarm list",
  maintenance: "Maintenance",
  general: "General",
} as const;

/** 95 -> "1 h 35 min"; 40 -> "40 min". Same as the server's wording. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins} min`;
  return mins ? `${hours} h ${mins} min` : `${hours} h`;
}

/** "12 Oct, 09:41" from an ISO date-time, in the viewer's time zone. Client-only. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/** "09:41" from an ISO date-time as written in a machine log (no time zone conversion). */
export function logTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : iso;
}

export const INDUSTRY_LABEL = {
  paper: "Paper",
  pharma: "Pharma",
  healthcare: "Healthcare",
  generic: "General",
} as const;

/** A duration that may run to days: "just now", "12 min", "2 h 14 min", "3 d 4 h". */
export function formatDuration(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  if (Number.isNaN(whole)) return "";
  if (whole < 1) return "just now";
  if (whole < 24 * 60) return formatMinutes(whole);
  const days = Math.floor(whole / (24 * 60));
  const hours = Math.floor((whole % (24 * 60)) / 60);
  return hours ? `${days} d ${hours} h` : `${days} d`;
}

/** How long since `iso`, for a stop that is still going. */
export function formatSince(iso: string, now: number): string {
  return formatDuration((now - new Date(iso).getTime()) / 60_000);
}
