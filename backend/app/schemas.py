from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class MedicineInput(BaseModel):
    medicine_id: Optional[str] = Field(default=None, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    active_ingredients: list[str] = Field(default_factory=list, max_length=25)


class InteractionCheckRequest(BaseModel):
    medicines: list[MedicineInput] = Field(min_length=2, max_length=50)


class ModelMetadata(BaseModel):
    name: str
    version: str


class InteractionResult(BaseModel):
    medicine_a: str
    medicine_b: str
    severity: str
    summary: str
    explanation: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    evidence: list[str] = Field(default_factory=list)


class InteractionCheckResponse(BaseModel):
    request_id: str
    status: Literal["completed"]
    model: ModelMetadata
    interactions: list[InteractionResult]
    warnings: list[str] = Field(default_factory=list)
