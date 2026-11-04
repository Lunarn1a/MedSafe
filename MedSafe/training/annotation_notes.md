# MedSafe suggestion training subset

Prepared on 2026-10-30 from the supplied MedSafe seed CSV and public DDInter 2.0 records.

## What is included

- Exactly 300 unique medicine pairs from the supplied file.
- Major: 87. Moderate: 154. Minor: 59.
- 95 mechanism/source groups and 102 original mechanism summaries.
- Positive labels: review 223, monitoring 211, timing 41. Categories overlap.
- An individual DDInter detail-page URL, release/access date, record identifier, and short evidence snippets accompany each row.

## Annotation status and definitions

These are AI-assisted, source-derived research annotations (silver labels), not independently clinician-labeled ground truth. The reviewer is identified as OpenAI Codex. No pharmacist or other clinician reviewed this dataset. The extra clinician_reviewed column is 0 for every row.

The existing notebook uses reviewed=1 to admit completed records. In this file that means the AI source check and annotation are complete. It does not mean a second teammate, instructor, or clinician independently verified the record. Keep this distinction in your project report.

- label_review=1: source management supports clinician reassessment of coadministration or a treatment change. Some recommendations apply only if specified symptoms or clinical conditions occur.
- label_monitoring=1: source management supports additional observation, response checks, or laboratory assessment.
- label_timing=1: the source supports discussing dose spacing or treatment timing for the named pair, subject to reference conditions.
- 0 means the action was not identified as applicable within this annotation scope. It does not indicate a safe medicine combination.

Mechanism summaries describe the interaction without embedding management commands. Management summaries and label_evidence are for audit and targets; do not use them as classifier inputs. The model inputs remain severity and mechanism only.

## Preparation and source checks

The public category CSVs were used to map drug identifiers. Public interaction tables provided record URLs and mechanism classifications. Detail-page identifiers and reference severity were matched to the supplied pairs. Candidate selection covered different severity/mechanism strata and deliberately sought varied guidance; the final sample is not prevalence representative.

Labels were initialized from explicit management language and corrected through AI source reading. Corrections included missed dose-titration and laboratory advice, conditional wording, and separation of source advice from mechanism facts. Instructions applying only to alternative medicines were not transferred to the named pair. Ambiguous vaccine management, selected PPI timing contexts, a quinine/quinidine narrative inconsistency, and mismatched identifiers were excluded rather than silently repaired.

Repeated or closely similar source mechanisms share group IDs. Equivalent salicylate/steroid descriptions and related topical/ophthalmic steroid descriptions were also grouped together. Grouping is a leakage precaution, not a claim that all records in a group have identical clinical management.

Only general category summaries are included. Exact drug-specific instructions and patient-specific applicability must be read in the linked source. Some source recommendations are theoretical, conditional, route dependent, formulation dependent, or supported by limited evidence. AI source fidelity checks do not establish that the source itself is error free.

## Continue in Colab

1. Run notebook Step 1 for imports.
2. Skip seed export and manual annotation (Steps 2-3).
3. Run Step 4 and upload only medsafe_suggestions_300.csv.
4. Continue through Steps 5-9 for splitting, training, evaluation, demonstration, and export.
5. Keep this CSV and these notes with your experiment. Do not describe the labels as independently clinician reviewed or the model as trained on all 7,545 pairs.

## Split compatibility check

The fixed group split used in the supplied notebook was checked without fitting a model or selecting based on model scores:

| Split | Records | Groups | Review positives | Monitoring positives | Timing positives |
|---|---:|---:|---:|---:|---:|
| train | 192 | 66 | 153 | 136 | 29 |
| validation | 48 | 14 | 24 | 35 | 2 |
| test | 60 | 15 | 46 | 40 | 10 |

Every label has positive and negative examples in each split. Group sizes produce uneven row proportions. The validation set contains only two timing-positive records, so timing-related model selection remains particularly uncertain. Model performance has not been measured during dataset preparation. Report label counts and error examples alongside F1.

## Source attribution

DDInter 2.0, Computational Biology & Drug Design Group. Individual record URLs are in source_url. Documentation: https://ddinter2.scbdd.com/tutorials/ . Data terms: https://ddinter2.scbdd.com/terms/ . DDInter states that its data is provided under CC BY-NC-SA 4.0. Retain attribution and applicable noncommercial/share-alike terms when sharing this source-derived dataset.

The original user CSV was preserved. No patient records were needed. No model was trained as part of preparing this file.
