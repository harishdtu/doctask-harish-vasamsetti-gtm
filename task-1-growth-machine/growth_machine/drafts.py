"""
Outreach draft generation.

Produces a 3-message DRAFT-ONLY sequence per qualified target. There
is no send/email/DM function anywhere in this module or in this
package -- every message is labeled SIMULATION / DRAFT -- NOT SENT and
written to a local file for human review.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from .targets import SyntheticTarget
from .persona import PersonaMap
from .personalization import PersonalizationChain

SIMULATION_MARKER = "SIMULATION / DRAFT -- NOT SENT"


@dataclass
class DraftSequence:
    company_name: str
    persona_role: str
    draft_1: str
    draft_2: str
    draft_3: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _draft_1(target: SyntheticTarget, persona: PersonaMap, chain: PersonalizationChain) -> str:
    return (
        f"[{SIMULATION_MARKER}]\n"
        f"To: {persona.likely_buyer_role} at {target.company_name}\n\n"
        f"Subject: A question about {chain.observed_signal.split(',')[0].strip()}\n\n"
        f"{chain.short_personalized_line}\n\n"
        f"SuperDocs edits the document itself -- AI changes land inside the "
        f"file, so nothing has to be manually carried back in from a chat "
        f"window. Curious whether that repeated editing loop is something "
        f"your team feels, or whether you've already solved it another way."
    )


def _draft_2(target: SyntheticTarget, persona: PersonaMap, chain: PersonalizationChain) -> str:
    return (
        f"[{SIMULATION_MARKER}]\n"
        f"To: {persona.likely_buyer_role} at {target.company_name}\n\n"
        f"Subject: Re: A question about {chain.observed_signal.split(',')[0].strip()}\n\n"
        f"One more thought, in case it's useful: \"{persona.likely_objection}\" "
        f"is the most common reaction we hear at this stage -- and it's a "
        f"fair one. The short version is that SuperDocs doesn't replace your "
        f"template or process -- it edits inside the document you already "
        f"have, instead of you copy-pasting text in from a chat window. A "
        f"human should still review anything customer-facing before it goes "
        f"out; SuperDocs doesn't change that.\n\n"
        f"Happy to leave it here if the timing's off."
    )


def _draft_3(target: SyntheticTarget, persona: PersonaMap, chain: PersonalizationChain) -> str:
    return (
        f"[{SIMULATION_MARKER}]\n"
        f"To: {persona.likely_buyer_role} at {target.company_name}\n\n"
        f"Subject: Closing the loop\n\n"
        f"I'll leave this here -- if the {chain.observed_signal.split(',')[0].strip()} "
        f"editing workload ever becomes worth a second look, feel free to "
        f"reach back out. Wishing your team a smooth rollout either way."
    )


def generate_draft_sequence(
    target: SyntheticTarget, persona: PersonaMap, chain: PersonalizationChain
) -> DraftSequence:
    return DraftSequence(
        company_name=target.company_name,
        persona_role=persona.likely_buyer_role,
        draft_1=_draft_1(target, persona, chain),
        draft_2=_draft_2(target, persona, chain),
        draft_3=_draft_3(target, persona, chain),
    )
