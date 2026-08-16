# PROGRESS.md

Chronological decision log. Only records things that actually happened
during this build.

---

**Discovery:** Cloned `github.com/superdocsapp/superdocs-builds` to
inspect existing conventions per Phase 0. Found `extensions/` and
`use-cases/` both contain only a placeholder `README.md` each — **zero
prior contributions exist** (3 commits total in the repo's history, all
initial scaffolding, no merged PRs). This directly changes the
assignment's Phase 0 instructions #3-#10 (find existing
connector/auth/action/trigger/polling/callback/schema/error/retry/test
examples to mirror) — there is nothing to mirror. Only CONTRIBUTING.md's
folder-naming rule (`extensions/<github-username>/<project-name>/`) was
available as a real convention.

**Discovery:** Fetched `docs.superdocs.app/llms-full.txt` and
`/llms.txt` (a complete page index) plus several individual pages
(`/account/api-keys`, `/guides/human-in-the-loop`, `/guides/async-jobs`,
`/errors/rate-limits`, `/guides/server-integration`). Confirmed the real
base URL (`https://api.superdocs.app`), auth scheme (`Authorization:
Bearer sk_...`/`lce_...`), full error status-code table, job lifecycle
states, and — critically — **confirmed there is no webhook/callback
endpoint anywhere in the documented API surface** by checking the
complete page index for any `/webhooks` path or `webhook_url` field and
finding none. This directly contradicts what the assignment's Phase 5
implicitly hoped for ("if SuperDocs supports callbacks/webhooks, use
callback/webhook behavior") — it doesn't, so the connector's "callback
pattern" is implemented as a Workato-side polling trigger instead. See
`docs/architecture.md` for why this is the honest equivalent, not a
compromise dressed up as the real thing.

**Discovery (important, changes Operation A's design):** There is no
dedicated "generate from template" endpoint in the SuperDocs API.
Templates (`POST /v1/templates/upload`, `GET /v1/templates`) are a
separate concept the AI references during a normal chat turn — there's
no "instantiate this template with this data" request/response shape.
**Assumption made and documented** (rather than inventing a fake
endpoint): `generateFromTemplate` is implemented as a `/v1/chat` (or
`/v1/chat/async`) call whose message references the template by name and
serializes the substitution data into the instruction text. This is
recorded here and in the operation module's own header comment, per the
"document the assumption, never silently invent a contract" instruction.

**Discovery (verified, not assumed):** The docs' own worked example for
the SSE `proposed_change_batch` event shows `const batch =
JSON.parse(data.content)` — i.e., `data.content` is a JSON-encoded
STRING requiring a second parse, exactly as the assignment's brief
described. Verified this is SSE-specific: the polling path
(`metadata.pending_changes` via `GET /v1/jobs/{id}`) is already a plain
parsed array in the same docs page's Python example. Implemented
`parsePendingChanges({source, raw})` to branch explicitly on which path
produced the data, rather than trying to infer it from the value's shape
— see `src/operations/submitForApproval.js`.

**Discovery (verified, not assumed):** The human-in-the-loop docs page
includes an explicit worked "Incorrect" example showing that
`POST /v1/chat/{session_id}/approve` requires a top-level `approved`
field even when every entry in a `changes` batch carries its own
`approved` — omitting it returns a generic, unhelpful 422. Built this
into `submitForApproval` structurally (the function signature requires
an explicit `defaultApproved: boolean` and always includes it in the
request) so a connector caller cannot hit this specific documented trap.

**Decision:** Chose to target exactly ONE integration platform (Workato)
concretely, rather than writing shallow, unverifiable "conceptual" code
for all four named platforms (Workato/Tray/Boomi/MuleSoft).
**Why:** Checked what's actually installable in this build's sandbox:
Ruby is not pre-installed (though it turned out `apt-get install ruby`
does work — see below), and `rubygems.org` is blocked by the sandbox's
network egress policy (confirmed: `403`, `x-deny-reason:
host_not_allowed`). Boomi and MuleSoft connector tooling is Java-based
and their artifact repositories are also outside the sandbox's allowed
network list. Tray's connector builder is a proprietary web IDE with no
offline SDK at all. None of the four platforms' real tooling is fully
usable here — so the honest choice was to go deep on one, verified
against real public documentation, rather than shallow on four.
**Alternative considered:** Writing all four as "conceptual" pseudocode
with no verification at all — rejected because the assignment explicitly
forbids inventing connector SDK syntax, and unverified pseudocode for
four platforms would violate that four times over instead of once.
**Why Workato specifically:** its SDK conventions are the most
thoroughly documented in public, freely-fetchable pages
(`docs.workato.com`), giving the best chance of genuinely correct,
citable code.

**Discovery (updates the above):** `apt-get install ruby` actually
succeeded in this sandbox (`archive.ubuntu.com`/`security.ubuntu.com`
are reachable even though `rubygems.org` is not) — Ruby 3.2.3 is
available. This meant `connector.rb` could be validated with a REAL
`ruby -c` syntax check (passed) and actually `eval`'d as a Ruby hash to
confirm its top-level structure. It also allowed building a stub-based
smoke-test harness (`connectors/workato/smoke_test.rb`) that calls every
action's `execute` lambda and the trigger's `poll`/`dedup` lambdas
against canned fake HTTP responses — genuinely running the connector's
own Ruby logic, not just parsing it. What remains unvalidated is
specifically the real `workato-connector-sdk` gem itself (still blocked
by the rubygems.org restriction) — see `connectors/workato/VALIDATION.md`
for the precise, honest boundary between what was and wasn't proven.

**Discovery (caught by the smoke test, then fixed):** The first version
of `smoke_test.rb` failed with `NoMethodError: undefined method
'present?'` — this is because `.present?`/`.blank?`/`.presence` are
ActiveSupport (Rails) extensions that Workato's real runtime provides,
not core Ruby. This confirmed `connector.rb` itself was written
correctly (using real, documented Workato conventions that do rely on
ActiveSupport being available — verified against the docs' own examples,
e.g. `1.hours.ago`, `.blank?` used freely in Workato's official trigger
guide) — the bug was in the harness, not the connector. Fixed by adding
a minimal, clearly-labeled ActiveSupport-compatible shim to the harness
itself (see the harness file's header comment for exactly what it does
and doesn't prove).

**Decision:** Used plain JavaScript with JSDoc type annotations for
`src/` instead of TypeScript.
**Why:** Avoids a build step entirely — `node --test` runs the source
directly, which means every test result reported in this project is
runnable by anyone who clones the repo with zero setup beyond `npm
install` (which installs nothing, since there are no runtime
dependencies). TypeScript would have required either committing compiled
output or requiring `tsc` as a build dependency for no functional gain
given the project's size.
**Trade-off:** Type-checking is advisory (JSDoc + editor tooling) rather
than enforced at a build step. Acceptable for this project's size; would
reconsider for a larger connector surface.

**Decision:** `editByInstruction` always uses `/v1/chat/async`, never the
synchronous `/v1/chat` endpoint.
**Why:** Workato SDK actions have a documented 180-second execution
timeout (verified against `docs.workato.com`'s advanced connector-building
guide) — well under SuperDocs' own 30-minute per-turn cap. Blocking
synchronously risks the CONNECTOR timing out even when SuperDocs itself
would eventually have finished. `generateFromTemplate` offers both modes
(sync by default, since template generation is typically small/fast per
its own recipe usage in Recipe 1) because it's a genuinely different
usage profile than an arbitrary, potentially large edit instruction.

**What was cut (scope discipline, per Phase 14 "no unnecessary
complexity"):**
- Recipe 2's step 4 (human notification/decision-capture) is written as
  an illustrative placeholder, not a concrete implementation — the real
  mechanism is entirely host-org-specific (Slack buttons, an internal
  approval queue, etc.) and building an opinionated version of it is
  outside this connector's actual scope.
- Idempotency keys: SuperDocs has no documented idempotency-key
  mechanism (checked — not present anywhere in the fetched docs). Rather
  than inventing one, the connector documents session-id reuse as the
  practical alternative (see README "Idempotency") and is explicit that
  this is a documented limitation, not a solved problem.
- Tray, Boomi, and MuleSoft adapters were not built — see the "one
  platform, built for real" decision above.

**What remains for a human to do before this PR is opened:**
1. Replace the `YOUR_GITHUB_USERNAME` placeholder folder name with the
   real GitHub handle (not available in this build session — see README
   "Known limitations" and TASK.md).
2. Run `connectors/workato/VALIDATION.md`'s steps 1-4 against the real
   `workato-connector-sdk` gem on a machine with rubygems.org access.
3. Manually verify the connection test and each action's datapills
   render correctly in a real Workato sandbox account.
