"""Logs Cloud Logging can query, errors Cloud Error Reporting groups, and the app's events.

On Cloud Run every log line is one JSON object: severity, message, and any fields passed
as `extra={"fields": {...}}`. An error carries Error Reporting's type, so it is grouped
there (and can alert by email) with its traceback. Run locally, logging is unchanged.

Events are what happened, for seeing how the app is used: a page opened, the tour
finished, a guide drafted or approved. They hold ids, counts and timings, never what
anyone typed or said, and nothing is stored beyond the logs.
"""

import json
import logging
import os
import sys
import traceback

from app.models import TelemetryBatch

ERROR_EVENT = "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent"
SERVICE = os.environ.get("K_SERVICE", "plantmemory")
REVISION = os.environ.get("K_REVISION", "local")

log = logging.getLogger("plantmemory.events")
web_log = logging.getLogger("plantmemory.web")


class CloudFormatter(logging.Formatter):
    """One JSON object per line, in the shape Cloud Logging and Error Reporting read."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {"severity": record.levelname, "message": record.getMessage()}
        entry["logger"] = record.name
        entry.update(getattr(record, "fields", None) or {})
        if record.exc_info:
            entry["message"] += "\n" + "".join(traceback.format_exception(*record.exc_info))
        if record.levelno >= logging.ERROR:
            entry["@type"] = ERROR_EVENT
            entry.setdefault("serviceContext", {"service": SERVICE, "version": REVISION})
        return json.dumps(entry, default=str, ensure_ascii=False)


def setup_logging() -> None:
    """On Cloud Run, send every log (uvicorn's too) through `CloudFormatter`. Uvicorn sets
    up its loggers before importing the app, so this replaces its handlers."""
    if not os.environ.get("K_SERVICE"):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(CloudFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True


def event(name: str, **fields) -> None:
    """Record something that happened, e.g. `event("guide_approved", guide=..., asset=...)`."""
    log.info(name, extra={"fields": {"event": name, "source": "server", **fields}})


def record_batch(batch: TelemetryBatch, user_agent: str) -> None:
    """Write the browser's events to the log; its errors go to Error Reporting."""
    for item in batch.events:
        fields = {
            "event": item.name,
            "source": "web",
            "visitor": batch.visitor,
            "session": batch.session,
            "path": item.path,
            "props": item.props,
        }
        if item.error is None:
            web_log.info(f"{item.name} {item.path or ''}".strip(), extra={"fields": fields})
            continue
        err = item.error
        # Error Reporting reads a JavaScript stack in the message ("TypeError: x\n    at ...").
        head = f"{err.name}: {err.message}"
        stack = err.stack or ""
        message = stack if stack.startswith(head) else f"{head}\n{stack}".rstrip()
        fields |= {
            "serviceContext": {"service": f"{SERVICE}-web", "version": REVISION},
            "context": {
                "httpRequest": {"url": item.path or "", "userAgent": user_agent},
                "user": batch.visitor,
            },
        }
        web_log.error(message, extra={"fields": fields})
