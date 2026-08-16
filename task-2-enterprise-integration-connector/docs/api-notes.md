# SuperDocs API Notes — Sources

Every behavior this connector relies on is sourced here to a specific
page fetched from `docs.superdocs.app` on **2026-08-15**. Nothing in
`src/`, `connectors/workato/connector.rb`, or the recipes assumes a
detail that isn't traceable to one of these pages.

| Fact relied on | Source page |
|---|---|
| Base URL `https://api.superdocs.app` | `/account/api-keys` |
| Auth: `Authorization: Bearer sk_...` (or `lce_...` for org keys), identical scheme for REST and MCP | `/account/api-keys` |
| `GET /v1/sessions` is the cheapest way to verify a key works (no operations consumed); `/v1/users/me` rejects API keys with a misleading 401 | `/account/api-keys` |
| `POST /v1/chat` (sync) request/response shape, `document_html` load-once-then-persist behavior | `/concepts/documents`, `/concepts/sessions` |
| `POST /v1/chat/async` returns `{job_id, session_id, status:"pending"}` immediately | `/guides/async-jobs` |
| Job statuses: `pending`, `in_progress`, `awaiting_approval`, `completed`, `failed`, `cancelled` | `/guides/async-jobs` |
| Jobs (ALL statuses, including terminal) are auto-cleaned up 1 hour after creation | `/guides/async-jobs` |
| 30-minute hard wall-clock cap per chat turn (sync returns 504; async persists a friendly message as the job's AI response) | `/errors/error-codes` |
| `awaiting_approval` has two distinct flavours, told apart by `metadata.awaiting_kind`: `"continue_prompt"` (large-edit pause, no `pending_changes`) vs. otherwise = HITL change review (`metadata.pending_changes` populated) | `/guides/human-in-the-loop`, `/guides/async-jobs` |
| Calling `/approve` on a continue_prompt pause (or `/continue` on a change-review pause) is rejected with 409 | `/guides/human-in-the-loop` |
| `POST /v1/chat/{session_id}/approve` — the top-level `approved` field is **required on every request**, even full per-change batches; omitting it returns a generic 422 | `/guides/human-in-the-loop` (explicit worked "Incorrect" example) |
| Proposed-change shape: `change_id`, `operation` (`edit`\|`create`\|`delete`), `chunk_id`, `old_html`, `new_html`, `ai_explanation`, `insert_after_chunk_id` | `/guides/human-in-the-loop` |
| **Polling path**: `metadata.pending_changes` is already a plain parsed array — no extra parse needed | `/guides/human-in-the-loop` (Python polling example) |
| **SSE path**: `proposed_change_batch` event's `data.content` is a JSON-**encoded string** requiring a second `JSON.parse` — `const batch = JSON.parse(data.content)` | `/guides/human-in-the-loop` (JavaScript SSE example, verbatim) |
| `POST /v1/chat/{session_id}/continue` with `{job_id, continue: true|false}` for the large-edit continue-prompt flow | `/guides/async-jobs` |
| `POST /v1/jobs/{job_id}/cancel` — only `pending`/`in_progress` jobs can be cancelled | `/guides/async-jobs` |
| `POST /v1/documents/export` — 5 non-legacy formats: `docx` (default), `pdf`, `html`, `markdown`, `txt`; `doc` is a legacy alias the docs say new integrations should not use | `/concepts/documents#exporting-documents` |
| Export response is binary; errors are JSON `{"detail": ...}` | `/concepts/documents#exporting-documents` |
| `X-Export-Warnings` header: base64-encoded JSON array, always present alongside `Content-Disposition` | `/concepts/documents#exporting-documents` |
| Error body shape is always flat `{"detail": "..."}` | `/errors/error-codes` |
| Status code table: 400/401/403/404/409/410/413/415/422/429/500/504 meanings | `/errors/error-codes` |
| 429 has two distinct flavours: **application** (JSON body, always has `Retry-After`, sometimes `X-Usage-*` headers) vs. **infrastructure** (plain text, no `Retry-After` — traffic-surge throttle) | `/errors/rate-limits` |
| Retry-After should be honored as a floor; infra 429s should get exponential backoff + jitter | `/errors/rate-limits` |
| **No webhook / callback-registration endpoint exists anywhere in the documented API.** Confirmed by fetching the complete page index (`/llms.txt`) and finding no `/webhooks` path, no `webhook_url` field on any documented endpoint, and no mention of push notifications for job completion. The only async completion signals are: polling (`GET /v1/jobs/{id}`), SSE (`GET /v1/chat/{session_id}/stream`), org-only long-poll (`GET /v1/poll/{session_id}`), and email delivery (large-export jobs only). | `/llms.txt` (full index), `/guides/async-jobs`, `/guides/streaming`, `/guides/human-in-the-loop` |
| Latency-by-operation-type table (used to justify default `maxWaitMs`) | `/guides/async-jobs` |
| Server-side/no-UI integration pattern: sync `/v1/chat` for <~50pp docs, async+polling for larger ones, SSE "rarely needed for server-side" | `/guides/server-integration` |
| "Human-out-of-band" approval pattern (notification + later `/approve` call) for server integrations with no interactive UI | `/guides/server-integration` |
| No templates-specific "generate from template" endpoint exists; templates are referenced by the AI during a normal chat turn | `/concepts/templates`, `/concepts/documents` (cross-checked against the full `/llms.txt` index — no separate endpoint found) |

## Workato SDK conventions — sources

Fetched via web search of `docs.workato.com` (public documentation) on
2026-08-15; the real `workato-connector-sdk` gem itself could not be
installed in this sandbox (see `connectors/workato/VALIDATION.md`) so
these are documentation-verified, not gem-execution-verified.

| Convention used | Source |
|---|---|
| `connection.fields`, `connection.authorization.type: 'custom_auth'`, `apply: lambda { headers("Authorization": "Bearer #{connection['x']}") }` | `docs.workato.com/developing-connectors/sdk/guides/authentication/header-auth.html` |
| `actions.<name>.{title,subtitle,description,input_fields,execute,output_fields}` shape | `docs.workato.com/developing-connectors/sdk/sdk-reference/actions.html` |
| `retry_on_response`, `retry_on_request`, `max_retries` action-level keys | `docs.workato.com/developing-connectors/sdk/sdk-reference/actions.html` |
| `error("message")` raises a typed job error with a custom message | `docs.workato.com/developing-connectors/sdk/guides/error-handling.html` |
| `after_error_response(/.*/) { |code, body, header, message| error("...") }` chained onto `get`/`post` | `docs.workato.com/developing-connectors/sdk/guides/advanced-connector-guide/connector-building-building-actions.html` |
| SDK actions have a **180-second execution timeout** (directly informs why `edit_by_instruction` always uses the async endpoint + a separate poll action/trigger rather than blocking) | `docs.workato.com/developing-connectors/sdk/guides/advanced-connector-guide/connector-building-building-actions.html` |
| Polling trigger shape: `poll: lambda { |connection, input, closure, _eis, _eos| ... { events:, next_poll:, can_poll_more: } }`, `dedup: lambda { |record| ... }` | `docs.workato.com/developing-connectors/sdk/guides/building-triggers/poll.html` |
| Trigger limits: 1,000 events per poll, 600 consecutive empty polls before a 5-minute throttle | `docs.workato.com/developing-connectors/sdk/guides/trigger-limit.html` |
| `object_definitions` shared-schema pattern, referenced from `output_fields` | `docs.workato.com/developing-connectors/sdk/guides/advanced-connector-guide/connector-building-defining-schema.html` |
| Extension/repository conventions (`extensions/<github-username>/<project-name>/`, PR requirements) | `github.com/superdocsapp/superdocs-builds` `CONTRIBUTING.md` (fetched directly, this project's own repo) |
