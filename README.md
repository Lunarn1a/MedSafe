# MedSafe

MedSafe is a responsive static web prototype for medication list management, stock tracking, and local reference-catalog interaction lookup. It is not a diagnostic or prescribing tool.

## Start here

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains the source structure and local development.
- [`docs/AI_INTEGRATION_CONTRACT.md`](docs/AI_INTEGRATION_CONTRACT.md) defines the boundary for a future trained model or backend.
- [`docs/MOBILE_APP_PLAN.md`](docs/MOBILE_APP_PLAN.md) defines responsive-browser scope and validation.
- [`docs/MOBILE_VIEW_IMPLEMENTATION.md`](docs/MOBILE_VIEW_IMPLEMENTATION.md) is the implementation checklist for mobile HTML and CSS work.
- [`backend/README.md`](backend/README.md) explains the Python 3.12/3.13 AI-service scaffold.
- [`docs/OPEN_AND_INSTALL.md`](docs/OPEN_AND_INSTALL.md) explains how to open the website and install it on iOS or Android.
- [`AGENTS.md`](AGENTS.md) and [`docs/UI_VISUAL_IMPROVEMENT_GUIDE.md`](docs/UI_VISUAL_IMPROVEMENT_GUIDE.md) define how AI agents should improve visual UI without changing the app structure.

## Run and test

```bash
python3 -m http.server 8000
npm run check
npm test
```

Open `http://localhost:8000` after starting the local server. There are no package dependencies to install.

## Contributions

- Keep `assets/js/data/medicine-catalog.js` as the only checked-in medicine dataset.
- Keep service logic separate from UI code and add Node tests for service behavior.
- Do not add API keys, model files, patient identifiers, or secrets to frontend code.
- Do not present an absent local reference match or model result as proof that a medication combination is safe.
- Verify desktop and responsive browser behavior before submitting changes.
