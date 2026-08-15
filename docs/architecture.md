# Architecture

## Pipeline

```
INPUT TARGETS (synthetic generator, or curated public_targets.json)
     |
DISCOVERY / ICP FILTER      growth_machine/icp.py       (deterministic scoring, see below)
     |
QUALIFICATION                score >= 50 AND >=1 document signal
     |
ENRICHMENT                   growth_machine/enrichment.py  (sourced signal records)
     |
PERSONA MAPPING               growth_machine/persona.py     (role + hedged certainty)
     |
PERSONALIZATION               growth_machine/personalization.py (signal -> pain -> capability -> line)
     |
OUTREACH DRAFT GENERATION     growth_machine/drafts.py      (3-message DRAFT-ONLY sequence)
     |
QUALITY / SAFETY CHECK        growth_machine/qa.py          (regex + hedging + marker checks)
     |
CAMPAIGN ARTIFACT             outputs/<batch>/outreach_drafts.md, campaign_summary.md
     |
MEASUREMENT + RUN LOG         growth_machine/measurement.py -> measurement.json
```

`growth_machine/pipeline.py` is the only module that has side effects
(writes files, mutates the measurement object); every other module is a
pure function over dataclasses. That separation is what makes
`run --batch run_002` behave identically to `run --batch run_001` on a
different input batch, with zero patching in between -- the code path
never changes, only the data flowing through it does.

## ICP scoring model

```
+25  recurring implementation / customer-onboarding motion
+20  customer-facing document workflow evidence (2+ document signals)
+15  evidence of professional services / high-touch or white-glove motion
+15  is a B2B SaaS (or SaaS-adjacent) company
+10  medium-or-larger, growing organization (50+ employees)
+10  3+ distinct customer-facing document workflows observed
+5   documentation-heavy operation (4+ document signals)

Max score: 100. Qualification threshold: score >= 50 AND >=1 document signal.
```

These weights are a starting hypothesis, not a validated model -- there is
no labeled outcome data to fit them against in a same-day synthetic
exercise. `docs/measurement.md` covers how this would be tightened with
real reply-rate data once a human runs an actual campaign.

## Two input modes

- **Synthetic mode (default).** `growth_machine/targets.py` generates a
  batch of obviously-fake companies (`*.example.com/.org/.net/.co`
  domains) from a seed derived from `--batch`, so `run_001` and `run_002`
  are guaranteed to contain different companies without manual
  intervention. ~25% of each batch is deliberately off-ICP (no document
  signals, self-serve motion) so the scorer has to actually discriminate.
- **Public mode (optional).** `growth_machine/public_targets.py` reads a
  human-curated `data/public_targets.json` of real company names/public
  facts and converts each row into the same shape the rest of the
  pipeline expects. If the file is missing, empty, or malformed, the
  pipeline falls back to synthetic mode automatically rather than
  failing -- this is tested in `tests/test_safety.py`.

## Safety design

- `growth_machine/cli.py` hard-codes `DRY_RUN = True` and
  `SEND_MESSAGES = False` as module constants -- not environment
  variables, not CLI flags. There is no code path to flip them.
- No function in the package sends HTTP POST requests, opens an SMTP
  connection, or calls any messaging API. `tests/test_safety.py` enforces
  this with a static-analysis test over every source file (looks for
  `send_message(`, `send_mail(`, `smtplib`, `requests.post`, etc.).
- Every generated draft is prefixed with `[SIMULATION / DRAFT -- NOT
  SENT]`, and the QA stage (`qa.py`) rejects any draft where that marker
  is missing.
- Personal names never enter the pipeline: `targets.py` only ever
  generates `Prefix + Suffix` company names from fixed word lists, and
  buyer identity is always a role from a fixed list (`_PERSONA_ROLES`),
  never a freeform name field.

## Why this shape, and what was cut

- **No frontend, no database, no auth, no Docker.** The task explicitly
  asks for depth on one channel over breadth of infrastructure; a CLI +
  JSON/Markdown output directory is enough to demonstrate the pipeline
  and is trivially rerunnable and diffable.
- **No paid enrichment API (Clay/Apollo-class).** The synthetic mode
  needs none, and the public mode is designed to consume data a human
  curator already gathered by hand -- adding a paid API would make the
  "no mandatory credentials" requirement harder to keep, for a
  same-day exercise where the marginal realism gain is small.
- **Regex-based QA checker, not an LLM-based one.** A deterministic,
  inspectable safety net (see the pattern list in `qa.py`) is easier to
  reason about and test than an LLM call would be for a same-day
  submission, and it never depends on an API key being present. A
  production version would likely add an LLM-based second-pass reviewer
  on top of this, not instead of it.
