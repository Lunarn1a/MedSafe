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
Each copy runs its own complete website and trained model. Signup, login, and saved patient records use the shared Supabase project and require internet. Signing in to the same account on another computer loads its saved records. Groupmates do not need database administrator access to use the app.

For a shared link with no installations for visitors, the Python backend and frontend must be hosted online. This setup runs the project in each member's workspace and does not publish a website.

## Run on Windows

Clone or pull the complete GitHub repository, then double-click **Start-MedSafe.cmd**. Keep the terminal open and visit **http://127.0.0.1:8000/**.

From the repository folder, run this in a PowerShell terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\MedSafe\backend\start.ps1
```

Open **http://127.0.0.1:8000/**. Keep the terminal open; press Ctrl+C to stop. To use another port, append `-Port 8001` to the command.

The launcher creates an isolated `backend/.venv` using Python 3.13 or 3.12 and installs the exported requirements. Python 3.14 is not supported by these pinned dependencies. The virtual environment is ignored by Git; no global packages are changed. All paths are resolved relative to the project, so the project folder can be anywhere. If you move an already-configured copy, recreate only its `.venv`.

## Run on macOS or Linux

Install Python 3.13 or 3.12, open a terminal in the cloned project folder, and run:

```sh
python3.13 run.py
```

Use `python3.12 run.py` if that is your installed version. Linux distributions may also require their matching Python `venv` package. Open the same local address. To check setup without running the website, append `--check`; to change ports, append `--port 8001`. The launcher supports these platforms; the browser and model integration were tested on Windows.

Use the launcher rather than opening `index.html` directly: accounts and model inference require the local server. Records from the previous browser-only demo are left untouched in browser storage, but are not automatically imported into an authenticated account. Enter the records you want to keep after signing up.

## Accounts and shared records

The database administrator runs `MedSafe/supabase/setup.sql` **once** and completes the email and redirect setup in `MedSafe/supabase/README.md`. Do not rerun a successful setup. The checked-in `MedSafe/supabase-config.js` contains the public project URL and publishable key, never an administrator secret. The Supabase JavaScript client is bundled locally; groupmates do not need Node.js or an extra CDN download.

1. Choose **Create an account**, enter your name, choose Patient or Caregiver, and use a password of at least 10 characters. Confirm your email, then sign in. Your saved account determines your role; it cannot be switched at login.
2. Patients add medicines under **My Medicines**. Successful changes are saved in Supabase. **Refresh records** loads changes from another device; the dashboard also refreshes every minute while visible and no record dialog is open.
3. A caregiver copies their code from **Patients**. A patient pastes it into **Caregiver access** and grants access. Access is view only unless the patient enables editing. Both accounts must have completed their first sign-in.
4. A patient can remove access at any time. The caregiver loses database access immediately and the displayed list clears on its next successful refresh. Data already viewed or copied cannot be remotely erased.
5. **Forgot password?** sends a reset link. Open it in the same browser that requested it, with MedSafe running, and choose a new password.
6. Click your name, then **Edit profile** to change your display name or optional date of birth. Changes are saved to your own profile and appear on other devices after refresh. Email and account type are shown for reference and cannot be changed in this form.

Supabase enforces each user's access through database policies. The browser never writes medicine records to its old local cache. The login session is saved in this browser until sign-out or session expiry. Sign out on shared computers. Email confirmation and reset delivery require the project's email configuration; adding code to GitHub does not configure those settings.

This addition does not implement reminders, stock-change history, or clinician validation of the interaction content. It is still a classroom prototype.

## Source-backed explanations and questions

1. The browser checks the selected medicines against the existing interaction reference.
2. It sends only the two medicine names to `POST /api/guidance`.
3. The server retrieves the matching saved DDInter explanation. For uncached pairs with an eligible detail link, it fetches that exact public page with a short timeout and checks both source drug IDs before caching it. No patient profile, account, or medicine list is sent to DDInter; the outgoing URL contains the public interaction record ID.
4. Where available, an AI-assisted plain-language summary explains what could happen and why. Summaries are matched to the exact source-text hash and preserve conditions such as high doses, route, and limited evidence. There are 25 distinct summary texts, reused only for identical source explanations. Many source records do not yet have a plain-language summary; the UI says so explicitly.
5. The app displays questions about topics mentioned in that pair's source record, such as blood sugar, heartbeat, kidney health, or timing. These are **rule-based question templates**, not generated medical advice. Source excerpts remain available beside each question. Keyword matching can identify background conditions or alternative treatments too; a topic mention does not establish that the pair causes a problem.
6. A separate trained classifier can highlight source-mentioned topics for demonstration. Its predictions cannot create unsupported questions, remove existing questions, change severity, or determine treatment. Highlights are **off by default** because this experiment did not beat its keyword baseline. Open **About the training experiment** to enable them.

The source snapshot is `backend/data/source_details.json`; `/api/health` reports the currently loaded `source_detail_pairs`. This is a partial saved reference, not a claim that every possible pair has a detailed explanation. Uncached eligible records can be loaded on demand. Disputed records, absent detail links, failed identity checks, and source outages produce an explicit **General questions only** fallback. Missing interaction pairs are never called safe. No unseen source statement is replaced with a guessed explanation.

The bundled snapshot has **3,076 source records**, including **1,040 pairs matched to a plain-language summary**. Another **4,453 pairs have eligible source links** for on-demand retrieval; **16 pairs have withheld or missing detail links**. These counts describe saved source coverage, not trained examples or clinical validation. `training/results/source_coverage.json` records the snapshot hash and counts; rerun `training/audit_source_coverage.py` after extending the snapshot.

Source excerpts use original professional wording and may be technical. Only the optional excerpt panels show that wording. Both source extraction and the simplified summaries need independent clinical review. The app does not automatically choose doses, stop medicines, or schedule them.

### What was actually trained

The new **TF-IDF + one-vs-rest logistic regression** model predicts 15 discussion-topic labels from factual interaction descriptions and the reference severity. Management text, target labels, and source URLs are excluded from model inputs. Labels were generated from topics in management text and advice sentences using documented rules (weak supervision), not clinician annotation. Medicine names may occur in the natural source descriptions; this is not a drug-identity-free experiment.

The frozen dataset has **886 examples in 259 similar-text groups**, split into **581 train / 120 validation / 185 test** rows. Near-duplicate mechanisms stay in one partition. Validation selected C=1 from 0.1, 1, and 10. The vocabulary and classifier were fitted on training rows only. Magnesium lacked sufficient training support and remains outside the model, although source-based magnesium questions can still appear.

| New topic experiment: held-out comparison | Macro F1 |
| --- | ---: |
| Trained topic classifier | 0.105 |
| Keyword baseline on mechanism text | 0.369 |
| Majority baseline | 0.000 |

These scores measure agreement with automatic labels, **not medical accuracy**. Macro F1 includes all 15 trained topics; three have no positive test examples and score zero. This is the same reference source used earlier, not an independent external evaluation. The result is weak and is reported without tuning on the test set. A credible next training iteration requires independently reviewed labels and a fresh frozen evaluation, not just more duplicated rows.

The new export was trained locally. To reproduce it in your own Google Colab session, open **`MedSafe/training/MedSafe_Source_Guidance_Training.ipynb`** and upload the three files it lists. It downloads five separate files, without a ZIP. Do not replace the original model with this experiment.

### Original classifiers retained as baselines and fallback

`POST /api/suggestions` preserves the original API. It predicts the review, monitoring, and timing categories that select fixed general questions. This API remains available for parity checks and the detailed-source fallback.

All **7,545 documented pairs**, involving all **1,242 listed medicines**, now receive model-selected discussion questions:

| Input available | Pairs | Classifier |
| --- | ---: | --- |
| Detailed mechanism description | 300 | Original Colab TF-IDF model, unchanged |
| Broad source mechanism classifications | 7,229 | Additional trained categorical-feature model |
| Missing or conflicting classifications | 16 | Additional trained severity-only model, explicitly labeled limited information |

These baseline models do not generate treatment instructions or determine severity. The 7,545 reference records are **not 7,545 labeled training examples**. Each baseline classifier was fitted on the original 192 training rows, with 48 validation and 60 test rows. Model output is not used as a training label. There are 770,661 possible unordered pairs among the 1,242 names; only 7,545 have reference records. Baseline predictions work offline; fetching missing source details requires internet.

Use these pairs to compare the new information: **Calcium carbonate + Dolutegravir** (uptake and timing), **Glimepiride + Ofloxacin** (blood sugar), **Loperamide + Quinidine** (heartbeat, dose qualification), **Iopamidol + Metformin** (scan/procedure and kidney context), and **Esomeprazole + Tacrolimus** (medicine levels and magnesium). These are software demonstrations, not clinical test cases or independent performance tests.

Use **Calcium citrate + Dolutegravir** to test the newly expanded coverage. Use **Magaldrate + Ursodeoxycholic acid** to see the limited-input disclosure.

## Files

```text
MedSafe/
  index.html                     Full-page interface with embedded responsive styles
  drugs-data.js                  Existing browser reference
  drugs.json                     Existing server reference
  model-suggestions.js           Model question panel and request handling
  accounts.js                    Supabase authentication and permitted record changes
  supabase-config.js             Public project connection details
  supabase/                      One-time SQL, setup instructions, and account tests
  vendor/                        Pinned Supabase browser client and license
  backend/
    server.py                    Local web server and JSON endpoints
    model_runtime.py             Validated catalog and model inference
    feature_schema.py            Shared categorical feature definitions
    suggestion_copy.py           Plain-language questions and information notices
    pair_guidance.py             Source retrieval, integrity checks, and optional highlights
    source_reader.py             Restricted public-source reader and drug-ID checks
    source_topics.py             Auditable topic annotation and question templates
    start.ps1                    Windows launcher
    requirements.txt             Unchanged Colab-exported versions
    models/
      medsafe_suggestions.joblib Unchanged trained Colab export
      metadata.json              Unchanged export metadata
      coverage_suggestions.joblib Additional categorical and severity-only models
      coverage_metadata.json     Input hashes, training split, and model settings
      source_topic_selector.joblib Experimental fine-grained topic classifier
      source_topic_metadata.json Frozen dataset hash and training metadata
    data/
      medsafe_suggestions_300.csv Exact CSV matched to export checksum
      reference_catalog.json    Label-free features for all 7,545 pairs
      source_details.json       Saved source explanations, dates, IDs, and hashes
      plain_source_summaries.json Exact-source plain-language paraphrases
      SOURCE.md                 Source attribution and classification caveats
    tests/test_integration.py    Export parity and API checks
    tests/test_source_guidance.py Source boundaries, fallback, and topic export checks
  training/
    annotation_notes.md          Dataset provenance and limitations
    train_coverage_model.py       Reproducible coverage-model training
    MedSafe_Coverage_Training.ipynb Colab workflow for the additional models
    MedSafe_Source_Guidance_Training.ipynb Colab workflow for the new topic experiment
    source_topic_examples.json   Frozen 886-row training/validation/test dataset
    train_source_topics.py       Reproducible topic training and baseline comparisons
    collect_source_details.py    Resume collection of missing eligible source records
    results/                     Original and additional model evaluations
```

Open `http://localhost:8000` after starting the local server. There are no package dependencies to install.

## Contributions

- Keep `assets/js/data/medicine-catalog.js` as the only checked-in medicine dataset.
- Keep service logic separate from UI code and add Node tests for service behavior.
- Do not add API keys, model files, patient identifiers, or secrets to frontend code.
- Do not present an absent local reference match or model result as proof that a medication combination is safe.
- Verify desktop and responsive browser behavior before submitting changes.
