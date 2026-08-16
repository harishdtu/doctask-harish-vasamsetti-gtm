# SuperDocs Enterprise Integration-Platform Connector

Built for the SuperDocs Round 2 Engineer Task 2 assignment: "Enterprise
integration-platform connector."

## 1. What this connector does

Exposes SuperDocs' document-editing workflow as typed, first-class
operations for an enterprise integration platform: generate a document
from a template, edit it by natural-language instruction, submit
human-approval decisions, poll a job to completion, and export the
finished file. Built as a platform-agnostic, fully-tested core (`src/`)
plus one concrete platform adapter (`connectors/workato/`).

## 2. Who it serves

Integration engineers at large companies standardized on enterprise
integration platforms (Workato, Tray, Boomi, MuleSoft) who need to wire
SuperDocs document actions into recipes/flows alongside their CRM, ERP,
ticketing, and storage systems — without hand-rolling HTTP calls, retry
logic, or polling loops themselves.

## 3. Supported platform

**Workato**, built concretely and verified as far as this sandbox
allowed (see "Validation" below). The core (`src/`) is platform-agnostic
by design — a Tray, Boomi, or MuleSoft adapter would be a similarly thin
wrapper around the same tested operation modules, not a reimplementation
— but only the Workato adapter was actually written for this submission.
**Why one platform instead of four:** see TASK.md "Constraints" and
PROGRESS.md for the concrete, disclosed sandbox limitations (no
Ruby/Java package-registry access) that made "one platform built
properly" the honest choice over "four platforms sketched."

## 4. Architecture

See `docs/architecture.md` for the full diagram set (layering,
synchronous flow, async/HITL flow, the callback-substitute design, and
the retry/error path).

## 5. Authentication

`Authorization: Bearer <api_key>`, where `api_key` is an `sk_...` (personal)
or `lce_...` (organization) SuperDocs API key — both use the identical
Bearer scheme (verified: `docs.superdocs.app/account/api-keys`). In the
Workato adapter, this is entered once per connection in Workato's own
credential UI and never touches this repository.

## 6. Setup

```bash
cd extensions/<github-username>/superdocs-enterprise-connector
npm test                                    # runs the full core test suite
ruby -c connectors/workato/connector.rb     # Ruby syntax check
ruby connectors/workato/smoke_test.rb       # lambda smoke test
```

No `npm install` step is needed for the core — zero runtime
dependencies (see `package.json`). The Ruby checks need a Ruby 3.x
interpreter (`apt-get install ruby` on Debian/Ubuntu); no gems required
for these two commands specifically.

## 7. Available operations

| Operation | Maps to | Sync/Async |
|---|---|---|
| Generate document from template | `POST /v1/chat` (sync) or `/v1/chat/async` | Either, caller's choice |
| Edit document by instruction | `POST /v1/chat/async` | Always async (see §9) |
| Submit approval decision | `POST /v1/chat/{session_id}/approve` | Sync |
| Check SuperDocs job status | `GET /v1/jobs/{job_id}` | Sync (single check) |
| New/updated SuperDocs job status (trigger) | Polls `GET /v1/jobs/{job_id}` on Workato's schedule | Async, platform-managed |
| Export document | `POST /v1/documents/export` | Sync (binary response) |

Every mapping above is sourced in `docs/api-notes.md`.

## 8. Input/output schemas

Full JSDoc-typed schemas live next to each operation in
`src/operations/*.js`. The Workato adapter's `input_fields`/
`output_fields` (and shared `object_definitions`) are hand-derived from
the same shapes — see `connectors/workato/connector.rb`.

## 9. Async/callback behavior

**SuperDocs has no webhook or callback-registration endpoint anywhere in
its documented API** — confirmed by fetching the complete page index
(`docs.superdocs.app/llms.txt`) and finding no `/webhooks` path, no
`webhook_url` field on any endpoint, and no push-notification mechanism
for job completion. The only asynchronous signals SuperDocs offers are
polling, SSE streaming, an org-only long-poll variant, and email
delivery for large exports.

Given that real constraint, this connector's "callback pattern" is
implemented as a **Workato polling trigger** (`new_or_updated_job_status`
in `connector.rb`): Workato's own scheduler polls `GET /v1/jobs/{id}` on
the recipe author's behalf, off the recipe's execution thread, and the
recipe only resumes when the job's status actually changes. This
achieves the assignment's real goal — a worker is never blocked waiting
on a long-running SuperDocs operation — through the mechanism SuperDocs
actually provides, rather than fabricating a webhook that doesn't exist.
See `docs/architecture.md` for the diagram.

`edit_by_instruction` always calls SuperDocs' async endpoint rather than
the synchronous one, specifically because Workato SDK actions have a
documented 180-second execution timeout — well under SuperDocs' own
30-minute per-turn cap — so blocking synchronously risks the connector
itself timing out.

## 10. Polling behavior

`src/operations/pollForCompletion.js` implements a bounded poll loop
(used directly by the core; the Workato adapter instead exposes a
single-check action plus the trigger described above, since a real
Workato action cannot sleep-loop within its own 180-second budget):

- Terminal states: `completed`, `failed`, `cancelled`.
- `awaiting_approval` is treated as a **paused, actionable** state, not
  terminal — and is split into two distinct sub-cases
  (`awaiting_change_review` vs. `awaiting_continue_decision`) based on
  the documented `metadata.awaiting_kind` field, because calling the
  wrong follow-up endpoint (`/approve` vs `/continue`) on the wrong kind
  of pause returns a 409.
- A client-side `maxWaitMs` (default 10 minutes) prevents an infinite
  loop, distinct from SuperDocs' own 30-minute per-turn cap.
- A 404 mid-poll is treated as SuperDocs' documented 1-hour job-cleanup
  behavior, not retried forever.

## 11. Retry policy

Retries **only**: `429` (both documented flavours), `500`, `502`, `503`,
and network-level failures. **Never retries**: `400`, `401`, `403`,
`404`, `409`, `410`, `413`, `415`, `422`, or `504` (a `504` means the
*same* request will time out again — the fix is to change the request
shape, e.g. switch to async, not to retry it unmodified).

Backoff: exponential with full jitter (`baseDelayMs * 2^attempt`,
uniform random in `[0, that value]`), capped at `maxDelayMs`, **except**
when the server supplies a documented `Retry-After` header, which is
honored as an exact floor instead. Default `maxRetries: 3` (4 total
attempts). See `src/retry.js` and its test suite for the exact contract.

## 12. Error contract

Every error is a typed `SuperDocsApiError` with `category`, `message`,
`retryable`, and `actionHint` (see `src/errors.js`). Categories:
`auth`, `authorization`, `validation`, `not_found`, `rate_limited`,
`transient_server`, `timeout`, `conflict`, `permanent`, `unknown`. Every
category answers the three questions the assignment asks for: what
happened, whether retrying is appropriate, and what the user should do
next (`actionHint` is always a concrete next step, never a repeat of the
error message).

## 13. Idempotency behavior

**SuperDocs has no documented idempotency-key mechanism** — checked
directly against the fetched docs; not present anywhere. This is a real
limitation, stated plainly rather than worked around with an invented
mechanism. The practical mitigation this connector uses: operations that
create/extend a document are always addressed by a caller-supplied
`session_id`, and re-running a recipe with the same `session_id` extends
the same SuperDocs session rather than creating an unrelated duplicate
document (see Recipe 1's "Idempotency note" for a concrete example).
This is session-reuse discipline, not true request-level idempotency —
if SuperDocs adds idempotency keys in the future, this connector should
be updated to use them instead.

## 14. Export formats

`docx` (default), `pdf`, `html`, `markdown`, `txt` — the five current,
non-legacy formats (verified: `docs.superdocs.app/concepts/documents`).
The legacy `doc` alias is deliberately never offered; the docs state new
integrations should use `docx` and that `doc` will be removed in a
future release.

## 15. Three reference recipes

- `connectors/workato/recipes/recipe-1-template-to-export.md` — sync
  generate → export, no human review (order confirmation letters).
- `connectors/workato/recipes/recipe-2-edit-approve-export.md` — the
  human-review boundary, explicit and unavoidable (contract redlining).
- `connectors/workato/recipes/recipe-3-event-driven-callback.md` — the
  async/polling-as-callback pattern for a genuinely long-running
  operation (full-document policy restructure).

All three use fabricated companies, documents, and data — no real
company or person appears anywhere in this project.

## 16. Testing

```bash
npm test
```

**83 tests, all passing, zero live API calls** (every HTTP interaction
is mocked — see `tests/mocks/mockFetch.js`). Coverage includes: every
documented error status code and its retry/non-retry classification,
the retry contract's backoff math and `Retry-After` handling, every
client method's endpoint path, the documented double-parse distinction
between polling and SSE proposed-changes, the full job-status state
machine (including the `continue_prompt` vs. change-review branch), a
client-side poll timeout, export binary handling and the
`X-Export-Warnings` header, and a dedicated **second-run test** that
runs the identical operation code path against two structurally
unrelated synthetic document fixtures (an invoice and an NDA) to prove
nothing is hard-coded to one demo case.

The Ruby connector additionally has `smoke_test.rb`, which stubs the
SDK's DSL helpers and actually calls every action's `execute` lambda and
the trigger's `poll`/`dedup` lambdas — see §17 "Validation" for exactly
what this does and doesn't prove.

## 17. Validation

See `connectors/workato/VALIDATION.md` for the complete, honest
breakdown. Summary: Ruby syntax (`ruby -c`), hash structure, and lambda
execution (via a stub harness) were all validated for real in this
build's sandbox. The actual `workato-connector-sdk` gem could not be
installed (`rubygems.org` is not reachable from this sandbox's network
egress policy — confirmed via a direct `403 host_not_allowed` response),
so `workato exec`/`workato push` against the real gem, and real Workato
platform-UI rendering, were **not** performed. **This connector does not
claim Workato certification** — only what was actually demonstrated.

## 18. Supported document formats

Input: whatever SuperDocs itself accepts for chat/session content (HTML
is the primary format this connector constructs and passes through).
Output/export: see §14. This connector does not itself handle raw
`.docx`/`.pdf` upload — that's the separate, unimplemented `POST
/v1/documents/upload` flow; see "Known limitations."

## 19. Known limitations

- Only one platform (Workato) has a concrete adapter; Tray/Boomi/
  MuleSoft do not (see §3).
- The real `workato-connector-sdk` gem was never run against this code —
  see §17.
- No idempotency-key support (SuperDocs doesn't offer one — see §13).
- `fetchExport`'s `html` input path and document-upload flows
  (`POST /v1/uploads`, pre-signed large-file upload) are not implemented
  — this connector's export operation only reads from an existing
  `session_id`, not arbitrary uploaded files.
- Recipe 2's human-notification step (§15) is illustrative, not a
  concrete implementation — the real mechanism is host-org-specific.
- The Workato adapter's `extensions/<username>/` folder currently uses
  the placeholder `YOUR_GITHUB_USERNAME` — see "Assumptions" below.
- Rate-limit quota exhaustion (monthly cap) is classified as
  `rate_limited`/retryable at the error-taxonomy level for consistency,
  but the `actionHint` explicitly warns that blindly retrying a
  month-long quota wait is not practical — a caller should branch on
  this specific case rather than trusting the generic retry loop.

## 20. Assumptions

1. **Folder path placeholder.** CONTRIBUTING.md requires
   `extensions/<your-github-username>/<project-name>/`; this build had
   no verified GitHub username available, so the folder is named
   `extensions/YOUR_GITHUB_USERNAME/superdocs-enterprise-connector/` —
   rename before opening the PR.
2. **"Generate from template" has no dedicated endpoint.** Implemented
   as a `/v1/chat` call referencing the template by name in the
   instruction text — see PROGRESS.md and
   `src/operations/generateFromTemplate.js`'s header comment for why.
3. **`awaiting_kind` for change-review is inferred, not a literal
   documented string.** The docs describe change-review as "otherwise"
   (the absence of `awaiting_kind: "continue_prompt"`), not as a named
   value — see `src/schema.js`'s comment on `AWAITING_KINDS`.

## 21. How to run locally

Covered in §6. There is no server to start — this is a library plus a
platform-connector file, not a standalone service.

## 22. How to validate/package the connector

See §17 and `connectors/workato/VALIDATION.md` for the exact remaining
steps (install the real gem elsewhere, `workato exec`, `workato push` to
a sandbox account) that a Ruby/rubygems-capable machine should run
before this connector is considered platform-certified.
