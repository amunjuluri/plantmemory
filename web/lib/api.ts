import type { components } from "./api-schema";

type Schemas = components["schemas"];
export type Draft = Schemas["Draft-Output"];
export type DraftItem = Schemas["DraftItem-Output"];
export type SimilarIncident = Schemas["SimilarIncident-Output"];
export type Incident = Schemas["IncidentPublic-Output"];
export type IncidentPage = Schemas["IncidentPage"];
export type IngestResult = Schemas["IngestResult"];
export type Progress = Schemas["Progress"];
export type Industry = Incident["industry"];
export type Outcome = Incident["outcome"];
export type AgentStep = "structure_incident" | "search_similar" | "check_recurrence" | "draft_report";

/** Same origin in production; the FastAPI dev server during `next dev`. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function errorFrom(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  try {
    const body = await response.json();
    if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail) && body.detail[0]?.msg) message = body.detail[0].msg;
  } catch {
    /* not JSON */
  }
  return new ApiError(message, response.status);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError("Can't reach PlantMemory. Check your connection and try again.", 0);
  }
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Runs the agent and yields each step as it happens, then the draft. */
export async function* analyzeStream(
  text: string,
  industry: Industry | null,
  signal: AbortSignal,
): AsyncGenerator<Progress> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/incidents/analyze/stream`, {
      ...json({ text, industry }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ApiError("Can't reach PlantMemory. Check your connection and try again.", 0);
  }
  if (!response.ok || !response.body) throw await errorFrom(response);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) yield JSON.parse(data) as Progress;
    }
  }
}

export const api = {
  approve: (body: {
    draft: Draft;
    root_cause?: string | null;
    action_taken?: string | null;
    outcome: Outcome;
    downtime_minutes?: number | null;
  }) => request<Incident>("/api/incidents/approve", json(body)),

  incidents: (params: { offset?: number; limit?: number; industry?: Industry | null }) => {
    const query = new URLSearchParams();
    if (params.offset) query.set("offset", String(params.offset));
    if (params.limit) query.set("limit", String(params.limit));
    if (params.industry) query.set("industry", params.industry);
    return request<IncidentPage>(`/api/incidents?${query}`);
  },

  incident: (id: string) => request<Incident>(`/api/incidents/${encodeURIComponent(id)}`),

  readLogbook: (file: Blob, filename: string, industry: Industry | null, signal?: AbortSignal) => {
    const form = new FormData();
    form.set("file", file, filename);
    if (industry) form.set("industry", industry);
    return request<IngestResult>("/api/ingest/logbook", { method: "POST", body: form, signal });
  },

  confirmLogbook: (records: Incident[]) =>
    request<Incident[]>("/api/ingest/confirm", json({ records })),
};
