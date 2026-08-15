"""
Optional public-company mode.

Consumes a manually curated JSON file of public company names/URLs
(data/public_targets.json) and converts each entry into the same
SyntheticTarget shape the rest of the pipeline already understands,
so every downstream stage (ICP scoring, enrichment, persona mapping,
personalization, drafts, QA) works unmodified on either input type.

This mode NEVER scrapes personal data. It only ever reads the fields
the human curator already put in the input file (company name,
website, publicly-stated facts) plus whatever `notes`/`document_signals`
the curator supplied by hand. It does not perform live scraping in
this build -- see README "Known limitations" -- and if the input file
is missing or empty it falls back to synthetic mode gracefully rather
than failing.
"""
from __future__ import annotations

import json
from pathlib import Path

from .targets import SyntheticTarget


def load_public_targets(path: str | Path) -> list[SyntheticTarget]:
    """
    Load a curated public-targets JSON file. Expected shape: a list of
    objects with company_name, website, company_type, employee_band,
    customer_model, implementation_motion, document_signals (list),
    public_description, persona_role -- i.e. the same fields a human
    curator would fill in after reading a company's own public pages.

    Returns [] (never raises) if the file is missing, empty, or
    malformed, so the CLI can fall back to synthetic mode gracefully
    per the task's requirement.
    """
    p = Path(path)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return []

    if not isinstance(data, list) or not data:
        return []

    targets: list[SyntheticTarget] = []
    for entry in data:
        try:
            targets.append(
                SyntheticTarget(
                    company_name=entry["company_name"],
                    website=entry.get("website", "Unknown"),
                    company_type=entry.get("company_type", "B2B SaaS"),
                    employee_band=entry.get("employee_band", "Unknown"),
                    customer_model=entry.get("customer_model", "B2B"),
                    implementation_motion=entry.get("implementation_motion", "Unknown"),
                    document_signals=entry.get("document_signals", []),
                    public_description=entry.get("public_description", "Unknown / not observed"),
                    persona_role=entry.get("persona_role", "Customer Operations Lead"),
                    is_deliberately_off_icp=False,
                    source=entry.get("source_url", entry.get("website", "Unknown")),
                )
            )
        except KeyError:
            # Skip malformed rows rather than crashing the whole batch.
            continue

    return targets
