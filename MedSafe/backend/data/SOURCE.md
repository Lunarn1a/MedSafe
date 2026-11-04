# Reference catalog for expanded suggestion coverage

`reference_catalog.json` contains feature records for all 7,545 pairs in the existing `drugs.json`. All 1,242 listed medicine names appear in at least one pair. It contains no suggestion labels, management instructions, or patient records.

Source: **DDInter 2.0**, Computational Biology & Drug Design Group. Public drug interaction tables retrieved during dataset preparation on 2026-10-30 provide record identifiers, source drug identifiers, severity, and seven mechanism classifications: absorption, distribution, metabolism, excretion, synergistic effects, antagonistic effects, and others. The normalized source-index hash is retained in the catalog, and each record retains its individual source observations and detail URLs. Public category downloads support the existing pair/severity mapping: https://ddinter2.scbdd.com/download/ .

The prior cache covered 7,542 pairs. The Cyclosporine / Ursodeoxycholic acid absorption classification was additionally verified from https://ddinter2.scbdd.com/server/interact/77303/ . The remaining two Ursodeoxycholic acid pairs retain their existing severity and link to the public category-A download, but have **no asserted mechanism classification**. No classification was invented or inferred from the other medicine's class.

Duplicate source observations agree for most pairs. For 18 pairs, source records disagree about the mechanism classification. Their observations are retained for audit; no majority vote, arbitrary record selection, or union is passed to the categorical model. In the complete catalog, 7,525 pairs have available classifications, 18 have conflicting classifications, and 2 have missing classifications.

At runtime, the original 300 detailed source summaries take precedence, including four pairs whose broader table classifications disagree. This produces 300 detailed-input predictions, 7,229 classification-input predictions, and 16 severity-only predictions. Limited-input output is explicitly disclosed in the interface. Broad source classifications are not detailed mechanism descriptions and have not received independent clinical review here.

The original 300-row labeled CSV, its SHA-256 checksum, original Colab model, and original evaluation are preserved. Additional coverage classifiers use that same labeled subset and existing group split; the reference catalog adds **inputs**, not training labels. Only training rows are fitted; validation selects regularization; test results are reported separately. Model predictions are never recycled as ground-truth labels.

The additional classifiers were trained locally with a reproducible script and supplied Colab notebook. Their evaluated test subset is not independent of previous project analysis, and no independently labeled evaluation exists for the additional 7,245 pairs.

## Detailed source guidance (2026-10-31)

`source_details.json` stores original Interaction and Management text from individual DDInter detail pages, along with their source URLs, retrieval dates, source drug IDs, and text hashes. Retrieval checks the two IDs against the reference observations. This is an identity/integrity check, **not clinical verification**, and it does not revalidate the old severity mapping. The saved snapshot is partial; eligible missing pages are fetched on demand. Sources with conflicting classifications are withheld unless an existing original detailed record already selected a source. A known quinine/quinidine narrative mismatch is rejected. Other source errors may remain.

`plain_source_summaries.json` contains 25 AI-assisted paraphrases of exact source explanations. They are keyed by SHA-256 of the explanation so revised or different source text cannot silently inherit a paraphrase. Reused source paragraphs can share a summary. Conditions such as high doses, solid formulations, injection routes, laboratory-only evidence, and uncertain significance are retained. No independent clinician review has been performed. Unmatched records explicitly disclose that a simplified explanation is unavailable.

`training/source_topic_examples.json` freezes 886 source-derived examples collected during this expansion. Text rules in `source_topics.py` identify management topics and retain their source evidence. These are weak labels, not expert judgments, and keyword presence can refer to a background condition, another medicine, or a qualified risk. Features exclude management text and advice sentences. Similar normalized mechanism text is grouped before splitting; this reduces but cannot eliminate leakage across related source families.

The learned classifier is separate from retrieval and from the rule-based question templates. It fits 581 training examples, uses 120 validation examples for model selection, and reports results on 185 held-out examples. Its 0.105 macro F1 is below the keyword comparator's 0.369; optional model highlights are disabled initially. No generated or predicted clinical advice is used as a training target. These source-derived assets retain the DDInter attribution and license below.

## Attribution and license

DDInter data is provided under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**: https://ddinter2.scbdd.com/terms/ . Retain attribution and the applicable noncommercial/share-alike terms when sharing this source-derived catalog. No claim is made that missing reference pairs are safe or that these experimental questions are clinically validated.
