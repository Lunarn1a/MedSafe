from fastapi.testclient import TestClient

import app.main as main
from app.model_adapter import UnavailableModelAdapter

client = TestClient(main.app)


def test_health_reports_the_current_model_state() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] in {"ready", "model-unavailable"}


def test_interaction_request_returns_an_explicit_unavailable_state() -> None:
    original_adapter = main.model_adapter
    main.model_adapter = UnavailableModelAdapter("Test model is unavailable.")
    try:
        response = client.post(
            "/api/v1/interactions/check",
            json={
                "medicines": [
                    {"display_name": "Example medicine A"},
                    {"display_name": "Example medicine B"},
                ]
            },
        )
    finally:
        main.model_adapter = original_adapter

    assert response.status_code == 503
    assert response.json()["detail"] == "Test model is unavailable."
