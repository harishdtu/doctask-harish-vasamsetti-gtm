# PROGRESS.md

Chronological decision log for Task 1. Only decisions actually made
during this build are recorded here.

---

**Decision:** Chose "Implementation and Customer Success teams at B2B
SaaS companies with recurring document workflows" as the audience,
following the strategy specified in the task brief rather than inventing
a different one.
**Why:** The brief itself narrows toward this audience and gives a clear
hypothesis (manual document editing is the pain, in-place AI editing is
the fix) that's specific enough to be wrong and defend, per "What
separates a strong machine."
**Alternative considered:** A broader "all SaaS companies" audience --
rejected explicitly by the brief ("Do NOT target 'all SaaS companies'")
and also just weaker: too vague to name ten of credibly.
**Trade-off:** Narrower audience means a smaller theoretical TAM per
batch, but a much higher hit rate on personalization quality, which
matters more for a small-scale demo than breadth does.

---

**Decision:** Built one channel (outbound) properly rather than sketching
several channels (content, community, product loop).
**Why:** The brief states "One channel built properly beats three
channels sketched," and outbound is the channel most directly matched to
the audience's day-to-day (they don't browse a content feed looking for
document tooling, but they do read a short, well-targeted email).
**Alternative considered:** A content/SEO machine targeting the same
audience -- rejected for this round because it would take much longer to
show a real "piece" (content needs to actually rank to prove anything;
an outbound draft can be evaluated for quality immediately).
**Trade-off:** Outbound requires the strictest safety handling of any
channel (real risk of contacting real people) -- so safety design got
disproportionate engineering time relative to the rest of the pipeline,
which was the right trade for this brief.

---

**Decision:** Defaulted to fully synthetic targets (`*.example.com`
domains) rather than building the public-company mode as the primary
path.
**Why:** The task explicitly allows made-up prospects, and doing so keeps
the demo runnable with zero external dependencies and zero risk of
public-mode enrichment accidentally treating a real person's name as a
"role." Public mode is still implemented (`public_targets.py`) as an
optional, human-curated path.
**Alternative considered:** Defaulting to public mode with a small
hand-curated list of ~10 real companies -- considered, but building it
correctly (with a human genuinely reading each company's public pages)
was more time than a same-day build could responsibly spend while also
covering the mandated two-full-runs, tests, and docs. Left as a
documented limitation, not hidden.
**Trade-off:** The demo runs are less "real-world impressive" than 10
named real companies would be, but the pipeline code is identical either
way, and the honesty of "this is synthetic, here's exactly how the real
version would work" was judged more valuable than a thin, undercooked
real-company pass.

---

**Decision:** Used a deterministic, regex-based QA/safety checker instead
of an LLM-based one.
**Why:** No mandatory API key/credential is allowed, and a deterministic
checker is fully inspectable and unit-testable in a way an LLM call
inside a QA gate wouldn't be for this exercise.
**Alternative considered:** An LLM-based safety reviewer -- would likely
catch more subtle issues (e.g. a personalization line that's technically
pattern-clean but still overclaims), but adds an optional-credential
dependency the task says to avoid making mandatory.
**Trade-off:** The current QA gate will pass some things a stricter human
or LLM reviewer would flag; documented explicitly in
`docs/measurement.md` under "Where the machine leaks" rather than
claimed as a solved problem.

---

**Decision:** Made `document_signals` empty (not a separate "off-ICP
signal list" counted as if positive) for deliberately off-ICP synthetic
companies.
**Why:** Caught while testing: the first implementation counted off-ICP
description phrases (e.g. "no public evidence of implementation work")
as if they were positive document-workflow signals, which pushed
qualification rate to 100% -- an unrealistic funnel that would have
hidden whether the ICP scorer discriminates at all.
**What changed after testing:** Fixed by making off-ICP targets carry
`document_signals=[]` and a motion type (`self-serve`,
`product-led-growth`, `unknown`) outside the qualifying motion set.
Qualification rate dropped to a realistic 73-75% band across both runs,
which is the number reported in `docs/run-report.md`.

---

**Decision:** Rewrote the "likely objection" field so Draft 2's follow-up
message reads naturally instead of embedding the objection-handling
clause inside the objection text itself.
**Why:** Caught by re-reading the first generated `outreach_drafts.md`:
the sentence "'X' -- addressed by Y. is the most common reaction..." was
grammatically broken because the objection field originally included its
own resolution.
**What changed after testing:** Split `persona.likely_objection` down to
the bare objection phrase; the resolution now lives only in
`drafts.py`'s Draft 2 template, which reads correctly.

---

**Decision:** Scoped this task strictly to Task 1 (growth machine only),
per the uploaded task document's own instruction: "Your job is to build,
test, run, verify, document, and package Task 1 only. Do not work on
Task 2, Task 3, Task 4... yet."
**Why:** Explicit instruction in the source document driving this build.
**What was cut:** Tasks 2-4 (assigned engineer build, use-case mapping,
demo video/write-up) are out of scope for this repository state and are
tracked separately, not started here.

---

**Decision (correction pass):** Replaced `abs(hash(batch_id)) % (2**32)`
with a `hashlib.sha256`-based seed derivation in `targets.py`.
**Why:** Python's built-in `hash()` on strings is randomized per process
(`PYTHONHASHSEED`) unless explicitly disabled, which meant `--batch
run_001` could silently produce a *different* company set on a different
process invocation -- undermining the whole point of the batch id being
reproducible. Caught during a review pass, not by a failing test (no test
had exercised a second Python process before this).
**What changed after testing:** Added
`tests/test_unit.py::test_batch_seed_stable_across_processes`, which
spawns two subprocesses with different `PYTHONHASHSEED` values and
asserts identical output for the same `--batch` id.

**Decision (correction pass):** Made cross-batch name disjointness
deterministic by construction instead of merely probable.
**Why:** The original per-target `rng.choice(prefix)/rng.choice(suffix)`
approach meant two independently-seeded batches *could* coincidentally
draw the same company name, especially as batch counts grow relative to
the ~450-combination name space -- a real (if small) chance of failing
exactly the guarantee the task cares about most. Replaced with a fixed,
pre-shuffled name space partitioned into non-overlapping "lanes" keyed by
a hash of the batch id, so two different batch ids provably cannot share
a name as long as each batch's lane isn't exceeded.
**What changed after testing:** `tests/test_e2e.py` now asserts
`t1.isdisjoint(t2)` directly (previously only `assertNotEqual`, which
didn't actually prove zero overlap). Verified computationally that
`run_001`, `run_002`, and every batch id used elsewhere in this repo
(`e2e_run_a/b`, `clonecheck`, `fresh_verification`, etc.) land in distinct
lanes.

**Decision (correction pass):** Removed the claim that SuperDocs has
"review mode on by default" from generated draft copy and from the
`persona.py` capability mapping for "customer success runbooks".
**Why:** That specific default-on claim was not verified against
SuperDocs' own documentation, and the task is explicit that generated
copy must never outrun what's verifiably true of the product today.
**What changed after testing:** Draft 2's wording now says only that
SuperDocs edits inside the document (verified, general capability) and
that "a human should still review anything customer-facing before it
goes out" (a recommended practice, not a claim about a specific default
product setting). The "customer success runbooks" persona capability
mapping now leads with in-document AI editing as the primary value,
with human review framed as a safety step rather than the headline
capability. `run_001` and `run_002` were regenerated afterward so no
stale copy of the old claim remains in committed output.

**Decision (correction pass):** Removed all `__pycache__/` and `*.pyc`
files from the working tree before final packaging.
**Why:** `.gitignore` already excludes them from being tracked, but they
had accumulated in the local working directory from running tests/CLI
commands, and an explicit correction request flagged that the *packaged
tarball* (not just git) must not contain them either.
**What changed after testing:** Confirmed via `git ls-files` (nothing
tracked) and a `find` sweep of the working tree (nothing present) before
the final tarball was rebuilt.
