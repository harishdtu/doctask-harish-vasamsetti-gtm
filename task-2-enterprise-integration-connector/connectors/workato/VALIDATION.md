# Validation Status — Workato Connector

## What WAS validated (real tools, real results, reproducible)

1. **Ruby syntax.** `ruby -c connector.rb` → `Syntax OK`, using a real
   Ruby 3.2.3 interpreter installed in the build sandbox (`apt-get install
   ruby`, which succeeded — `archive.ubuntu.com`/`security.ubuntu.com`
   were reachable even though `rubygems.org` was not; see below).

2. **Hash-literal structure.** `connector.rb` was `eval`'d as plain Ruby
   and confirmed to produce a `Hash` with exactly the top-level keys
   Workato's SDK expects (`title`, `connection`, `test`,
   `object_definitions`, `actions`, `triggers`), 5 actions matching the
   assignment's 5 required operations, and 1 polling trigger.

3. **Lambda execution (real Ruby, stubbed SDK helpers).**
   `smoke_test.rb` in this folder stubs just enough of the SDK's DSL
   (`get`, `post`, `headers`, `error`, and the chainable
   `.payload`/`.after_error_response`/`.response_format_raw`, plus a
   minimal ActiveSupport-compatible `present?`/`blank?`/`presence` shim —
   see the file's header comment for exactly why that shim is needed and
   what it does and doesn't prove) and then actually **calls** every
   action's `execute` lambda and the trigger's `poll`/`dedup` lambdas
   against representative canned data. Run:

   ```bash
   ruby connectors/workato/smoke_test.rb
   ```

   Result at last run: **all checks passed** — every action executes
   without a Ruby runtime error and returns the shape its `output_fields`
   declares; the poll trigger correctly emits an event on first poll,
   suppresses a duplicate event when status hasn't changed, and sets
   `can_poll_more: false` once a job reaches a terminal state.

   This caught one real bug during development (the smoke harness's own
   missing `present?`/`blank?` shim, not a connector.rb bug — see the
   harness file header) and would have caught a real connector.rb bug of
   the same *shape* (wrong method name, wrong arity, wrong hash key) had
   one existed.

## What was NOT validated (and why)

**The actual `workato-connector-sdk` gem was not installed, and
`workato exec` / `workato push` were never run.**

- Ruby itself installs fine via `apt-get` (`archive.ubuntu.com` and
  `security.ubuntu.com` are reachable in this sandbox).
- `rubygems.org` is **not** reachable — a direct request returns
  `403` with `x-deny-reason: host_not_allowed` from this environment's
  network egress proxy. `gem install workato-connector-sdk` therefore
  cannot complete here.

This means the following are **unverified by the real tooling**, even
though the smoke test above gives meaningful (not zero) confidence:

- Whether Workato's actual `retry_on_response` / `retry_on_request` /
  `max_retries` wiring behaves exactly as this connector assumes under
  real HTTP retries (verified only against the documented SDK reference,
  not executed against the real gem).
- Whether the connection/authorization block renders correctly in
  Workato's real recipe-editor UI.
- Whether `object_definitions` resolve correctly through Workato's real
  schema-merging logic inside `output_fields`.
- Real poll-interval scheduling behavior (the smoke test calls `poll`
  directly with hand-constructed closures; it does not exercise
  Workato's actual scheduler).
- Whether this connector would pass Workato's own connector
  certification/marketplace review.

## What the person running this next should do

1. Install the gem on a machine with rubygems.org access:
   ```bash
   gem install workato-connector-sdk
   ```
2. From this folder:
   ```bash
   workato new .                       # if not already scaffolded as a project
   workato exec connector.rb           # or the CLI's per-lambda exec commands
   ```
3. Push to a Workato sandbox account and manually verify:
   - The connection test succeeds against a real SuperDocs API key.
   - Each action appears with correctly-typed input/output datapills in
     the recipe editor.
   - The polling trigger fires an event when a real SuperDocs job's
     status changes.
4. Update this file with the real gem's validation output once run.

## Bottom line

This connector's **API contract** (endpoints, request/response shapes,
error codes, retry rules) is verified against SuperDocs' real,
documented REST API — see `docs/api-notes.md`. Its **Ruby syntax and
lambda logic** are verified with real Ruby and a representative smoke
test. What remains unverified is specifically **Workato-platform-runtime
behavior** that only the real gem or the live platform can confirm — a
disclosed, concrete sandbox limitation (no rubygems.org access), not an
assumption papered over as fact.
