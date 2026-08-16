# TASK.md

## Assignment

"Enterprise integration-platform connector" — a SuperDocs connector
modeling document actions (generate from template, edit by instruction,
submit for approval, poll for completion, fetch export) as first-class
operations for an enterprise integration platform (Workato / Tray /
Boomi / MuleSoft), serving integration engineers at large companies
standardized on these platforms. Difficulty S3.

## Acceptance criteria (from the assignment)

- [x] Typed input/output schemas for every operation
- [x] Documented retry contract
- [x] Documented error contract
- [x] Callback pattern for long-running work — see "Constraint: no
      SuperDocs webhooks" below for what this means in practice
- [x] Three reference recipes covering common integration shapes
- [x] Tests that run without a live API key
- [x] Second-run proof (two distinct synthetic document fixtures)
- [x] No secrets anywhere in source, tests, README, or git history
- [x] README, architecture doc, TASK.md, PROGRESS.md

## Constraints

1. **Do not fabricate SuperDocs API contracts.** Every endpoint, request
   field, response field, and error code this connector relies on is
   sourced to a specific `docs.superdocs.app` page — see
   `docs/api-notes.md`. Anything not directly verifiable was either left
   out or explicitly flagged as an assumption (see PROGRESS.md).
2. **Do not fabricate connector-platform SDK syntax.** Workato DSL
   conventions (`input_fields`, `execute`, `retry_on_response`, the
   `poll`/`dedup` trigger shape, etc.) are sourced to `docs.workato.com`
   pages — see `docs/api-notes.md`.
3. **No webhook exists on the SuperDocs side.** Confirmed by fetching the
   complete documented API index. The "callback pattern" requirement is
   satisfied at the platform layer (a Workato polling trigger, not a
   recipe-level blocking loop) — see `docs/architecture.md` for exactly
   why this is the honest equivalent given what SuperDocs actually
   offers, not a claim that SuperDocs pushes events.
4. **One platform, built for real, rather than four platforms sketched.**
   The assignment names four candidate platforms (Workato/Tray/Boomi/
   MuleSoft). None of their real SDKs could be installed in this build's
   sandbox (Ruby/Java runtimes and rubygems.org/Maven access were not
   all available — see PROGRESS.md and `connectors/workato/VALIDATION.md`
   for exactly what was and wasn't possible). Workato was chosen as the
   single concrete target because its SDK is the most fully documented
   in the open, giving the best chance of genuinely correct, verified
   code rather than four shallow, unverifiable stubs.

## Implementation plan (as executed)

1. Inspect the actual `superdocs-builds` repo (clone, read
   CONTRIBUTING.md, check for existing extensions) — found zero prior
   contributions, so no existing conventions to mirror beyond
   CONTRIBUTING.md's folder-naming rule.
2. Inspect the real SuperDocs API via `docs.superdocs.app` (llms.txt /
   llms-full.txt + targeted page fetches) — endpoints, auth, error
   model, job lifecycle, HITL approval shape, export formats, rate
   limits, and confirm/deny webhook support.
3. Build a platform-agnostic, fully-tested core (`src/`) implementing
   the 5 required operations against the real, documented API.
4. Research real Workato SDK conventions and build one concrete,
   verified platform adapter (`connectors/workato/connector.rb`).
5. Validate what's realistically validatable in this sandbox (Ruby
   syntax, hash structure, stub-harness lambda execution) and document
   precisely what's NOT validated (the real gem) and why.
6. Write three reference recipes demonstrating sync, HITL, and
   async/polling-as-callback patterns.
7. Write README, architecture doc, and this file; keep PROGRESS.md
   updated with real assumptions and discoveries as they happened.

## Run commands

```bash
cd extensions/<github-username>/superdocs-enterprise-connector
npm test                              # 83 tests, mocked HTTP, no API key needed
ruby -c connectors/workato/connector.rb        # Ruby syntax check
ruby connectors/workato/smoke_test.rb          # lambda smoke test (stubbed SDK)
```

## Expected artifacts

See `docs/architecture.md` "Folder layout" for the complete file tree.
