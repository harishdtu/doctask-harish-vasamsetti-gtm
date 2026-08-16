# Demo Summary -- growth_machine

This page is built to be walked through live in ~3 minutes. Everything
referenced here is a real file in this repository, produced by an actual
execution of the machine (see `docs/run-report.md`).

## 1. Input batch

Two batches, generated (not hand-written), from different batch ids.
Company names come from a deterministic, non-overlapping partition of a
fixed synthetic name space -- see `docs/architecture.md`.

| Batch | Companies | Mode |
|---|---|---|
| `run_001` | 12 | synthetic |
| `run_002` | 15 | synthetic |

## 2. ICP scoring

Deterministic 100-point model (`growth_machine/icp.py`), documented in
`docs/architecture.md`. Example, from `run_002`:

> **Tanglewood Security** -- ICP score **100/100**
> Reasons: recurring implementation motion; customer-facing document
> workflow evidence (proposal documents, implementation guides);
> professional-services-style motion; B2B SaaS; medium/growing org.

## 3. Enrichment

Every claim carries a `source_url` and a `confidence` level -- see
`outputs/run_002/enrichment.json`. Nothing is invented; unknown fields are
recorded as `"Unknown / not observed"`.

## 4. Personalization

Signal -> why-it-matters -> likely pain -> SuperDocs capability -> one
line, per `growth_machine/personalization.py`:

> "Your implementation workflow appears to involve proposal documents and
> implementation guides. That kind of recurring, customer-specific
> document work usually means a lot of repeated manual editing -- fast,
> in-place proposal customization without manually carrying text back
> from a chat window. This is a hypothesis based on your public
> description, not a claim of private knowledge about Tanglewood
> Security."

Note: capability descriptions only ever reference in-document AI editing
and, where relevant, that a human should still review customer-facing
output -- never an unverified default-on product feature (see
`docs/architecture.md` "Safety design" and `PROGRESS.md`).

## 5. QA

Every draft sequence is scored and gated before it can appear in the
campaign artifact -- see `growth_machine/qa.py`. In both runs: **100% QA
pass rate**, 0 rejected.

## 6. Final campaign artifact

`outputs/run_001/outreach_drafts.md` and `outputs/run_002/outreach_drafts.md`
-- the 5 strongest QA-passed examples per run, each message prefixed
`[SIMULATION / DRAFT -- NOT SENT]`.

## 7. Measurement

| Metric | Run 1 | Run 2 |
|---|---|---|
| Discovered | 12 | 15 |
| Qualified | 9 | 11 |
| Qualification rate | 75.0% | 73.3% |
| Avg. ICP score | 82.78 | 85.0 |
| Avg. personalization score | 10.0/10 | 10.0/10 |
| Avg. evidence score | 9.33/10 | 9.64/10 |
| QA pass rate | 100% | 100% |
| Outreach sent | **False** | **False** |

Full honest-numbers writeup: `docs/measurement.md`.

## 8. Second run

`run_002` used a different `--count` (15 vs. 12) and a different batch id
(`run_002` vs. `run_001`), with **zero manual edits** to code or output
between the two commands.

## 9. Repeatability

**0 companies overlap** between `run_001` and `run_002`'s qualified-target
lists -- guaranteed by construction (the two batches were assigned
non-adjacent lanes in a fixed name-space partition), and independently
verified by `tests/test_e2e.py::test_two_fresh_batches_no_patching`.
Qualification rate held in a consistent 73-75% band across both runs.
**Repeatability: PASS.** Full detail: `docs/run-report.md`.
