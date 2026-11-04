"""Source-grounded discussion topics; rules annotate evidence, not medical advice.

The new classifier learns management-topic labels from mechanism text. At display
time it may highlight only topics with evidence in the selected source record.
"""
import re

# Questions ask a professional to interpret the source; they never prescribe a
# dose, a stop/start decision, or a treatment schedule.
TOPICS = {
    "blood_sugar": ("Blood sugar", r"\b(?:blood glucose|blood sugar|hypoglyc\w*|hyperglyc\w*|glycemic)\b", "Could {pair} change my blood sugar? Should I check it more often?"),
    "bleeding": ("Bleeding or stomach injury", r"\b(?:bleeding|hemorrhag\w*|haemorrhag\w*|gastrointestinal injury|GI injury|ulceration)\b", "Could {pair} cause bleeding or stomach injury? Which warning signs should I watch for?"),
    "heart_rhythm": ("Heartbeat", r"\b(?:QT(?:c)?(?: interval)?|arrhythmi\w*|torsade\w*|heart rhythm|electrocardiogra\w*|ECG)\b", "Could {pair} affect my heartbeat? Do I need a heart check?"),
    "blood_pressure": ("Blood pressure", r"\b(?:blood pressure|hypotensi\w*|hypertensi\w*)\b", "Could {pair} change my blood pressure? How should it be checked?"),
    "kidneys": ("Kidney checks", r"\b(?:renal (?:function|impairment|failure|disease)|kidney|nephrotoxic\w*)\b", "Does my kidney health affect whether I can take {pair}? Do I need kidney blood tests?"),
    "potassium": ("Potassium in the blood", r"\b(?:serum potassium|potassium levels?|hypokal\w*|hyperkal\w*)\b", "Could {pair} change my potassium level, a mineral in the blood? Should it be checked?"),
    "magnesium": ("Magnesium in the blood", r"\b(?:serum magnesium|magnesium levels?|hypomagnes\w*|hypermagnes\w*)\b", "Could {pair} change my magnesium level, a mineral in the blood? Should it be checked?"),
    "drowsiness": ("Sleepiness or dizziness", r"\b(?:sedation|sedative|drows\w*|CNS (?:effects|depression)|central nervous system depression|mental alertness)\b", "Could {pair} make me unusually sleepy or dizzy? Are there activities I should avoid?"),
    "breathing": ("Breathing", r"\b(?:respiratory depression|breathing difficulties|respiratory function|respiratory distress)\b", "Could {pair} affect my breathing? What symptoms need urgent help?"),
    "seizures": ("Seizures", r"\b(?:seizures?|convulsions?|seizure threshold)\b", "Could {pair} affect my risk of a seizure? Does my medical history change the advice?"),
    "infection": ("Infection and immune health", r"\b(?:infections?|immunosuppress\w*|live vaccin\w*)\b", "Does an infection or treatment that affects my immune system change the advice for {pair}?"),
    "movement": ("Unusual movements or stiffness", r"\b(?:extrapyramidal|dystoni\w*|tardive dyskinesia|akathisia|Parkinson-like)\b", "Could {pair} cause unusual movements, muscle spasms, or stiffness? What should I do if these happen?"),
    "muscle_injury": ("Muscle pain or weakness", r"\b(?:myopathy|rhabdomyolysis|muscle (?:pain|weakness|tenderness))\b", "Could {pair} cause muscle pain or weakness? Which changes should I report?"),
    "medicine_levels": ("Amount of medicine in the blood", r"\b(?:(?:blood|serum|plasma|drug) (?:concentrations?|levels?)|therapeutic drug monitoring)\b", "Could {pair} change the amount of medicine in my blood? Is a medicine-level blood test needed?"),
    "timing": ("When to take each medicine", r"\b(?:hours?.{0,50}(?:before|after|apart)|(?:before|after|apart).{0,50}hours?|separat\w*.{0,45}(?:doses?|dosing|administration)|(?:dose|dosing) interval)\b", "What timing instructions apply to {pair}? Do food, dose, or the exact medicine product change those instructions?"),
    "procedure": ("A scan or procedure", r"\b(?:radiographic|radiocontrast|contrast (?:media|material)|iodinated|procedure)\b", "If I need a scan or procedure, how should my care team manage {pair} and any kidney checks?"),
}
PATTERNS = {key: re.compile(value[1], re.I) for key, value in TOPICS.items()}
ADVICE = re.compile(r"\b(?:should|recommend\w*|advis\w*|monitor\w*|avoid\w*|contraindicat\w*|consider\w*|caution|dosage adjustment|dose adjustment)\b", re.I)
PREFIX = re.compile(r"^(?:(?:GENERALLY AVOID|MONITOR(?: CLOSELY)?|ADJUST (?:DOSAGE|DOSING INTERVAL)|CONTRAINDICATED|INTERVAL|MANAGEMENT)\s*:\s*)+", re.I)
NEGATIVE = re.compile(r"\b(?:no (?:significant |clinically significant )?(?:effect|change|interaction)|not (?:associated|observed)|does not (?:affect|increase|decrease))\b", re.I)


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", text) if s.strip()]


def evidence_topics(text):
    matches = {}
    for sentence in sentences(PREFIX.sub("", text)):
        # Keep the complete sentence so conditions such as 'after stopping' or
        # 'high doses' stay visible in the original-source evidence.
        if NEGATIVE.search(sentence):
            continue
        for topic, pattern in PATTERNS.items():
            if topic not in matches and pattern.search(sentence):
                matches[topic] = sentence
    return matches


def model_input(record):
    # Management instructions and action-prefixed sentences do not enter X.
    facts = " ".join(s for s in sentences(PREFIX.sub("", record["interaction"])) if not ADVICE.search(s))
    return f"severity_{record['severity'].lower()} {facts}"


def training_labels(record):
    guidance = record["management"] if record["management"] not in ("", "-") else ""
    guidance += " " + " ".join(s for s in sentences(record["interaction"]) if ADVICE.search(s))
    return evidence_topics(guidance)


def source_questions(record):
    supported = evidence_topics(record["interaction"])
    if record["management"] not in ("", "-"):
        for topic, excerpt in evidence_topics(record["management"]).items():
            supported.setdefault(topic, excerpt)
    pair = f"{record['drug_a']} and {record['drug_b']}"
    return [{"topic_id": topic, "title": TOPICS[topic][0], "question": TOPICS[topic][2].format(pair=pair),
             "source_excerpt": excerpt, "model_selected": False} for topic, excerpt in supported.items()]
