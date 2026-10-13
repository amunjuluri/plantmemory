import type { components } from "./api-schema";

type Schemas = components["schemas"];
export type Draft = Schemas["Draft-Output"];
export type DraftItem = Schemas["DraftItem-Output"];
export type SimilarIncident = Schemas["SimilarIncident-Output"];
export type Recurrence = Schemas["Recurrence-Output"];
export type Incident = Schemas["IncidentPublic-Output"];
export type IncidentPage = Schemas["IncidentPage"];
export type IngestResult = Schemas["IngestResult"];
export type Progress = Schemas["Progress"];
export type Industry = Incident["industry"];
export type Outcome = Incident["outcome"];
export type AgentStep = "structure_incident" | "search_similar" | "check_recurrence" | "draft_report";

export type Guide = Schemas["Guide"];
export type GuideStatus = Guide["status"];
export type GuideStep = Schemas["GuideStep-Output"];
export type GuideItem = Schemas["GuideItem-Output"];
export type GuidePart = Schemas["GuidePart"];
export type GuidePartPick = Schemas["GuidePartPick"];
export type GuideSummary = Schemas["GuideSummary"];
export type GuideProgress = Schemas["GuideProgress"];
export type GuideEdit = Schemas["GuideEdit"];
export type GuideTranslation = Schemas["GuideTranslation"];
export type GuideEvent = Schemas["GuideEvent"];
export type GuideRevision = Schemas["GuideRevision"];
export type SourceRef = Schemas["SourceRef"];
export type DowntimeEstimate = Schemas["DowntimeEstimate"];
export type ManualSection = Schemas["ManualSectionPublic"];
export type ManualSummary = Schemas["ManualSummary"];
export type ManualUploadResult = Schemas["ManualUploadResult"];
export type Part = Schemas["Part"];
export type Asset = Schemas["Asset"];
export type AppConfig = Schemas["AppConfig"];
export type IntakeState = Schemas["IntakeState"];
export type IntakeFields = Schemas["IntakeFields"];
export type IntakeTurnResult = Schemas["IntakeTurnResult"];
export type IntakeMode = IntakeState["mode"];
export type LogAnalysis = Schemas["LogAnalysis"];
export type LogCodeSummary = Schemas["LogCodeSummary"];
export type CmmsImportResult = Schemas["CmmsImportResult"];
export type GuideStepId = "understand" | "search_history" | "search_manuals" | "find_parts" | "write_guide";

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

/** POST a JSON body and yield each server-sent event's data as it arrives. */
async function* postEvents<T>(path: string, body: unknown, signal: AbortSignal): AsyncGenerator<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...json(body), signal });
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
      if (data) yield JSON.parse(data) as T;
    }
  }
}

/** Runs the agent and yields each step as it happens, then the draft. */
export function analyzeStream(text: string, industry: Industry | null, signal: AbortSignal) {
  return postEvents<Progress>("/api/incidents/analyze/stream", { text, industry }, signal);
}

/** Drafts a repair guide and yields each step as it happens, then the saved guide. */
export function guideStream(
  body: { text: string; asset_tag?: string | null; by: string },
  signal: AbortSignal,
) {
  return postEvents<GuideProgress>("/api/guides/stream", body, signal);
}

const put = (body: unknown): RequestInit => ({ ...json(body), method: "PUT" });

function upload(fields: Record<string, string | Blob | null | undefined>, filename?: string): RequestInit {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === "") continue;
    if (value instanceof Blob) form.set(key, value, filename ?? (value instanceof File ? value.name : key));
    else form.set(key, value);
  }
  return { method: "POST", body: form };
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

  config: () => request<AppConfig>("/api/config"),
  assets: () => request<Asset[]>("/api/assets"),
  manuals: () => request<ManualSummary[]>("/api/manuals"),
  manualSections: (manualId: string) =>
    request<ManualSection[]>(`/api/manuals/${encodeURIComponent(manualId)}/sections`),
  manualSection: (id: string) => request<ManualSection>(`/api/manuals/sections/${encodeURIComponent(id)}`),
  uploadManual: (file: File, assetTags: string, signal?: AbortSignal) =>
    request<ManualUploadResult>("/api/manuals/upload", {
      ...upload({ file, asset_tags: assetTags }),
      signal,
    }),
  deleteManual: (manualId: string) =>
    request<{ sections_removed: number }>(`/api/manuals/${encodeURIComponent(manualId)}`, {
      method: "DELETE",
    }),
  parts: (asset?: string | null) =>
    request<Part[]>(`/api/parts${asset ? `?asset=${encodeURIComponent(asset)}` : ""}`),

  guides: (status?: GuideStatus | null) =>
    request<GuideSummary[]>(`/api/guides${status ? `?status=${status}` : ""}`),
  guide: (id: string) => request<Guide>(`/api/guides/${encodeURIComponent(id)}`),
  editGuide: (id: string, body: GuideEdit) => request<Guide>(`/api/guides/${encodeURIComponent(id)}`, put(body)),
  /** Propose a change asked for by voice or typed. Nothing is saved. */
  reviseGuide: (
    id: string,
    body: {
      by: string;
      text?: string;
      audio?: Blob;
      filename?: string;
      base?: GuideEdit;
      history?: string[];
      /** A request that got a question back, and the question this message answers. */
      followUp?: { asked: string; question: string };
    },
    signal?: AbortSignal,
  ) =>
    request<GuideRevision>(`/api/guides/${encodeURIComponent(id)}/revise`, {
      ...upload(
        {
          by: body.by,
          text: body.text,
          audio: body.audio,
          base: body.base ? JSON.stringify(body.base) : null,
          history: body.history?.length ? JSON.stringify(body.history) : null,
          asked: body.followUp?.asked,
          question: body.followUp?.question,
        },
        body.filename,
      ),
      signal,
    }),
  approveGuide: (id: string, by: string) =>
    request<Guide>(`/api/guides/${encodeURIComponent(id)}/approve`, json({ by })),
  releaseGuide: (id: string, by: string, checks: string[], comment?: string) =>
    request<Guide>(`/api/guides/${encodeURIComponent(id)}/release`, json({ by, checks, comment })),
  submitGuide: (id: string, by: string) =>
    request<Guide>(`/api/guides/${encodeURIComponent(id)}/submit`, json({ by })),
  reviewGuide: (id: string, by: string, decision: "approve" | "reject", comment?: string) =>
    request<Guide>(`/api/guides/${encodeURIComponent(id)}/review`, json({ by, decision, comment })),
  printGuide: (id: string, by: string) =>
    request<Guide>(`/api/guides/${encodeURIComponent(id)}/print`, json({ by })),
  closeGuide: (
    id: string,
    body: {
      by: string;
      action_taken: string;
      root_cause?: string | null;
      outcome: Outcome;
      downtime_minutes?: number | null;
      parts_used?: string | null;
    },
  ) => request<Guide>(`/api/guides/${encodeURIComponent(id)}/close`, json(body)),

  analyzeLog: (file: File, assetTag: string | null, signal?: AbortSignal) =>
    request<LogAnalysis>("/api/logs/analyze", { ...upload({ file, asset_tag: assetTag }), signal }),

  importCmms: (file: File, signal?: AbortSignal) =>
    request<CmmsImportResult>("/api/ingest/cmms", { ...upload({ file }), signal }),
};

/** URL of a manual figure or part photo. */
export const figureUrl = (id: string) => `${API_BASE}/api/figures/${encodeURIComponent(id)}`;

/** Fetch one of the bundled sample files as a File, as if the user picked it. */
export async function sampleFile(name: string, type: string): Promise<File> {
  const response = await fetch(`${API_BASE}/samples/${name}`);
  if (!response.ok) throw new ApiError("Couldn't load the sample file.", response.status);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || type });
}
