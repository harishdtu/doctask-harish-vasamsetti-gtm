"""
Pipeline orchestrator.

Wires together: targets -> ICP filter -> qualification -> enrichment
-> persona mapping -> personalization -> draft generation -> QA ->
campaign artifact -> measurement.

This is the only module that mutates the RunMeasurement object and
writes files -- every other module is a pure function over dataclasses,
which is what makes `run --batch run_002` behave identically to
`run --batch run_001` on new inputs without any patching.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from .targets import SyntheticTarget, generate_batch
from .public_targets import load_public_targets
from .icp import score_target
from .enrichment import enrich_target
from .persona import map_persona
from .personalization import build_personalization
from .drafts import generate_draft_sequence
from .qa import run_qa
from .measurement import RunMeasurement

TOP_N_FOR_OUTREACH_DRAFTS = 5


def run_batch(
    batch_id: str,
    output_dir: str | Path,
    count: int = 12,
    seed: Optional[int] = None,
    public_input_path: Optional[str] = None,
) -> RunMeasurement:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    m = RunMeasurement(batch_id=batch_id)

    mode = "synthetic"
    targets: list[SyntheticTarget] = []
    if public_input_path:
        targets = load_public_targets(public_input_path)
        if targets:
            mode = "public"
        else:
            m.errors.append(
                f"public_input_path '{public_input_path}' missing/empty/invalid -- "
                f"falling back to synthetic mode"
            )

    if not targets:
        targets = generate_batch(batch_id=batch_id, count=count, seed=seed)

    m.targets_discovered = len(targets)

    qualified_records = []
    enrichment_records = []
    persona_records = []
    campaign_entries = []  # (target, icp, enrichment, persona, chain, draft_seq, qa)

    for t in targets:
        icp = score_target(t)
        qualified_records.append({"target": t.to_dict(), "icp": icp.to_dict()})

        if not icp.qualified:
            continue
        m.targets_qualified += 1
        m.icp_scores.append(icp.score)

        try:
            enr = enrich_target(t)
            m.targets_enriched += 1
            enrichment_records.append(enr.to_dict())

            persona = map_persona(t, enr)
            persona_records.append(persona.to_dict())

            chain = build_personalization(t, persona)
            draft_seq = generate_draft_sequence(t, persona, chain)
            m.drafts_generated += 1

            evidence = [r.evidence for r in enr.records]
            qa = run_qa(draft_seq, chain.short_personalized_line, evidence)
            m.personalization_scores.append(qa.personalization_score)
            m.evidence_scores.append(qa.evidence_score)

            if qa.safety_status == "PASS":
                m.drafts_passed_qa += 1
            else:
                m.drafts_rejected += 1

            campaign_entries.append(
                {
                    "target": t,
                    "icp": icp,
                    "enrichment": enr,
                    "persona": persona,
                    "chain": chain,
                    "draft_seq": draft_seq,
                    "qa": qa,
                }
            )
        except Exception as e:  # noqa: BLE001 -- deliberately broad: log & continue the batch
            m.errors.append(f"{t.company_name}: {type(e).__name__}: {e}")

    m.finish()

    # ---- write raw JSON artifacts ----
    (out / "qualified_targets.json").write_text(json.dumps(qualified_records, indent=2))
    (out / "enrichment.json").write_text(json.dumps(enrichment_records, indent=2))
    (out / "persona_mapping.json").write_text(json.dumps(persona_records, indent=2))
    (out / "measurement.json").write_text(json.dumps(m.to_dict(), indent=2))

    # ---- outreach_drafts.md: strongest QA-passed examples only ----
    passed = [e for e in campaign_entries if e["qa"].safety_status == "PASS"]
    passed.sort(key=lambda e: (e["qa"].personalization_score + e["qa"].evidence_score, e["icp"].score), reverse=True)
    top = passed[:TOP_N_FOR_OUTREACH_DRAFTS]

    lines = [
        f"# Outreach Drafts -- {batch_id}",
        "",
        f"Mode: **{mode}**. All messages below are drafts only. "
        f"**Nothing in this file was sent to anyone.**",
        "",
        f"Showing the {len(top)} strongest QA-passed examples out of "
        f"{len(campaign_entries)} qualified & personalized targets "
        f"({m.drafts_passed_qa} passed QA overall).",
        "",
    ]
    for e in top:
        t, persona, qa = e["target"], e["persona"], e["qa"]
        lines += [
            f"## {t.company_name}",
            f"- ICP score: {e['icp'].score}/100",
            f"- Likely buyer role: {persona.likely_buyer_role} ({persona.certainty})",
            f"- QA: personalization {qa.personalization_score}/10, evidence {qa.evidence_score}/10, safety {qa.safety_status}",
            "",
            "**Draft 1 (initial):**",
            "```",
            e["draft_seq"].draft_1,
            "```",
            "**Draft 2 (follow-up):**",
            "```",
            e["draft_seq"].draft_2,
            "```",
            "**Draft 3 (final follow-up):**",
            "```",
            e["draft_seq"].draft_3,
            "```",
            "",
        ]
    (out / "outreach_drafts.md").write_text("\n".join(lines))

    # ---- campaign_summary.md ----
    summary_lines = [
        f"# Campaign Summary -- {batch_id}",
        "",
        f"Mode: {mode}",
        "",
        "## Funnel",
        "",
        "| Stage | Count |",
        "|---|---|",
        f"| Discovered | {m.targets_discovered} |",
        f"| Qualified | {m.targets_qualified} |",
        f"| Enriched | {m.targets_enriched} |",
        f"| Drafts generated | {m.drafts_generated} |",
        f"| Drafts passed QA | {m.drafts_passed_qa} |",
        f"| Drafts rejected | {m.drafts_rejected} |",
        "",
        f"- Qualification rate: {m.qualification_rate:.0%}",
        f"- QA pass rate: {m.qa_pass_rate:.0%}",
        f"- Average ICP score (qualified): {m.average_icp_score}",
        f"- Average personalization score: {m.average_personalization_score}/10",
        f"- Average evidence score: {m.average_evidence_score}/10",
        f"- Runtime: {m.runtime_seconds}s",
        f"- Errors: {len(m.errors)}",
        "",
        "No outreach was sent. Reply/meeting/conversion rates are not measured "
        "-- see docs/measurement.md.",
        "",
    ]
    if m.errors:
        summary_lines += ["## Errors", ""] + [f"- {e}" for e in m.errors] + [""]
    (out / "campaign_summary.md").write_text("\n".join(summary_lines))

    return m
