# Architecture

## Layering

```
connectors/workato/connector.rb   <- platform adapter (Ruby, Workato SDK)
        |
        | thin wrapper: input_fields -> operation call -> output_fields
        v
src/operations/*.js               <- platform-agnostic operation logic
        |
        v
src/client.js (SuperDocsClient)   <- typed HTTP client (auth, endpoints)
        |
        v
src/retry.js + src/errors.js      <- retry contract + typed error model
        |
        v
   SuperDocs REST API (api.superdocs.app)
```

The platform adapter is intentionally thin: it converts Workato's
`input_fields` hash into the operation module's typed input, calls the
operation, and converts the result back into `output_fields`. All actual
business logic (validation, retry, error classification, the
proposed-changes double-parse handling) lives in `src/`, which is fully
tested independent of any platform — see `tests/`. This means a future
Boomi, MuleSoft, or Tray adapter would be a similarly thin wrapper around
the same `src/` logic, not a reimplementation.

## Request flow — synchronous path (Recipe 1)

```mermaid
sequenceDiagram
    participant R as Recipe (Workato)
    participant C as Connector (src/)
    participant S as SuperDocs API

    R->>C: generate_from_template(template_name, data)
    C->>S: POST /v1/chat {message, session_id}
    S-->>C: 200 {document_changes.updated_html}
    C-->>R: {status: "completed", document_html}
    R->>C: fetch_export(session_id, format: pdf)
    C->>S: POST /v1/documents/export
    S-->>C: 200 (binary PDF bytes)
    C-->>R: {file_base64, filename, format}
```

## Request flow — asynchronous + HITL path (Recipe 2)

```mermaid
sequenceDiagram
    participant R as Recipe (Workato)
    participant C as Connector (src/)
    participant S as SuperDocs API
    participant H as Human reviewer

    R->>C: edit_by_instruction(instruction, approval_mode: ask_every_time)
    C->>S: POST /v1/chat/async
    S-->>C: 202 {job_id, status: pending}
    C-->>R: {job_id, status: pending}

    loop Polling trigger (Workato scheduler, not the recipe worker)
        C->>S: GET /v1/jobs/{job_id}
        S-->>C: {status: in_progress}
    end
    C->>S: GET /v1/jobs/{job_id}
    S-->>C: {status: awaiting_approval, metadata.pending_changes}
    C-->>R: awaiting_change_review event

    R->>H: notify (synthetic Slack/email step)
    H-->>R: approve/deny decisions

    R->>C: submit_for_approval(job_id, approved, changes)
    C->>S: POST /v1/chat/{session_id}/approve
    S-->>C: {status: in_progress}

    loop Polling trigger again
        C->>S: GET /v1/jobs/{job_id}
    end
    S-->>C: {status: completed}
    C-->>R: completed event
    R->>C: fetch_export(session_id, format: docx)
```

## Async/callback design — the honest version

```mermaid
flowchart TD
    A[Recipe starts SuperDocs operation] --> B{POST /v1/chat/async}
    B --> C[job_id returned immediately]
    C --> D[Workato polling trigger:\nGET /v1/jobs/job_id on Workato's\nown schedule]
    D --> E{status?}
    E -->|pending / in_progress| D
    E -->|completed| F[Trigger fires event\nrecipe resumes]
    E -->|failed| G[Trigger fires event\nrecipe branches to error handling]
    E -->|cancelled| H[Trigger fires event\nrecipe branches to cancellation handling]
    E -->|awaiting_approval,\nawaiting_kind=continue_prompt| I[Trigger fires event\nrecipe calls /continue]
    E -->|awaiting_approval,\notherwise| J[Trigger fires event\nrecipe calls /approve]
    I --> D
    J --> D

    style D fill:#333,color:#fff
```

**SuperDocs has no webhook/callback-registration endpoint** (verified —
see `docs/api-notes.md`). The box above labeled "Workato polling
trigger" is what actually satisfies "long-running operations use
callbacks/webhooks rather than blocking workers": Workato's own
scheduler does the waiting, off the recipe's execution thread, and the
recipe only re-enters when there's a real state change — the same
externally-observable effect a webhook would produce, built on the
mechanism SuperDocs actually offers (polling), not a fabricated one.

## Retry / error path

```mermaid
flowchart TD
    A[HTTP request] --> B{Response}
    B -->|2xx| Z[Return parsed result]
    B -->|Network failure| C[classifyNetworkError]
    B -->|4xx/5xx| D[classifyHttpError]
    C --> E{retryable?}
    D --> E
    E -->|No: 400/401/403/404/409/410/413/415/422/504| F[Throw immediately\nno retry]
    E -->|Yes: 429/500/502/503/network| G{attempts < maxRetries?}
    G -->|No| F
    G -->|Yes| H[computeBackoffMs\nRetry-After floor, else\nexponential + full jitter]
    H --> A
```

## Folder layout

```
extensions/<github-username>/superdocs-enterprise-connector/
├── README.md
├── TASK.md
├── PROGRESS.md
├── docs/
│   ├── architecture.md        <- this file
│   └── api-notes.md           <- source citations for every API fact relied on
├── package.json                <- zero runtime deps, node:test only
├── src/                         <- platform-agnostic core (tested)
│   ├── client.js
│   ├── errors.js
│   ├── retry.js
│   ├── schema.js
│   ├── index.js
│   └── operations/
│       ├── generateFromTemplate.js
│       ├── editByInstruction.js
│       ├── submitForApproval.js
│       ├── pollForCompletion.js
│       └── fetchExport.js
├── tests/                       <- 83 passing tests, mocked HTTP, no live API key
│   ├── errors.test.js
│   ├── retry.test.js
│   ├── client.test.js
│   ├── operations.test.js
│   ├── second-run.test.js       <- two distinct fixtures, same code path
│   ├── fixtures/
│   ├── mocks/
└── connectors/
    └── workato/
        ├── connector.rb         <- the actual platform adapter
        ├── smoke_test.rb        <- stub-based lambda smoke test (real Ruby)
        ├── VALIDATION.md        <- honest validated-vs-not breakdown
        └── recipes/
            ├── recipe-1-template-to-export.md
            ├── recipe-2-edit-approve-export.md
            └── recipe-3-event-driven-callback.md
```
