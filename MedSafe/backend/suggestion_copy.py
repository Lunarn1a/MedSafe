"""Plain-language display text, kept separate from trained model artifacts."""

GENERAL_QUESTION = "Talk to your doctor or pharmacist about taking these medicines together."
QUESTION_TEMPLATES = {
    "label_review": "Ask your doctor or pharmacist to check whether you should take these medicines together.",
    "label_monitoring": "Ask your doctor or pharmacist what changes to watch for and whether you need extra checkups or tests.",
    "label_timing": "Ask your pharmacist when to take each medicine and whether you need to leave time between them.",
}
MODEL_NOTE = "These questions are chosen by a model that is still being tested. A doctor or pharmacist should check which ones apply to you."
LIMITED_NOTE = "These questions use limited information and may miss something important. Ask your doctor or pharmacist to check this medicine pair."
MISSING_REFERENCE_NOTE = "MedSafe does not have information about this medicine pair. That does not mean it is safe to take them together. Ask your doctor or pharmacist."


def basis_text(basis, classification_status):
    if basis == "detailed_mechanism":
        return "These questions use information about this medicine pair."
    if basis == "mechanism_classification":
        return "These questions use general information about how the medicines affect each other. Details about this pair are limited."
    reason = ("The sources disagree about how these medicines affect each other."
              if classification_status == "conflicting"
              else "We do not have details about how these medicines affect each other.")
    return f"These questions use only the listed risk level. {reason}"
