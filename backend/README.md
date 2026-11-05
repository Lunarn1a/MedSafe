# MedSafe AI service

This is a FastAPI boundary for the supplied experimental MedSafe guidance model. The exported model records **Python 3.13.18**, so use Python 3.13 with the pinned packages in `requirements.txt`. It does not generate interaction severity or prove that a medicine combination is safe.

## Setup

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

The service automatically loads `../MedSafeAI_Integration/backend/model_runtime.py`. Set `MEDSAFE_AI_INTEGRATION_DIR` only if that folder is relocated. Check the interpreter with `python3 --version`.

The browser client should then be configured with `http://localhost:8001/api/v1/interactions/check` only after a model adapter and contract review are complete.

## Model behavior

`app/model_adapter.py` loads the supplied `SuggestionService` and evaluates every selected medicine pair. It returns the model's experimental, source-backed discussion guidance and source URL when available. Pairs absent from the reference catalog produce a warning, never a “safe” result. If pinned dependencies or model files are unavailable, `/health` reports `model-unavailable` and `/api/v1/interactions/check` returns `503`.

The frontend is unchanged. Do not place model files, API keys, or clinical decision logic in browser code.

## Test

```bash
pytest
```
