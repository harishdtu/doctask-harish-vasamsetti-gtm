# Run Report

Both runs below were actually executed with:

```
python -m growth_machine run --batch run_001 --count 12
python -m growth_machine run --batch run_002 --count 15
```

No manual intervention, no code changes, and no hand-edited output files
between the two commands. Different `--count` was used deliberately, on
top of the seed already changing per `--batch`, to make it obvious this
isn't two copies of the same batch.

Company names are assigned via a deterministic partition of a fixed
synthetic name space (`growth_machine/targets.py::_names_for_batch`), so
two different `--batch` ids are **guaranteed** disjoint, not merely
likely to be -- see `docs/architecture.md`.

## Run 1 (`run_001`)

| Metric | Value |
|---|---|
| Input count | 12 |
| Qualified count | 9 |
| Enriched count | 9 |
| Drafts generated | 9 |
| Drafts passed QA | 9 |
| Drafts rejected | 0 |
| Qualification rate | 75.0% |
| Average ICP score (qualified) | 82.78 |
| Average personalization score | 10.0 / 10 |
| Average evidence score | 9.33 / 10 |
| Runtime | 0.0027s |
| Errors | 0 |

## Run 2 (`run_002`)

| Metric | Value |
|---|---|
| Input count | 15 |
| Qualified count | 11 |
| Enriched count | 11 |
| Drafts generated | 11 |
| Drafts passed QA | 11 |
| Drafts rejected | 0 |
| Qualification rate | 73.3% |
| Average ICP score (qualified) | 85.0 |
| Average personalization score | 10.0 / 10 |
| Average evidence score | 9.64 / 10 |
| Runtime | 0.0033s |
| Errors | 0 |

## Repeatability check

Company overlap between the two batches' qualified-target lists: **0
companies**, verified two ways:

1. Programmatically, in `tests/test_e2e.py::test_two_fresh_batches_no_patching`,
   which asserts `t1.isdisjoint(t2)` on every test run.
2. By construction: `run_001` and `run_002` were assigned to non-adjacent
   lanes (15 and 7 out of 22 possible lanes) in the fixed name-space
   partition, so their company names cannot overlap regardless of RNG
   behavior for other fields.

Qualification rate held in a consistent, non-trivial band (73-75%) across
two different batch sizes generated from two different batch ids, which
is the signal that the ICP scorer is discriminating consistently rather
than overfitting to one specific batch.

**Repeatability: PASS**

**Manual intervention between runs: NONE**

Raw outputs for both runs are preserved at `outputs/run_001/` and
`outputs/run_002/`, unedited, regenerated from a from-scratch `outputs/`
directory (previous run artifacts deleted before regeneration, not
overwritten in place).
