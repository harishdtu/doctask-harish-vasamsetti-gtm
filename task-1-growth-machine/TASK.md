# TASK.md

This project generates simulated growth artifacts and never contacts real
people or companies.

## Goal

Build one working growth machine for one specific audience, run it twice
on fresh batches with no manual patching in between, and produce one real
piece of growth work (a personalized outbound campaign pack) plus honest
measurement -- for the SuperDocs Round 2 GTM / Growth Engineer Task 1.

## Audience

Implementation and Customer Success leads at mid-size (50-500 employee)
B2B SaaS companies running a high-touch or hybrid onboarding motion, who
repeatedly produce customer-facing onboarding, implementation,
configuration, proposal/SOW, and rollout documents. Full rationale:
`docs/audience.md`.

## Machine

A Python CLI (`python -m growth_machine run --batch <id>`) implementing:
target generation/loading -> ICP scoring -> qualification -> enrichment ->
persona mapping -> personalization -> draft generation -> QA/safety gate
-> campaign artifact -> measurement. Full design: `docs/architecture.md`.

## Non-goals

- Not a CRM, not a database, not a SaaS product.
- Not a spreadsheet-editing tool.
- Not dependent on any paid API, backend, or credential to run.
- Not a clone of SuperDocs.
- Not a system that contacts anyone -- see Safety rules.

## Safety rules

- `DRY_RUN=true` and `SEND_MESSAGES=false`, hard-coded, not configurable.
- No function anywhere in `growth_machine/` sends email, DMs, or HTTP
  requests to any external service. Enforced by `tests/test_safety.py`.
- Only synthetic (`*.example.com/.org/.net/.co`) or human-curated public
  company data is ever used as input.
- Buyer identity is always a ROLE (e.g. "Director of Implementation"),
  never a real person's name.
- Every generated message is labeled `SIMULATION / DRAFT -- NOT SENT` and
  the QA gate rejects any draft where that marker is missing.
- No API key, secret, or credential appears anywhere in this repository.

## Acceptance criteria

- [x] Machine runs end-to-end with zero required credentials.
- [x] Machine runs a second time on a fresh batch with no patching.
- [x] Produces `outreach_drafts.md`, `campaign_summary.md`,
      `measurement.json`, `qualified_targets.json`, `enrichment.json`.
- [x] Honest measurement page (`docs/measurement.md`) with no fabricated
      reply/conversion numbers.
- [x] Tests exist and pass, including dedicated safety tests.
- [x] No secrets in git history or working tree.

## Run commands

```bash
python -m growth_machine run --batch run_001 --count 12
python -m growth_machine run --batch run_002 --count 15
python -m unittest discover -s tests -v
```

## Expected artifacts

```
outputs/
  run_001/{qualified_targets.json, enrichment.json, persona_mapping.json,
           outreach_drafts.md, campaign_summary.md, measurement.json}
  run_002/{...same shape...}
  latest-run/summary.md
docs/{audience.md, architecture.md, measurement.md, run-report.md}
README.md, TASK.md, PROGRESS.md
tests/{test_unit.py, test_safety.py, test_e2e.py}
