from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from itertools import combinations
import json
import os
from pathlib import Path
import sys
from typing import Any
from uuid import uuid4

from .schemas import InteractionCheckRequest, InteractionCheckResponse, InteractionResult, ModelMetadata


class ModelNotConfiguredError(RuntimeError):
    """Raised when a model runtime has not been connected to MedSafe."""


class ModelAdapter(ABC):
    def health(self) -> dict[str, Any]:
        return {"status": "ready", "model_loaded": True}

    @abstractmethod
    async def check_interactions(
        self, request: InteractionCheckRequest
    ) -> InteractionCheckResponse:
        """Run the approved model and return the agreed response schema."""


class UnavailableModelAdapter(ModelAdapter):
    def __init__(self, reason: str | None = None):
        self.reason = reason or "No AI model adapter is configured."

    def health(self) -> dict[str, Any]:
        return {"status": "model-unavailable", "model_loaded": False, "detail": self.reason}

    async def check_interactions(
        self, request: InteractionCheckRequest
    ) -> InteractionCheckResponse:
        raise ModelNotConfiguredError(self.reason)


class TrainedSuggestionAdapter(ModelAdapter):
    """Adapt the supplied experimental guidance model to MedSafe's API contract."""

    def __init__(self, suggestion_service: Any, metadata: dict[str, Any]):
        self.suggestion_service = suggestion_service
        self.model = ModelMetadata(
            name="MedSafe experimental guidance selector",
            version=metadata["python_version"],
        )

    def health(self) -> dict[str, Any]:
        return {
            **self.suggestion_service.health(),
            "integration": "trained-suggestion-adapter",
            "model_name": self.model.name,
            "model_version": self.model.version,
        }

    async def check_interactions(self, request: InteractionCheckRequest) -> InteractionCheckResponse:
        medicine_names = [medicine.display_name for medicine in request.medicines]
        predictions = await asyncio.to_thread(self._check_pairs, medicine_names)
        interactions = []
        warnings = [
            "Experimental source-backed guidance is not clinically validated and does not replace a qualified clinician or pharmacist.",
        ]

        for prediction in predictions:
            if prediction["status"] == "not_in_reference":
                warnings.append(
                    f"{prediction['drug_a']} and {prediction['drug_b']}: no local reference entry was found. This does not mean the combination is safe."
                )
                continue

            explanation_parts = [
                prediction.get("basis_label", ""),
                prediction.get("mechanism") or "",
            ]
            if prediction.get("questions"):
                explanation_parts.append("Discussion prompts: " + " | ".join(prediction["questions"]))
            interactions.append(
                InteractionResult(
                    medicine_a=prediction["drug_a"],
                    medicine_b=prediction["drug_b"],
                    severity=prediction["severity"],
                    summary=prediction["message"],
                    explanation="\n".join(part for part in explanation_parts if part),
                    evidence=[prediction["source_url"]] if prediction.get("source_url") else [],
                )
            )

        return InteractionCheckResponse(
            request_id=str(uuid4()),
            status="completed",
            model=self.model,
            interactions=interactions,
            warnings=warnings,
        )

    def _check_pairs(self, medicine_names: list[str]) -> list[dict[str, Any]]:
        return [
            self.suggestion_service.suggest(first_medicine, second_medicine)
            for first_medicine, second_medicine in combinations(medicine_names, 2)
        ]


def load_trained_suggestion_adapter() -> ModelAdapter:
    project_root = Path(__file__).resolve().parents[2]
    configured_path = os.environ.get("MEDSAFE_AI_INTEGRATION_DIR")
    integration_dir = Path(configured_path).expanduser() if configured_path else project_root.parent / "MedSafeAI_Integration"
    runtime_dir = integration_dir / "backend"

    try:
        if not (runtime_dir / "model_runtime.py").is_file():
            raise FileNotFoundError(f"Model runtime not found at {runtime_dir}.")
        if str(runtime_dir) not in sys.path:
            sys.path.insert(0, str(runtime_dir))
        from model_runtime import SuggestionService

        metadata = json.loads((runtime_dir / "models" / "metadata.json").read_text(encoding="utf-8"))
        return TrainedSuggestionAdapter(SuggestionService(app_dir=integration_dir), metadata)
    except Exception as error:
        return UnavailableModelAdapter(
            "The trained suggestion model could not load. Install backend/requirements.txt with Python 3.13 and verify "
            f"MEDSAFE_AI_INTEGRATION_DIR if needed. Cause: {error}"
        )
