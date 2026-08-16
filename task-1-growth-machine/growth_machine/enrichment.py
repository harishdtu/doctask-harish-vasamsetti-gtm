"""
Enrichment stage.

Turns raw target fields into a structured list of sourced signal
records. In synthetic mode, the "source" is the synthetic company
record itself (its synthetic website). In public mode, this module
would attach a real public URL per claim (see public_targets.py);
every claim always carries a source_url and a confidence level, and
nothing is invented -- fields that cannot be observed are recorded as
"Unknown / not observed" rather than guessed.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from .targets import SyntheticTarget


@dataclass
class EnrichmentRecord:
    signal: str
    evidence: str
    source_url: str
    confidence: str  # "high" | "medium" | "low" | "unknown"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EnrichmentResult:
    company_name: str
    records: list[EnrichmentRecord]
    company_description: str
    onboarding_model: str
    documentation_intensity: str  # "low" | "medium" | "high"

    def to_dict(self) -> dict[str, Any]:
        return {
            "company_name": self.company_name,
            "records": [r.to_dict() for r in self.records],
            "company_description": self.company_description,
            "onboarding_model": self.onboarding_model,
            "documentation_intensity": self.documentation_intensity,
        }


def enrich_target(target: SyntheticTarget) -> EnrichmentResult:
    records: list[EnrichmentRecord] = []

    if target.document_signals:
        for sig in target.document_signals:
            records.append(
                EnrichmentRecord(
                    signal=sig,
                    evidence=target.public_description,
                    source_url=target.website,
                    confidence="high" if not target.is_deliberately_off_icp else "low",
                )
            )
    else:
        records.append(
            EnrichmentRecord(
                signal="document workflow",
                evidence="Unknown / not observed",
                source_url=target.website,
                confidence="unknown",
            )
        )

    n = len(target.document_signals)
    if n >= 4:
        intensity = "high"
    elif n >= 2:
        intensity = "medium"
    else:
        intensity = "low"

    return EnrichmentResult(
        company_name=target.company_name,
        records=records,
        company_description=target.public_description,
        onboarding_model=target.implementation_motion,
        documentation_intensity=intensity,
    )
