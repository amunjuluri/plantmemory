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
