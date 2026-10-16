/**
 * What happens in the browser, sent to our own API (`/api/telemetry`), which writes it to
 * Cloud Logging; errors go to Cloud Error Reporting. First party, so ad blockers leave it
 * alone. When a Google Analytics 4 id is configured (a Firebase web app or a GA4
 * property), the same events also go to Google Analytics.
 *
 * Only ids, counts and timings are sent: never what anyone typed or said, nor their name.
 */

type Value = string | number | boolean | null | undefined;
export type Props = Record<string, Value>;

type Event = {
  name: string;
  path: string;
  props: Record<string, Exclude<Value, undefined>>;
  error?: { name: string; message: string; stack?: string };
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const ENDPOINT = `${process.env.NEXT_PUBLIC_API_BASE ?? ""}/api/telemetry`;
const VISITOR_KEY = "plantmemory-visitor";
const SESSION_KEY = "plantmemory-session-id";
const MAX_ERRORS = 20;

const queue: Event[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let errorsSent = 0;
const seenErrors = new Set<string>();
let memoryIds: { visitor: string; session: string } | null = null;
let newVisitor = false;

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function stored(storage: () => Storage, key: string, onCreate?: () => void): string {
  try {
    let value = storage().getItem(key);
    if (!value) {
      value = randomId();
      storage().setItem(key, value);
      onCreate?.();
    }
    return value;
  } catch {
    return "";
  }
}

/** A random id per browser (visitor) and per tab (session). No cookies, no sign-in. */
function ids() {
  const visitor = stored(() => localStorage, VISITOR_KEY, () => (newVisitor = true));
  const session = stored(() => sessionStorage, SESSION_KEY);
  if (visitor && session) return { visitor, session };
  memoryIds ??= { visitor: randomId(), session: randomId() };
  return memoryIds;
}

/** Whether this browser had never opened the app before this page load. */
export function isNewVisitor(): boolean {
  ids();
  return newVisitor;
}

function clean(props: Props): Event["props"] {
  const out: Event["props"] = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined) out[k] = v;
  return out;
}

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length) {
    const events = queue.splice(0, 30);
    // keepalive lets the last events go out as the tab closes.
    void fetch(ENDPOINT, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...ids(), events }),
    }).catch(() => undefined);
  }
}

function enqueue(event: Event) {
  if (typeof window === "undefined") return;
  queue.push(event);
  if (queue.length >= 20) flush();
  else timer ??= setTimeout(flush, 2500);
}

const here = () => `${window.location.pathname}${window.location.search}`.slice(0, 300);

/** Record that something happened, e.g. `track("tour_started", { section: "full" })`. */
export function track(name: string, props: Props = {}) {
  if (typeof window === "undefined") return;
  const event = { name, path: here(), props: clean(props) };
  enqueue(event);
  // Page views go to Google Analytics with its own fields (see Telemetry).
  if (name !== "page_view") window.gtag?.("event", name, event.props);
}

// Noise that says nothing about the app: browser extensions, cross-origin scripts, and
// a benign ResizeObserver warning.
const IGNORE = [/ResizeObserver loop/, /^Script error\.?$/, /extension:\/\//];

/** Report an error to Error Reporting (deduplicated, at most 20 per page load). */
export function reportError(error: unknown, props: Props = {}) {
  if (typeof window === "undefined") return;
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
  const text = `${err.message}\n${err.stack ?? ""}`;
  if (IGNORE.some((re) => re.test(text))) return;
  const key = `${err.name}:${err.message}:${window.location.pathname}`;
  if (seenErrors.has(key) || errorsSent >= MAX_ERRORS) return;
  seenErrors.add(key);
  errorsSent++;
  enqueue({
    name: "client_error",
    path: here(),
    props: clean(props),
    error: { name: err.name || "Error", message: err.message.slice(0, 2000) || "(no message)", stack: err.stack?.slice(0, 8000) },
  });
  window.gtag?.("event", "exception", { description: `${err.name}: ${err.message}`.slice(0, 150), fatal: Boolean(props.fatal) });
  flush();
}

/** Catches what nothing else did: uncaught errors and rejected promises. */
export function installErrorHandlers() {
  const onError = (e: ErrorEvent) => reportError(e.error ?? e.message, { kind: "uncaught" });
  const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason, { kind: "unhandled_rejection" });
  const onHide = () => document.visibilityState === "hidden" && flush();
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flush);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flush);
  };
}

/** Load Google Analytics 4 (Firebase Analytics on the web is GA4) with this id. Page
 * views are sent by the app on each route change, so automatic ones are off. */
export function startGoogleAnalytics(measurementId: string) {
  if (typeof window === "undefined" || window.gtag || !/^G-[A-Z0-9]+$/.test(measurementId)) return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js reads the `arguments` object itself, not an array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
  window.gtag("event", "page_view", { page_location: window.location.href, page_title: document.title });
}
