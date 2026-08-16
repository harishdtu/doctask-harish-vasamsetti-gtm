"""
Deterministic ICP (Ideal Customer Profile) scoring.

Scoring model (documented in docs/architecture.md and docs/audience.md):

    +25  recurring implementation / customer-onboarding motion
    +20  customer-facing document workflow evidence (2+ document signals)
    +15  evidence of professional services / high-touch or white-glove motion
    +15  is a B2B SaaS (or SaaS-adjacent) company
    +10  medium-or-larger, growing organization (50+ employees)
    +10  3+ distinct customer-facing document workflows observed
    +5   documentation-heavy operation (4+ document signals)

    Max score: 100
    Qualification threshold: score >= 50 AND at least 1 document signal

These weights were set, not tuned against a labeled dataset (none
exists for a same-day synthetic exercise) -- see docs/measurement.md
for how this would be validated with real data before being trusted
at volume.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from .targets import SyntheticTarget

QUALIFY_THRESHOLD = 50

_ONBOARDING_MOTIONS = {"high-touch", "hybrid", "white-glove", "self-serve-plus-CS"}
_PRO_SERVICES_MOTIONS = {"high-touch", "white-glove"}
_GROWING_BANDS = {"50-200", "200-500", "500-1000"}


@dataclass
class ICPResult:
    company_name: str
    score: int
    qualified: bool
    reasons: list[str]
    disqualification_reasons: list[str]
    evidence: list[str]
    source_url: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def score_target(target: SyntheticTarget) -> ICPResult:
    score = 0
    reasons: list[str] = []
    disqualification_reasons: list[str] = []
    evidence: list[str] = []

    signals = target.document_signals or []
    n_signals = len(signals)

    # +25 recurring implementation/onboarding motion
    if target.implementation_motion in _ONBOARDING_MOTIONS and n_signals > 0:
        score += 25
        reasons.append(f"Recurring '{target.implementation_motion}' onboarding/implementation motion")
        evidence.append(target.public_description)
    else:
        disqualification_reasons.append("No recurring onboarding/implementation motion observed")

    # +20 customer-facing document workflow (2+ signals)
    if n_signals >= 2:
        score += 20
        reasons.append(f"Customer-facing document workflow evidence ({n_signals} distinct signals)")
    elif n_signals == 1:
        disqualification_reasons.append("Only one document-workflow signal observed (weak evidence)")
    else:
        disqualification_reasons.append("No document-workflow signals observed")

    # +15 evidence of professional services / high-touch motion
    if target.implementation_motion in _PRO_SERVICES_MOTIONS:
        score += 15
        reasons.append(f"Evidence of professional-services-style motion ('{target.implementation_motion}')")
    else:
        disqualification_reasons.append("No clear professional-services motion")

    # +15 B2B SaaS
    if "SaaS" in target.company_type and target.customer_model == "B2B":
        score += 15
        reasons.append(f"B2B SaaS company ({target.company_type})")
    else:
        disqualification_reasons.append("Not clearly a B2B SaaS company")

    # +10 medium/growing org
    if target.employee_band in _GROWING_BANDS:
        score += 10
        reasons.append(f"Medium-sized/growing organization ({target.employee_band} employees)")
    else:
        disqualification_reasons.append(f"Employee band ({target.employee_band}) outside target growth range")

    # +10 multiple customer workflows (3+)
    if n_signals >= 3:
        score += 10
        reasons.append(f"Multiple distinct customer-facing document workflows ({n_signals})")

    # +5 documentation-heavy operation (4+)
    if n_signals >= 4:
        score += 5
        reasons.append(f"Documentation-heavy operation ({n_signals} workflows observed)")

    qualified = score >= QUALIFY_THRESHOLD and n_signals > 0

    if not evidence:
        evidence.append("Unknown / not observed")

    return ICPResult(
        company_name=target.company_name,
        score=min(score, 100),
        qualified=qualified,
        reasons=reasons,
        disqualification_reasons=disqualification_reasons,
        evidence=evidence,
        source_url=target.website,
    )
