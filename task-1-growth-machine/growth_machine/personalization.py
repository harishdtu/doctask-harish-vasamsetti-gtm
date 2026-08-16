"""
Personalization engine.

Builds the observed-signal -> why-it-matters -> likely-pain ->
capability -> message chain the task asks for. Every sentence traces
back to a specific observed field on the target -- there is no
generic "I noticed your company is growing" filler anywhere in this
module.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from .targets import SyntheticTarget
from .persona import PersonaMap


@dataclass
class PersonalizationChain:
    company_name: str
    observed_signal: str
    why_it_matters: str
    likely_document_pain: str
    relevant_capability: str
    short_personalized_line: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_personalization(target: SyntheticTarget, persona: PersonaMap) -> PersonalizationChain:
    signals = target.document_signals or []
    observed_signal = (
        ", ".join(signals) if signals else "no specific document workflow observed"
    )

    if not signals:
        why_it_matters = "Unknown -- insufficient public signal to personalize responsibly."
        pain = "Unknown"
        line = (
            f"(Not enough public signal on {target.company_name} to write a "
            f"responsibly personalized line -- this target should be held "
            f"back from outreach until enriched further.)"
        )
        return PersonalizationChain(
            company_name=target.company_name,
            observed_signal=observed_signal,
            why_it_matters=why_it_matters,
            likely_document_pain=pain,
            relevant_capability=persona.relevant_superdocs_capability,
            short_personalized_line=line,
        )

    why_it_matters = (
        f"A {target.implementation_motion} implementation motion combined "
        f"with {len(signals)} recurring document type(s) usually means the "
        f"same document gets edited by hand for every new customer."
    )
    pain = (
        f"Likely a repeated manual-editing loop on {signals[0]}: draft, "
        f"copy into the doc, reformat, repeat per customer."
    )
    line = (
        f"Your implementation workflow appears to involve {signals[0]}"
        + (f" and {signals[1]}" if len(signals) > 1 else "")
        + f". That kind of recurring, customer-specific document work usually "
        f"means a lot of repeated manual editing -- {persona.relevant_superdocs_capability}. "
        f"This is a hypothesis based on your public description, not a claim "
        f"of private knowledge about {target.company_name}."
    )

    return PersonalizationChain(
        company_name=target.company_name,
        observed_signal=observed_signal,
        why_it_matters=why_it_matters,
        likely_document_pain=pain,
        relevant_capability=persona.relevant_superdocs_capability,
        short_personalized_line=line,
    )
