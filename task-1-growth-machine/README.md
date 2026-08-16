# growth_machine

Built for the SuperDocs Round 2 GTM / Growth Engineer task, Task 1 only.

**Safety first, in one line:** this machine never sends anything to
anyone. It reads synthetic or human-curated public data and writes draft
files to disk. Nothing here has a send function. See "How safety works"
below and `tests/test_safety.py`.

## 1. What this machine does

Given a batch of B2B SaaS companies (synthetic by default, or a curated
public list), it scores each one against a documented ICP model,
enriches qualified companies with sourced signals, maps each to a likely
buyer role, writes a personalized 3-message outbound draft sequence for
the strongest fits, runs every draft through a safety/quality gate, and
reports honest funnel measurement. It runs twice on different batches
with zero manual changes in between.

## 2. Who the audience is

Implementation and Customer Success leads at mid-size (50-500 employee)
B2B SaaS companies running a high-touch/hybrid onboarding motion, who
repeatedly produce onboarding, implementation, configuration,
proposal/SOW, and rollout documents. Full detail: `docs/audience.md`.

## 3. Why this audience was selected

They have a document-editing pain that's specific, describable, and
directly matched to what SuperDocs does (AI edits land inside the
document itself, not in a separate chat window). See `docs/audience.md`
and the decision log in `PROGRESS.md`.

## 4. How the machine works

```
targets -> ICP filter -> qualification -> enrichment -> persona mapping
  -> personalization -> draft generation -> QA/safety gate
  -> campaign artifact -> measurement
```
Full pipeline design, ICP scoring formula, and module map:
`docs/architecture.md`.

## 5. How to install it

Requires Python 3.10+. No external packages, no paid API, no backend, no
mandatory credentials.

```bash
git clone <this-repo>
cd doctask-harish
python3 -m unittest discover -s tests -v   # optional: verify first
```

## 6. How to run it

```bash
python3 -m growth_machine run --batch run_001 --count 12
```

Output goes to `outputs/run_001/` by default. Start with
`outputs/run_001/campaign_summary.md`.

## 7. How to run a fresh batch

```bash
python3 -m growth_machine run --batch run_002 --count 15
```

Each `--batch` id seeds a different synthetic company set automatically
-- no manual patching required. See `docs/run-report.md` for the actual
two-run repeatability check (0 company overlap between `run_001` and
`run_002`).

Optional public-company mode (curated real companies, human-provided
facts only):

```bash
python3 -m growth_machine run --batch public_001 --input data/public_targets.json
```

If `data/public_targets.json` is missing or empty (it ships empty by
default), the machine automatically falls back to synthetic mode instead
of failing -- see `growth_machine/public_targets.py`.

## 8. Where outputs are created

```
outputs/<batch>/
  qualified_targets.json   -- every scored target + ICP reasoning
  enrichment.json          -- sourced signal records
  persona_mapping.json     -- role-only buyer hypotheses
  outreach_drafts.md       -- the strongest QA-passed draft sequences (THE piece)
  campaign_summary.md      -- funnel table for this run
  measurement.json         -- full measurement payload
outputs/latest-run/summary.md  -- demo-friendly walkthrough of both runs
```

## 9. How safety works

- `DRY_RUN=True` and `SEND_MESSAGES=False` are hard-coded constants in
  `growth_machine/cli.py`, printed at the top of every run. They are not
  configurable via flag or environment variable -- that's intentional.
- No module in this package contains a send-mail, send-message, SMTP, or
  outbound-HTTP-POST call of any kind. `tests/test_safety.py` statically
  scans every source file for this and fails the build if one appears.
- Every generated draft is prefixed `[SIMULATION / DRAFT -- NOT SENT]`;
  the QA gate (`growth_machine/qa.py`) rejects any draft missing that
  marker.
- Buyer identity is always a role (e.g. "Head of Customer Success"),
  never a real person's name, in both synthetic and public modes.
- No API key or secret appears anywhere in this repository;
  `.env.example` lists optional config *names* only.

## 10. What is synthetic versus public information

Default mode is 100% synthetic: company names are `Prefix + Suffix`
combinations (e.g. "Northstar Analytics") on `*.example.com/.org/.net/.co`
domains, generated fresh per batch. Public mode
(`--input data/public_targets.json`) would use real company names/public
facts a human curator supplies by hand -- it never scrapes, and it never
stores personal names, emails, or phone numbers (see
`growth_machine/public_targets.py`). The shipped `data/public_targets.json`
is intentionally empty; see `docs/audience.md` for how the first ten real
companies would actually be found (a manual research process, not
automated scraping).

## 11. What is not measured

Reply rate, meeting rate, and conversion rate -- because nothing here
sends anything. This is stated explicitly in every `campaign_summary.md`
and `measurement.json`. Full honest breakdown: `docs/measurement.md`.

## 12. Known limitations

- ICP scoring weights are a documented starting hypothesis, not
  validated against real outcome data (no such data exists yet).
- Public mode requires a human to curate `data/public_targets.json` by
  hand; there is no live scraping in this build.
- Personalization is template-based (signal -> pain -> capability -> line),
  not LLM-generated; it's honest and evidence-backed but less adaptive
  than an LLM-based pass would be.
- QA/safety checking is regex-based, which is fully inspectable and
  testable but will miss subtler issues an LLM-based or human reviewer
  would catch.
- Synthetic company name space (~450 Prefix+Suffix combinations) would
  start colliding well before 10x today's batch sizes.

Full "what breaks first at 10x" analysis: `docs/measurement.md`.

## 13. How the second run proves repeatability

`run_001` (12 inputs) and `run_002` (15 inputs) were both actually
executed, back to back, with no code changes or manual output edits in
between. Their qualified-company lists have **zero overlap**, and
qualification rate held in a consistent 73-75% band across both --
meaning the pipeline is producing a stable, non-random filter on new
data rather than being hand-tuned to one batch. Full numbers:
`docs/run-report.md`. This is also asserted programmatically in
`tests/test_e2e.py::test_two_fresh_batches_no_patching`.

---

## Repository layout

```
growth_machine/     the pipeline (pure functions + one orchestrator)
tests/               unit, safety, and end-to-end tests
docs/                audience.md, architecture.md, measurement.md, run-report.md
data/                public_targets.json (optional, empty by default)
outputs/             run_001/, run_002/, latest-run/summary.md
TASK.md              working contract
PROGRESS.md          chronological decision log
.env.example         optional config names only, no secrets
```

## Screenshot

For the Task 4 demo video, the most useful screen to capture is a
terminal running:

```bash
python3 -m growth_machine run --batch demo_run --count 12
```

followed by opening `outputs/demo_run/outreach_drafts.md` and
`outputs/demo_run/campaign_summary.md` in an editor. No credentials or
terminal secrets appear in that flow.
