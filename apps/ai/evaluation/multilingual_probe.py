"""Smoke test of the embedding model on occupation paraphrases in English, Amharic and Afaan Oromo.

PURPOSE: the project brief says not to assume a model supports every Ethiopian language equally, so this
measures it. For each language there are 16 occupations, each written two different ways (A and B). A good
model puts the two wordings of the same occupation close together and different occupations far apart.

LIMITS (read before quoting the numbers):
  * 16 occupations x 2 wordings is a SMALL probe, not a benchmark. Differences of a few points are noise.
  * The Amharic and Afaan Oromo phrases were written by the developer's assistant and have NOT been reviewed by
    native speakers. Some wording may be unnatural or wrong, which would lower that language's score for reasons
    that are not the model's fault. Treat low Afaan Oromo / Amharic numbers as "needs a native-reviewed test
    set", not as a verdict on the model.
  * It also prints cosine statistics for job-like vs worker-like texts, used to choose the calibration bounds in
    apps/api/src/modules/matching/components.ts (SEMANTIC_LOW / SEMANTIC_HIGH).

Usage:  .venv\\Scripts\\python evaluation\\multilingual_probe.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# (english A, english B), (amharic A, amharic B), (afaan oromo A, afaan oromo B)
OCCUPATIONS = [
    (("Vehicle repair specialist", "Automotive maintenance technician"), ("የተሽከርካሪ ጥገና ባለሙያ", "የመኪና ሜካኒክ ቴክኒሺያን"), ("Ogeessa suphaa konkolaataa", "Teekiniishiyaanii suphaa makiinaa")),
    (("House painter", "Wall painting and decorating worker"), ("የቤት ቀለም ቀቢ", "የግድግዳ ቀለም ሠራተኛ"), ("Hojjetaa dibaa manaa", "Hojjetaa dibaa dallaa")),
    (("Primary school teacher", "Elementary education instructor"), ("የአንደኛ ደረጃ ትምህርት ቤት መምህር", "የመጀመሪያ ደረጃ አስተማሪ"), ("Barsiisaa mana barumsaa sadarkaa duraa", "Barsiisaa barnoota sadarkaa tokkoffaa")),
    (("Hotel receptionist", "Front desk clerk at a hotel"), ("የሆቴል ተቀባይ", "የሆቴል የፊት ጠረጴዛ ሠራተኛ"), ("Simattuu hoteelaa", "Hojjetaa gabaajee fuulduraa hoteelaa")),
    (("Bricklayer", "Mason who builds block walls"), ("ግንበኛ", "የብሎኬት ግድግዳ የሚገነባ ሠራተኛ"), ("Ijaaraa dhagaa", "Hojjetaa dallaa bilookii ijaaru")),
    (("Nurse", "Hospital patient care nurse"), ("ነርስ", "በሆስፒታል ታካሚዎችን የምትንከባከብ ነርስ"), ("Narsii", "Narsii dhukkubsatoota hospitaala keessatti kunuunsu")),
    (("Truck driver", "Heavy goods vehicle driver"), ("የጭነት መኪና ሾፌር", "ከባድ ተሽከርካሪ አሽከርካሪ"), ("Konkolaachisaa fe'umsaa", "Konkolaachisaa konkolaataa ulfaataa")),
    (("Accountant", "Bookkeeper and financial records clerk"), ("አካውንታንት", "የሂሳብ መዝገብ ያዥ"), ("Herregaa qabaa", "Qabaa herregaa fi galmeewwan maallaqaa")),
    (("Farm laborer", "Agricultural crop worker"), ("የእርሻ ሠራተኛ", "የሰብል እርሻ ሠራተኛ"), ("Hojjetaa qonnaa", "Hojjetaa midhaan qonnaa")),
    (("Security guard", "Night watchman"), ("የጥበቃ ሠራተኛ", "የሌሊት ጥበቃ"), ("Eegduu", "Eegduu halkanii")),
    (("Web developer", "Website programmer"), ("የድር ጣቢያ ገንቢ", "የዌብሳይት ፕሮግራመር"), ("Misooma marsariitii", "Pirogiraamarii marsariitii")),
    (("Tailor", "Garment sewing worker"), ("ልብስ ስፌት ባለሙያ", "የልብስ ሰፊ"), ("Hojjetaa huccuu tolchu", "Hojjetaa huccuu dhaaba")),
    (("Cook", "Restaurant kitchen chef"), ("ምግብ ሰሪ", "የሬስቶራንት ማብሰያ ሼፍ"), ("Kuka", "Kuka mana nyaataa")),
    (("Electrician", "Electrical wiring technician"), ("የኤሌክትሪክ ባለሙያ", "የኤሌክትሪክ ሽቦ ቴክኒሺያን"), ("Ogeessa elektirikii", "Teekiniishiyaanii wayyaara elektirikii")),
    (("Waiter", "Restaurant table server"), ("አስተናጋጅ", "የምግብ ቤት አስተናጋጅ"), ("Tajaajiltuu nyaataa", "Tajaajiltuu mana nyaataa")),
    (("Plumber", "Water pipe fitting technician"), ("የውሃ ቧንቧ ሠራተኛ", "የውሃ ቱቦ ቴክኒሺያን"), ("Ogeessa tuuboo bishaanii", "Teekiniishiyaanii tuuboo bishaanii")),
]
LANGS = {"English": 0, "Amharic": 1, "Afaan Oromo": 2}

# Job-like and worker-like texts in the same format the API sends, with a human relevance label (1 = clearly a fit).
JOBS = {
    "mech": "Minibus mechanic. Skills: Engine Repair, Brake Systems. Repair minibuses and trucks at our garage; diagnose engine and brake faults.",
    "cook": "Restaurant cook. Skills: Cooking, Traditional Ethiopian Cooking. Prepare injera and stews for a busy restaurant in Hawassa.",
    "web": "Web developer. Skills: Web Development, JavaScript. Build and maintain websites for small businesses in Addis Ababa.",
    "nurse": "Staff nurse. Skills: Nursing, First Aid. Care for patients on the ward of a regional hospital.",
    "guard": "Security guard. Skills: Security Guard Duty, Access Control. Night shift at a factory gate.",
    "teacher": "Primary school teacher. Skills: Primary School Teaching. Teach grades 1 to 4 and prepare lesson plans.",
}
WORKERS = {
    "mech": [("Vehicle repair specialist. Skills: Engine Repair. Ten years fixing trucks and buses.", 1),
             ("Automotive maintenance technician. Brake and engine servicing for taxis.", 1)],
    "cook": [("Kitchen chef. Skills: Cooking. I prepare Ethiopian dishes for hotels.", 1),
             ("Injera baker and home cook with restaurant experience.", 1)],
    "web": [("Website programmer. Skills: JavaScript. Builds online shops and company sites.", 1),
            ("Frontend software engineer working with React.", 1)],
    "nurse": [("Hospital nurse. Skills: Nursing. Four years on a surgical ward.", 1),
              ("Midwife and patient care assistant.", 1)],
    "guard": [("Night watchman. Skills: Security Guard Duty. Ten years guarding warehouses.", 1)],
    "teacher": [("Elementary school instructor. Skills: Primary School Teaching.", 1)],
}


def main() -> None:
    import os
    os.environ.setdefault("AI_SERVICE_TOKEN", "probe-only-token-not-a-secret-000")  # the probe never starts the server
    from app.config import load_settings
    from app.embeddings import CachedEmbedder, SentenceTransformerBackend

    cfg = load_settings()
    backend = SentenceTransformerBackend(cfg.model_name, cfg.text_prefix)
    embed = CachedEmbedder(backend).embed
    report: dict = {"model": backend.name, "dim": backend.dim, "max_tokens": backend.max_tokens, "languages": {}, "cross_lingual": {}}

    def probe(a: list[str], b: list[str]) -> dict:
        va, vb = embed(a), embed(b)
        sims = va @ vb.T  # sims[i, j] = similarity of A_i and B_j; the true pair is the diagonal
        n = len(a)
        top1 = float(np.mean([int(np.argmax(sims[i]) == i) for i in range(n)]))
        mrr = float(np.mean([1.0 / (1 + int((sims[i] > sims[i, i]).sum())) for i in range(n)]))
        pos = np.diag(sims)
        neg = sims[~np.eye(n, dtype=bool)]
        auc = float(roc_auc_score(np.r_[np.ones(n), np.zeros(neg.size)], np.r_[pos, neg]))
        return {
            "top1": round(top1, 3), "mrr": round(mrr, 3), "auc": round(auc, 3),
            "mean_cos_same_occupation": round(float(pos.mean()), 3), "mean_cos_different": round(float(neg.mean()), 3),
        }

    for name, idx in LANGS.items():
        report["languages"][name] = probe([o[idx][0] for o in OCCUPATIONS], [o[idx][1] for o in OCCUPATIONS])
    for other in ("Amharic", "Afaan Oromo"):
        i = LANGS[other]
        report["cross_lingual"][f"English -> {other}"] = probe([o[0][0] for o in OCCUPATIONS], [o[i][1] for o in OCCUPATIONS])

    pos, neg = [], []
    jv = dict(zip(JOBS, embed(list(JOBS.values()))))
    for key, items in WORKERS.items():
        wv = embed([t for t, _ in items])
        for k, jvec in jv.items():
            for (_, label), wvec in zip(items, wv):
                (pos if k == key else neg).append(float(jvec @ wvec))
    report["calibration"] = {
        "related_pairs": {"n": len(pos), "min": round(min(pos), 3), "median": round(float(np.median(pos)), 3), "p10": round(float(np.percentile(pos, 10)), 3)},
        "unrelated_pairs": {"n": len(neg), "max": round(max(neg), 3), "median": round(float(np.median(neg)), 3), "p90": round(float(np.percentile(neg, 90)), 3)},
    }

    out = ROOT / "evaluation" / "reports"
    out.mkdir(parents=True, exist_ok=True)
    slug = backend.name.split("/")[-1]
    (out / f"multilingual_probe_{slug}.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    if backend.name == "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2":
        (out / "multilingual_probe.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"model: {backend.name}  dim={backend.dim}  max_tokens={backend.max_tokens}\n")
    print(f"{'set':<24}{'top1':>6}{'MRR':>7}{'AUC':>7}{'same':>8}{'diff':>8}")
    for label, r in {**report["languages"], **report["cross_lingual"]}.items():
        print(f"{label:<24}{r['top1']:>6}{r['mrr']:>7}{r['auc']:>7}{r['mean_cos_same_occupation']:>8}{r['mean_cos_different']:>8}")
    print("\ncalibration:", json.dumps(report["calibration"]))


if __name__ == "__main__":
    main()
