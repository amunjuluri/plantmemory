"""Structured logs for Cloud Logging and Error Reporting, and the browser's events."""

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app import main, telemetry
from app.guide import workflow
from app.main import app
from app.models import GuideAction
from tests.test_guide import draft, env  # noqa: F401  (the fixture)

client = TestClient(app)


def record(level: int, msg: str, exc_info=None, **fields) -> logging.LogRecord:
    rec = logging.LogRecord("x", level, __file__, 1, msg, None, exc_info)
    rec.fields = fields
    return rec


def test_logs_are_one_json_object_and_errors_reach_error_reporting() -> None:
    fmt = telemetry.CloudFormatter()
    info = json.loads(fmt.format(record(logging.INFO, "page_view /", event="page_view")))
    assert info == {
        "severity": "INFO",
        "message": "page_view /",
        "logger": "x",
        "event": "page_view",
    }
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        err = json.loads(fmt.format(record(logging.ERROR, "Drafting failed", sys.exc_info())))
    assert err["severity"] == "ERROR" and err["@type"] == telemetry.ERROR_EVENT
    assert "Traceback" in err["message"] and "ValueError: boom" in err["message"]
    assert err["serviceContext"]["service"]


def test_setup_logging_only_on_cloud_run(monkeypatch) -> None:
    root = logging.getLogger()
    before = (root.handlers[:], root.level)
    monkeypatch.delenv("K_SERVICE", raising=False)
    telemetry.setup_logging()
    assert root.handlers == before[0]
    monkeypatch.setenv("K_SERVICE", "plantmemory")
    try:
        telemetry.setup_logging()
        assert isinstance(root.handlers[0].formatter, telemetry.CloudFormatter)
        assert logging.getLogger("uvicorn.error").propagate
    finally:
        root.handlers, _ = before[0], root.setLevel(before[1])


BATCH = {"visitor": "v-12345678", "session": "s-12345678"}


def test_browser_events_and_errors_are_logged(caplog) -> None:
    caplog.set_level(logging.INFO, logger="plantmemory.web")
    events = [
        {"name": "page_view", "path": "/", "props": {"viewport": "390x844", "x" * 50: "y" * 400}},
        {
            "name": "client_error",
            "path": "/guides/",
            "error": {
                "name": "TypeError",
                "message": "x is undefined",
                "stack": "TypeError: x is undefined\n    at f (a.js:1:2)",
            },
        },
    ]
    r = client.post("/api/telemetry", json=BATCH | {"events": events}, headers={"user-agent": "UA"})
    assert r.status_code == 204
    view, error = caplog.records[-2:]
    assert view.levelno == logging.INFO and view.fields["event"] == "page_view"
    assert view.fields["visitor"] == "v-12345678" and view.fields["path"] == "/"
    assert view.fields["props"] == {"viewport": "390x844", "x" * 40: "y" * 300}
    assert error.levelno == logging.ERROR
    assert error.getMessage() == "TypeError: x is undefined\n    at f (a.js:1:2)"
    assert error.fields["context"] == {
        "httpRequest": {"url": "/guides/", "userAgent": "UA"},
        "user": "v-12345678",
    }
    assert error.fields["serviceContext"]["service"].endswith("-web")


@pytest.mark.parametrize(
    "body",
    [
        BATCH | {"events": []},
        BATCH | {"events": [{"name": "Page View"}]},
        BATCH | {"events": [{"name": "x"}] * 31},
        {"visitor": "a b", "session": "s-12345678", "events": [{"name": "x"}]},
        BATCH | {"events": [{"name": "x", "props": {"k": {"nested": 1}}}]},
    ],
)
def test_bad_batches_are_refused(body) -> None:
    assert client.post("/api/telemetry", json=body).status_code == 422


def test_over_the_cap_is_dropped_quietly(caplog, monkeypatch) -> None:
    monkeypatch.setattr(main, "telemetry_limiter", main.RateLimiter(1))
    caplog.set_level(logging.INFO, logger="plantmemory.web")
    body = BATCH | {"events": [{"name": "page_view", "path": "/"}]}
    assert client.post("/api/telemetry", json=body).status_code == 204
    assert client.post("/api/telemetry", json=body).status_code == 204
    assert sum(r.name == "plantmemory.web" for r in caplog.records) == 1


def test_config_has_no_analytics_id_unless_set() -> None:
    assert client.get("/api/config").json()["analytics_measurement_id"] is None


def test_guide_actions_and_drafts_are_events(env, caplog) -> None:  # noqa: F811
    deps, kb = env
    caplog.set_level(logging.INFO, logger="plantmemory.events")
    _, guide = draft(deps, kb)
    workflow.approve(guide.id, GuideAction(by="Ravi"), deps, kb)
    events = {r.fields["event"]: r.fields for r in caplog.records if r.name == "plantmemory.events"}
    assert events["guide_drafted"]["asset"] == "TP-02" and events["guide_drafted"]["steps"] >= 1
    assert events["guide_submitted"]["status"] == "in_review"
    assert events["guide_drafted"]["guide"] == guide.id
    assert all("by" not in f for f in events.values())


def test_an_unexpected_error_gets_a_plain_message(monkeypatch) -> None:
    def broken():
        raise RuntimeError("bug")

    monkeypatch.setattr(main, "plant_status", lambda kb: broken())
    r = TestClient(app, raise_server_exceptions=False).get("/api/plant")
    assert r.status_code == 500
    assert r.json() == {"detail": "Something went wrong on our side. It has been reported."}


def test_the_visits_report_reads_the_logged_events(capsys) -> None:
    from scripts import visits

    def entry(ts, event, **payload):
        return {"timestamp": ts, "jsonPayload": {"event": event, **payload}}

    web = {"source": "web", "visitor": "abcdef123456", "session": "s1"}
    visits.report(
        [
            entry(
                "2026-10-17T04:00:00Z",
                "app_open",
                **web,
                props={"device": "phone", "timezone": "Asia/Kolkata"},
            ),
            entry("2026-10-17T04:00:01Z", "page_view", **web, path="/"),
            entry("2026-10-17T04:00:02Z", "tour_started", **web, props={"section": "full"}),
            entry(
                "2026-10-17T04:05:00Z",
                "tour_ended",
                **web,
                props={"section": "full", "finished": True},
            ),
            entry("2026-10-17T04:01:00Z", "draft_done", **web, props={"seconds": 9.8}),
            entry("2026-10-17T04:02:00Z", "client_error", **web, message="TypeError: x\n    at f"),
            entry(
                "2026-10-17T04:02:00Z",
                "api_failed",
                **web,
                props={"endpoint": "/api/plant", "status": 0},
            ),
            entry("2026-10-17T04:01:00Z", "guide_drafted", source="server", seconds=9.1),
        ]
    )
    out = capsys.readouterr().out
    assert "1 visitor(s), 1 visit(s)" in out and "abcdef12" in out and "17 Oct 09:30" in out
    assert "full: finished" in out and "TypeError: x" in out and "/api/plant" in out
    assert "median 9.1 s" in out
