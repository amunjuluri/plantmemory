// Mirrors app/agent/guardrails.py: a record id is alphanumeric parts joined by hyphens.
const CITATION = /\[([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)\]/g;

export type Segment = { type: "text"; value: string } | { type: "cite"; id: string };

/** Split text on inline [RECORD-ID] markers so each can render as a chip. */
export function splitCitations(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ type: "text", value: text.slice(last, start) });
    segments.push({ type: "cite", id: match[1] });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}
