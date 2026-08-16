"""
Measurement.

Tracks the funnel honestly. No reply/open/conversion numbers are ever
fabricated -- since nothing is sent, those fields are always reported
as "not measured (no outreach was sent)".
"""
from __future__ import annotations

import time
from dataclasses import dataclass, asdict, field
from typing import Any


@dataclass
class RunMeasurement:
    batch_id: str
    targets_discovered: int = 0
    targets_qualified: int = 0
    targets_enriched: int = 0
    drafts_generated: int = 0
    drafts_passed_qa: int = 0
    drafts_rejected: int = 0
    icp_scores: list[int] = field(default_factory=list)
    personalization_scores: list[int] = field(default_factory=list)
    evidence_scores: list[int] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    start_time: float = field(default_factory=time.time)
    end_time: float | None = None

    def finish(self) -> None:
        self.end_time = time.time()

    @property
    def runtime_seconds(self) -> float:
        end = self.end_time if self.end_time is not None else time.time()
        return round(end - self.start_time, 4)

    @property
    def qualification_rate(self) -> float:
        return round(self.targets_qualified / self.targets_discovered, 4) if self.targets_discovered else 0.0

    @property
    def enrichment_success_rate(self) -> float:
        return round(self.targets_enriched / self.targets_qualified, 4) if self.targets_qualified else 0.0

    @property
    def qa_pass_rate(self) -> float:
        return round(self.drafts_passed_qa / self.drafts_generated, 4) if self.drafts_generated else 0.0

    @property
    def average_icp_score(self) -> float:
        return round(sum(self.icp_scores) / len(self.icp_scores), 2) if self.icp_scores else 0.0

    @property
    def average_personalization_score(self) -> float:
        return round(sum(self.personalization_scores) / len(self.personalization_scores), 2) if self.personalization_scores else 0.0

    @property
    def average_evidence_score(self) -> float:
        return round(sum(self.evidence_scores) / len(self.evidence_scores), 2) if self.evidence_scores else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "batch_id": self.batch_id,
            "funnel": {
                "targets_discovered": self.targets_discovered,
                "targets_qualified": self.targets_qualified,
                "targets_enriched": self.targets_enriched,
                "drafts_generated": self.drafts_generated,
                "drafts_passed_qa": self.drafts_passed_qa,
                "drafts_rejected": self.drafts_rejected,
            },
            "rates": {
                "qualification_rate": self.qualification_rate,
                "enrichment_success_rate": self.enrichment_success_rate,
                "qa_pass_rate": self.qa_pass_rate,
            },
            "averages": {
                "average_icp_score": self.average_icp_score,
                "average_personalization_score": self.average_personalization_score,
                "average_evidence_score": self.average_evidence_score,
            },
            "runtime_seconds": self.runtime_seconds,
            "errors": self.errors,
            "outreach_sent": False,
            "note": (
                "No outreach was sent. Therefore reply rate, meeting rate, "
                "and conversion rate are not measured. See docs/measurement.md "
                "for what these would be once a human uses the machine in a "
                "real, human-run campaign."
            ),
        }
