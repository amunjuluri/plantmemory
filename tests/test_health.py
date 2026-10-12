from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_ok_without_secrets() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert set(body) == {
        "status",
        "version",
        "store_backend",
        "gemini_model",
        "embedding_model",
        "auth",
    }


def test_root_serves_ui() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "PlantMemory" in response.text


def test_text_is_gzipped_but_event_streams_are_not() -> None:
    response = client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert response.headers["content-encoding"] == "gzip"
    from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES

    assert "text/event-stream" in DEFAULT_EXCLUDED_CONTENT_TYPES


def test_hashed_ui_files_are_cached_for_a_year(tmp_path) -> None:
    import asyncio

    from app.main import UIFiles

    (tmp_path / "_next" / "static").mkdir(parents=True)
    (tmp_path / "_next" / "static" / "a1b2.js").write_text("x")
    (tmp_path / "index.html").write_text("<html></html>")
    files = UIFiles(directory=tmp_path, html=True)
    scope = {"type": "http", "method": "GET", "headers": []}
    hashed = asyncio.run(files.get_response("_next/static/a1b2.js", scope))
    page = asyncio.run(files.get_response("index.html", scope))
    assert "immutable" in hashed.headers["cache-control"]
    assert "cache-control" not in page.headers
