from __future__ import annotations

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from .model_adapter import ModelAdapter, ModelNotConfiguredError, load_trained_suggestion_adapter
from .schemas import InteractionCheckRequest, InteractionCheckResponse

app = FastAPI(title="MedSafe AI Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=False,
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)

model_adapter: ModelAdapter = load_trained_suggestion_adapter()


@app.get("/health")
async def health() -> dict:
    return model_adapter.health()


@app.post(
    "/api/v1/interactions/check",
    response_model=InteractionCheckResponse,
    responses={503: {"description": "Model unavailable"}},
)
async def check_interactions(request: InteractionCheckRequest) -> InteractionCheckResponse:
    try:
        return await model_adapter.check_interactions(request)
    except ModelNotConfiguredError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
