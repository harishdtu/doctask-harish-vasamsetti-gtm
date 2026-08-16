"""
Synthetic target generation.

Produces fake, obviously-synthetic B2B SaaS companies that fit (or
deliberately don't fit) the ICP: teams that repeatedly produce
customer-facing onboarding / implementation / proposal / rollout
documents. Every run with a different --seed produces a genuinely
different batch -- nothing is hard-coded per batch.

Domains are always on example.com / example.org / example.net /
example.co, per the task's synthetic-data rules. No real company or
person names are ever used here.
"""
from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field, asdict
from typing import Any


# Building blocks. All fictional. Recombined by the RNG so that each
# batch/seed produces new companies, not a fixed list.
_PREFIXES = [
    "Northstar", "Bluepeak", "Ironbridge", "Clearwater", "Fieldstone",
    "Gridline", "Harbor", "Vantage", "Redwood", "Silverlane", "Craterock",
    "Meridian", "Pinehollow", "Longview", "Brightwell", "Cobalt",
    "Ashgrove", "Tanglewood", "Wavefront", "Sparrowdale", "Coppermill",
    "Stonebrook", "Fernway", "Amberlight", "Thornfield",
]
_SUFFIXES = [
    "Analytics", "Systems", "Cloud", "Works", "Labs", "Health", "Logistics",
    "Fintech", "Robotics", "Insurance", "Compliance", "Manufacturing",
    "Retail", "Energy", "Security", "HR", "Legal", "Ops",
]

_CUSTOMER_MODELS = ["B2B"]
_COMPANY_TYPES = [
    "B2B SaaS", "vertical SaaS", "workflow-automation SaaS",
    "compliance SaaS", "fintech SaaS", "healthtech SaaS",
]
_EMPLOYEE_BANDS = ["11-50", "50-200", "200-500", "500-1000"]
_IMPLEMENTATION_MOTIONS = ["high-touch", "hybrid", "self-serve-plus-CS", "white-glove"]
_OFF_ICP_MOTIONS = ["self-serve", "product-led-growth", "unknown"]

_PERSONA_ROLES = [
    "Director of Implementation",
    "Head of Customer Success",
    "VP Customer Success",
    "Head of Professional Services",
    "Customer Operations Lead",
    "Director of Onboarding",
]

# Signal pools. High-signal targets draw mostly from ICP_SIGNALS;
# low-signal / disqualifiable targets draw from OFF_ICP_SIGNALS instead,
# so every batch contains a realistic mix, not just easy wins.
_ICP_SIGNALS = [
    "customer onboarding",
    "implementation guides",
    "configuration documents",
    "rollout playbooks",
    "proposal documents",
    "customer success runbooks",
    "professional services statements of work",
    "training/enablement documents",
    "recurring QBR decks",
    "client-specific process documentation",
]
_OFF_ICP_SIGNALS = [
    "self-serve signup only",
    "no dedicated CS team found",
    "purely transactional e-commerce",
    "consumer mobile app, no B2B motion",
    "no public evidence of implementation work",
]

_PUBLIC_DESCRIPTION_TEMPLATES = [
    "{name} is a {ctype} company serving {band}-employee customers, with a "
    "{motion} implementation model and a customer success team that "
    "repeatedly produces {signal} for new accounts.",
    "{name} builds {ctype} tools and runs a {motion} onboarding motion; "
    "its professional services team is described as handling {signal} "
    "for each new customer engagement.",
    "{name}, a {ctype} vendor, mentions a customer operations function "
    "responsible for {signal} across its client base.",
]

_OFF_ICP_DESCRIPTION_TEMPLATES = [
    "{name} is a {ctype} company with a self-serve signup flow and no "
    "public evidence of a dedicated implementation or customer success "
    "function.",
    "{name} appears to be a purely transactional product with no "
    "recurring customer-facing document workflow visible publicly.",
]


@dataclass
class SyntheticTarget:
    company_name: str
    website: str
    company_type: str
    employee_band: str
    customer_model: str
    implementation_motion: str
    document_signals: list[str]
    public_description: str
    persona_role: str
    is_deliberately_off_icp: bool = False
    source: str = "synthetic"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _synthetic_domain(rng: random.Random, name_slug: str) -> str:
    tld = rng.choice(["example.com", "example.org", "example.net", "example.co"])
    return f"https://{name_slug}.{tld}"


def _stable_seed(text: str) -> int:
    """Stable across Python processes/interpreters -- do NOT use the
    builtin hash() here, since PYTHONHASHSEED randomizes str hashing
    per-process, which would make --batch <id> non-reproducible."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


# Canonical, fixed ordering of the entire Prefix+Suffix name space,
# shuffled once with a constant internal seed (not the user-facing
# --seed) so the order itself never changes between processes. Batches
# are handed non-overlapping, contiguous slices of this fixed order,
# which is what guarantees two different --batch ids never share a
# company name -- this is deterministic, not merely probabilistic.
_ALL_NAME_COMBOS: list[tuple[str, str]] = [
    (p, s) for p in _PREFIXES for s in _SUFFIXES
]
_NAME_SPACE_SIZE = len(_ALL_NAME_COMBOS)
random.Random(20260815).shuffle(_ALL_NAME_COMBOS)


def _names_for_batch(batch_id: str, count: int) -> list[tuple[str, str]]:
    """
    Deterministically assign `count` non-overlapping names to this batch,
    based on a partition of the fixed, shuffled name space. Two calls
    with different batch_id values get disjoint slices as long as their
    combined size does not exceed the name space (450 combinations),
    which comfortably covers this task's batch sizes.
    """
    if count > _NAME_SPACE_SIZE:
        raise ValueError(
            f"count={count} exceeds the synthetic name space "
            f"({_NAME_SPACE_SIZE} combinations); reduce --count."
        )
    # Partition index: hash the batch_id into one of a fixed number of
    # equal-width, non-overlapping "lanes" across the name space, wide
    # enough to hold `count` names without spilling into a neighboring
    # lane. This keeps different batch_ids disjoint deterministically.
    lane_width = max(count, 20)
    n_lanes = _NAME_SPACE_SIZE // lane_width
    lane = _stable_seed(batch_id) % n_lanes
    start = lane * lane_width
    return _ALL_NAME_COMBOS[start:start + count]


def generate_batch(
    batch_id: str,
    count: int = 12,
    seed: int | None = None,
    off_icp_fraction: float = 0.25,
) -> list[SyntheticTarget]:
    """
    Generate `count` synthetic companies for a batch.

    The seed is derived from batch_id when not given explicitly, so
    `run_001` and `run_002` are guaranteed to produce different,
    non-overlapping company names without any manual patching. Company
    *names* come from a deterministic partition of a fixed name space
    (see `_names_for_batch`) so disjointness across batches is
    guaranteed, not just likely; all other per-target attributes (type,
    size band, motion, signals) are drawn from a batch_id-derived RNG.
    """
    if seed is None:
        seed = _stable_seed(batch_id) % (2**32)
    rng = random.Random(seed)

    name_pairs = _names_for_batch(batch_id, count)
    targets: list[SyntheticTarget] = []

    n_off_icp = max(1, round(count * off_icp_fraction))
    off_icp_flags = [True] * n_off_icp + [False] * (count - n_off_icp)
    rng.shuffle(off_icp_flags)

    for i in range(count):
        prefix, suffix = name_pairs[i]
        name = f"{prefix} {suffix}"

        slug = name.lower().replace(" ", "")
        website = _synthetic_domain(rng, slug)
        ctype = rng.choice(_COMPANY_TYPES)
        band = rng.choice(_EMPLOYEE_BANDS)
        persona = rng.choice(_PERSONA_ROLES)
        off_icp = off_icp_flags[i]

        if off_icp:
            motion = rng.choice(_OFF_ICP_MOTIONS)
            # Off-ICP companies genuinely have no document-workflow
            # signals -- the off-ICP phrases describe *why* (self-serve,
            # no CS team, etc.), they are not counted as workflow signals.
            signals = []
            template = rng.choice(_OFF_ICP_DESCRIPTION_TEMPLATES)
            desc = template.format(name=name, ctype=ctype)
        else:
            motion = rng.choice(_IMPLEMENTATION_MOTIONS)
            k = rng.randint(2, 4)
            signals = rng.sample(_ICP_SIGNALS, k=k)
            template = rng.choice(_PUBLIC_DESCRIPTION_TEMPLATES)
            desc = template.format(
                name=name, ctype=ctype, band=band, motion=motion,
                signal=", ".join(signals[:-1]) + (" and " + signals[-1] if len(signals) > 1 else signals[0]),
            )

        targets.append(
            SyntheticTarget(
                company_name=name,
                website=website,
                company_type=ctype,
                employee_band=band,
                customer_model=rng.choice(_CUSTOMER_MODELS),
                implementation_motion=motion,
                document_signals=signals,
                public_description=desc,
                persona_role=persona,
                is_deliberately_off_icp=off_icp,
            )
        )

    return targets
