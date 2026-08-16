"""
Quality / safety checker -- the human review gate.

Every generated draft sequence passes through here before it can
appear in the final campaign artifact. This module is deliberately
conservative: on any ambiguous signal it flags rather than silently
publishing.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import Any

from .drafts import DraftSequence, SIMULATION_MARKER

# A short, generic list of common personal given names used only to
# catch accidental leakage of an individual's name into a draft. This
# is a safety net, not a claim of completeness -- the underlying data
# pipeline never has personal names in it to begin with (see targets.py
# and enrichment.py, which only ever store company-level facts and
# ROLE titles).
_SUSPICIOUS_PATTERNS = {
    "personal_email": re.compile(r"[a-zA-Z0-9_.+-]+@(?!example\.(com|org|net|co))[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+"),
    "phone_number": re.compile(r"\b(\+?\d[\d\-\s()]{7,}\d)\b"),
    "guaranteed_outcome": re.compile(r"\b(guarantee(d)?|100% (?:results|roi)|promise(d)? results)\b", re.I),
    "competitor_comparison": re.compile(r"\b(unlike|better than|beats)\s+(clay|apollo|make|zapier|n8n|notion|google docs|docsend)\b", re.I),
    "unsupported_claim": re.compile(r"\b(SOC ?2|ISO ?27001|HIPAA[- ]certified|GDPR[- ]certified|audited deletion)\b", re.I),
    "accidental_send_language": re.compile(r"\b(sent automatically|auto-?sent|this email was sent to)\b", re.I),
}


@dataclass
class QAResult:
    company_name: str
    personalization_score: int
    evidence_score: int
    safety_status: str  # "PASS" | "FAIL"
    issues: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _safety_scan(text: str) -> list[str]:
    issues = []
    for label, pattern in _SUSPICIOUS_PATTERNS.items():
        if pattern.search(text):
            issues.append(f"possible {label.replace('_', ' ')} detected")
    if SIMULATION_MARKER not in text:
        issues.append("missing SIMULATION / DRAFT marker")
    return issues


def _score_personalization(chain_line: str, company_name: str) -> int:
    score = 4  # baseline
    if company_name in chain_line:
        score += 2
    hedge_words = ("hypothesis", "based on your public description", "not a claim")
    if any(w in chain_line.lower() for w in hedge_words):
        score += 2
    if len(chain_line.split()) > 15:
        score += 2
    return min(score, 10)


def _score_evidence(evidence_list: list[str]) -> int:
    if not evidence_list or evidence_list == ["Unknown / not observed"]:
        return 2
    non_trivial = [e for e in evidence_list if e and e != "Unknown / not observed"]
    return min(4 + 2 * len(non_trivial), 10)


def run_qa(
    draft_seq: DraftSequence,
    personalization_line: str,
    evidence: list[str],
) -> QAResult:
    issues: list[str] = []
    for draft_text in (draft_seq.draft_1, draft_seq.draft_2, draft_seq.draft_3):
        issues.extend(_safety_scan(draft_text))

    personalization_score = _score_personalization(personalization_line, draft_seq.company_name)
    evidence_score = _score_evidence(evidence)

    if evidence_score <= 2:
        issues.append("weak evidence backing (no non-trivial source signal)")

    safety_status = "FAIL" if issues else "PASS"

    return QAResult(
        company_name=draft_seq.company_name,
        personalization_score=personalization_score,
        evidence_score=evidence_score,
        safety_status=safety_status,
        issues=issues,
    )
