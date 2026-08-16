"""
Persona mapping.

Maps a company to the most likely buyer ROLE -- never a real person's
name. Every claim is hedged with Likely / Probable / Hypothesis /
Unknown, matching the task's requirement to never claim certainty
where there is none.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from .targets import SyntheticTarget
from .enrichment import EnrichmentResult

_SUPERDOCS_CAPABILITY_BY_SIGNAL = {
    "customer onboarding": "AI edits onboarding documents directly, in place, instead of the team retyping AI-drafted text into the doc",
    "implementation guides": "version history with revert, so implementation guides can be safely mass-updated across accounts",
    "configuration documents": "targeted section edits (the 'operation' unit) for config docs that change per customer",
    "rollout playbooks": "AI editing directly inside the playbook, removing the copy-paste step between a chat window and the doc",
    "proposal documents": "fast, in-place proposal customization without manually carrying text back from a chat window",
    "customer success runbooks": "AI editing directly inside the runbook, so updates don't have to be manually carried in from a chat window (a human still reviews before it reaches a customer)",
    "professional services statements of work": "citation fields that survive editing and export, useful for SOW provenance",
    "training/enablement documents": "AI editing the training doc directly rather than producing text that must be pasted in by hand",
    "recurring QBR decks": "targeted section edits for the recurring, mostly-repeated parts of a QBR document",
    "client-specific process documentation": "in-place AI editing for the client-specific sections that change most often",
}

_DEFAULT_CAPABILITY = "AI editing that lands inside the document itself, not in a separate chat window"


@dataclass
class PersonaMap:
    company_name: str
    likely_buyer_role: str
    why: str
    buyer_problem: str
    switch_trigger: str
    likely_objection: str
    relevant_superdocs_capability: str
    certainty: str  # "Likely" | "Probable" | "Hypothesis" | "Unknown"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def map_persona(target: SyntheticTarget, enrichment: EnrichmentResult) -> PersonaMap:
    signals = target.document_signals or []

    if not signals:
        return PersonaMap(
            company_name=target.company_name,
            likely_buyer_role=target.persona_role,
            why="Unknown / not observed -- no document-workflow signal to anchor a persona hypothesis",
            buyer_problem="Unknown",
            switch_trigger="Unknown",
            likely_objection="Unknown",
            relevant_superdocs_capability=_DEFAULT_CAPABILITY,
            certainty="Unknown",
        )

    primary_signal = signals[0]
    capability = _SUPERDOCS_CAPABILITY_BY_SIGNAL.get(primary_signal, _DEFAULT_CAPABILITY)

    certainty = "Hypothesis" if target.is_deliberately_off_icp else (
        "Likely" if len(signals) >= 3 else "Probable"
    )

    why = (
        f"{certainty}: the company's public description references a "
        f"{target.implementation_motion} implementation motion and "
        f"{len(signals)} customer-facing document workflow(s) "
        f"({', '.join(signals)}), which is typically owned by a "
        f"{target.persona_role.lower()}-type role, not by product or marketing."
    )

    buyer_problem = (
        f"{certainty.lower()} that this role spends recurring time manually "
        f"editing and reformatting {primary_signal} for each new or changing "
        f"customer, rather than doing that work once."
    )

    switch_trigger = (
        "A visibly growing account load (more customers needing the same "
        f"documents customized) with no matching growth in headcount -- "
        "the point where manual editing stops scaling."
    )

    likely_objection = "We already have a template/process for this"

    return PersonaMap(
        company_name=target.company_name,
        likely_buyer_role=target.persona_role,
        why=why,
        buyer_problem=buyer_problem,
        switch_trigger=switch_trigger,
        likely_objection=likely_objection,
        relevant_superdocs_capability=capability,
        certainty=certainty,
    )
