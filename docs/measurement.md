# Measurement

## What is actually measured

Every run writes `outputs/<batch>/measurement.json` with:

- Funnel counts: discovered -> qualified -> enriched -> drafts generated
  -> drafts passed QA -> drafts rejected
- Rates: qualification rate, enrichment success rate, QA pass rate
- Averages: ICP score, personalization score (0-10), evidence score (0-10)
- Runtime and errors

Run 1 and Run 2 numbers are in `docs/run-report.md`.

## What is explicitly NOT measured, and why

**No outreach was sent. Therefore reply rate, meeting rate, and
conversion rate are not measured** -- this line is written verbatim into
every `campaign_summary.md` and `measurement.json` the machine produces,
because inventing those numbers would be worse than omitting them.

Once a human uses this machine in a real campaign (their own outreach,
their own accounts, per the task's rules), those would be measured as:
reply rate = replies / drafts sent, positive-reply rate = positive replies
/ replies, meeting rate = meetings booked / drafts sent, and eventually
conversion rate = signups / meetings. None of that exists yet because
nothing here sends anything.

## Which numbers prove this machine works

The leading indicators that matter *before* any real send:

1. **Qualification rate holding in a plausible band (not 0%, not 100%).**
   In both real runs it landed at 73-75%, because ~25% of each synthetic
   batch is deliberately off-ICP. A qualification rate near 100% would
   mean the scorer isn't discriminating; near 0% would mean the
   thresholds are miscalibrated for the ICP as defined.
2. **Personalization and evidence scores staying high (9-10/10) across a
   changing batch.** This shows the personalization chain is actually
   reading each target's specific signals, not falling back to a
   generic template when new inputs arrive.
3. **QA pass rate.** 100% in both test runs because the synthetic
   generator and personalization engine are internally consistent; the
   more interesting number will come once this runs against messier,
   real public-page data in public mode, where the QA rejection rate
   is expected to rise.

## Where the machine leaks

Ordered by expected severity once this runs on real data:

- **Discovery.** Synthetic mode has no leak (targets are generated, not
  found). Public mode's discovery step is entirely manual right now (a
  human curates `data/public_targets.json`); this is the single biggest
  gap versus a real Clay/Apollo-class enrichment tool, and it's a
  deliberate one -- see docs/architecture.md.
- **Qualification.** The ICP weights are a starting hypothesis (see
  docs/architecture.md), not validated against real reply data. Expect
  false positives (companies that look ICP-shaped from a description but
  don't actually own the pain) until validated with real outcomes.
- **Enrichment.** In public mode, "evidence" is only as good as what a
  company publishes about its own onboarding process -- many companies
  say nothing publicly, which the machine correctly reports as "Unknown
  / not observed" rather than guessing, but that means real-world
  enrichment coverage will be lower than this synthetic demo's 100%.
- **Personalization.** The current engine is template-based (fill in
  observed signal -> pain -> capability). It will not catch nuance an
  LLM-based personalization pass might (e.g. a company's specific
  vertical jargon); that's the most likely place a stranger would
  eventually notice it isn't hand-written.
- **QA / hallucinated evidence.** The regex-based safety net catches
  known bad patterns (guaranteed outcomes, competitor comparisons,
  personal contact info, missing simulation marker) but cannot catch a
  personalization line that is *subtly* wrong in a way that isn't a
  known pattern -- that risk grows once public-mode enrichment brings in
  noisier real-world text.

## What breaks first at 10x volume

- **Duplicate/near-duplicate targets.** The synthetic generator's
  Prefix+Suffix space (~25 x 18 = 450 combinations) would start
  colliding well before 10x today's batch size; public mode would need
  real deduplication against a company registry.
- **Review burden.** The QA gate is a pass/fail filter, not a
  replacement for a human reading every draft before it's used in a real
  campaign -- at 10x volume, "read every passed draft" stops being
  realistic and becomes "spot-check a sample," which is a real
  human-in-the-loop tradeoff, not a solved problem.
- **Source freshness.** Public-mode evidence (a company's own public
  pages) can go stale; nothing here re-checks a source URL after the
  initial enrichment.
- **Model/API cost and rate limits.** Not applicable to the current
  build (no LLM or paid API calls at all), but any future upgrade to
  LLM-based personalization or an LLM-based QA reviewer would introduce
  both, and would need explicit budget and rate-limit handling.

## Where a human must stay in the loop

At minimum, per the task's own requirement:

- **ICP definition** -- the scoring weights above are a starting
  hypothesis a human should sign off on and periodically re-tune against
  real outcomes.
- **High-value target approval** -- before a qualified target's drafts
  are used in any real campaign, a human reviews them (the QA gate is a
  safety net, not a publish button).
- **Final message approval** -- every draft is labeled
  `SIMULATION / DRAFT -- NOT SENT` and requires a human to actually send
  it, in the human's own name, on the human's own account.
- **Anything involving real outreach** -- this machine has no send
  capability at all, by design (see docs/architecture.md); a human does
  100% of any real sending, always.
