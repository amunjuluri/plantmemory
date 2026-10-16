"""Who used the deployed app, what they did, and what went wrong: read from Cloud Logging.

    uv run python -m scripts.visits                # last 3 days
    uv run python -m scripts.visits --days 7 --project my-project

Each browser has a random visitor id (no names, no sign-in). The report lists every
visitor with when they came (India time), their device and time zone, pages opened, how
far the tour went, guides drafted, voice use and errors; then the errors grouped, failed
requests, and what the server recorded (guides drafted and how long they took, approvals,
imports). Needs gcloud signed in with read access to the project's logs.
"""

import argparse
import json
import statistics
import subprocess
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def read_logs(project: str | None, service: str, days: int) -> list[dict]:
    query = (
        'resource.type="cloud_run_revision" '
        f'AND resource.labels.service_name="{service}" '
        "AND jsonPayload.event:*"
    )
    cmd = ["gcloud", "logging", "read", query, f"--freshness={days}d", "--format=json"]
    cmd += ["--limit=50000", "--order=asc"]
    if project:
        cmd.append(f"--project={project}")
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    return [e for e in json.loads(out or "[]") if "jsonPayload" in e]


def when(ts: str) -> str:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(IST).strftime("%d %b %H:%M")


def table(rows: list[list], headers: list[str]) -> None:
    widths = [max(len(str(x)) for x in col) for col in zip(headers, *rows, strict=False)]
    line = "  ".join(f"{{:<{w}}}" for w in widths)
    print(line.format(*headers))
    print(line.format(*("-" * w for w in widths)))
    for row in rows:
        print(line.format(*row))


def report(entries: list[dict]) -> None:
    web = [e for e in entries if e["jsonPayload"].get("source") == "web"]
    server = [e for e in entries if e["jsonPayload"].get("source") == "server"]

    visitors: dict[str, dict] = defaultdict(
        lambda: {"pages": 0, "tour": "", "drafts": 0, "voice": 0, "errors": 0, "sessions": set()}
    )
    for e in web:
        p = e["jsonPayload"]
        v = visitors[p.get("visitor", "?")]
        v.setdefault("first", e["timestamp"])
        v["last"] = e["timestamp"]
        v["sessions"].add(p.get("session"))
        props = p.get("props") or {}
        name = p["event"]
        if name == "app_open":
            v.setdefault("device", props.get("device", ""))
            v.setdefault("timezone", props.get("timezone", ""))
            v.setdefault("referrer", props.get("referrer") or "")
        elif name == "page_view":
            v["pages"] += 1
        elif name == "tour_ended":
            done = "finished" if props.get("finished") else f"left at {props.get('step')}"
            v["tour"] = f"{props.get('section')}: {done}"
        elif name == "tour_started" and not v["tour"]:
            v["tour"] = f"{props.get('section')}: started"
        elif name == "draft_done":
            v["drafts"] += 1
        elif name == "voice_started":
            v["voice"] += 1
        elif name == "client_error":
            v["errors"] += 1

    n_visits = sum(len(v["sessions"]) for v in visitors.values())
    print(f"\n{len(visitors)} visitor(s), {n_visits} visit(s)\n")
    rows = [
        [
            vid[:8],
            when(v["first"]),
            when(v["last"]),
            v.get("device", ""),
            v.get("timezone", ""),
            len(v["sessions"]),
            v["pages"],
            v["tour"] or "-",
            v["drafts"],
            v["voice"],
            v["errors"],
            v.get("referrer", ""),
        ]
        for vid, v in sorted(visitors.items(), key=lambda kv: kv[1]["first"])
    ]
    table(
        rows,
        ["visitor", "first (IST)", "last", "device", "time zone", "visits", "pages", "tour",
         "drafts", "voice", "errors", "from"],
    )  # fmt: skip

    errors = Counter(
        (e["jsonPayload"].get("message", "").split("\n")[0][:110])
        for e in web
        if e["jsonPayload"]["event"] == "client_error"
    )
    if errors:
        print("\nBrowser errors (also grouped in Cloud Error Reporting)\n")
        table([[n, m] for m, n in errors.most_common(15)], ["count", "error"])

    failed = Counter(
        (
            (e["jsonPayload"].get("props") or {}).get("endpoint"),
            (e["jsonPayload"].get("props") or {}).get("status"),
        )
        for e in web
        if e["jsonPayload"]["event"] == "api_failed"
    )
    if failed:
        print("\nRequests that failed or never arrived (status 0)\n")
        table([[n, s, p] for (p, s), n in failed.most_common(15)], ["count", "status", "endpoint"])

    counts = Counter(e["jsonPayload"]["event"] for e in server)
    if counts:
        print("\nWhat the server recorded\n")
        table([[n, name] for name, n in counts.most_common()], ["count", "event"])
    seconds = [
        e["jsonPayload"]["seconds"]
        for e in server
        if e["jsonPayload"]["event"] == "guide_drafted" and "seconds" in e["jsonPayload"]
    ]
    if seconds:
        print(
            f"\nGuide drafting: median {statistics.median(seconds):.1f} s, "
            f"slowest {max(seconds):.1f} s, {len(seconds)} guide(s)"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--days", type=int, default=3)
    parser.add_argument("--project", default=None, help="Default: gcloud's active project.")
    parser.add_argument("--service", default="plantmemory")
    args = parser.parse_args()
    report(read_logs(args.project, args.service, args.days))


if __name__ == "__main__":
    main()
