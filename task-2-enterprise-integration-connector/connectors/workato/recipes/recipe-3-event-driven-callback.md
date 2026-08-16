# Recipe 3 — Event-Driven Long-Running Workflow

**Pattern:** the callback architecture. An external event kicks off a
potentially large SuperDocs operation; instead of a recipe blocking on
it, the platform's own polling trigger "wakes up" the rest of the recipe
only when the job actually changes state.

## Scenario (synthetic)

A fictional "Bluepeak Systems" internal tool emits an event whenever a
large policy document needs a full-document AI restructure — a
multi-section operation that can genuinely take minutes (per SuperDocs'
own documented latency table, a "complex operation" can take 2-5
minutes, and a "very large document" 5-25 minutes). This recipe is built
specifically so that wait never blocks a Workato worker.

## Recipe steps

1. **Trigger:** *(synthetic)* "Policy document flagged for restructure" —
   a fictional internal-tools connector's event trigger. Sample synthetic
   payload:
   ```json
   {
     "policy_id": "POL-2291",
     "document_html": "<div data-chunk-id=\"p1\"><h1>Data Retention Policy</h1></div>...(large, truncated for this example)...",
     "restructure_instruction": "Reorganize this policy into clearly numbered sections with a table of contents, and tighten the language throughout."
   }
   ```

2. **Action: SuperDocs → Edit document by instruction**
   - `session_id`: `"policy-#{trigger.policy_id}"`
   - `document_html`: `{{trigger.document_html}}`
   - `instruction`: `{{trigger.restructure_instruction}}`
   - `approval_mode`: `approve_all` (no human review needed for
     internal-policy formatting cleanup, per this fictional org's own
     policy — contrast with Recipe 2)
   - `model_tier`: `pro` (higher-capability tier for a full-document
     restructure, per SuperDocs' own model-selection guidance for
     larger/more complex operations)
   - Returns `job_id` immediately. **The recipe does not wait here.**

3. **Trigger: SuperDocs → New/updated SuperDocs job status**
   (`job_id` = `{{step_2.job_id}}`)

   This is the callback substitute described in the connector's
   architecture: **SuperDocs itself has no webhook to push a completion
   event** (verified — see `docs/api-notes.md`), so this trigger has
   Workato's own scheduler poll on the recipe's behalf, at Workato's
   default interval, and only re-enters the recipe when the job's status
   actually changes. Whatever recipe step follows this trigger only runs
   when there's real news — not on every poll tick.

   The trigger's own logic (`can_poll_more: false` once terminal) also
   means it stops asking Workato for immediate re-polls the moment the
   job finishes, rather than continuing to hammer the API.

4. **Branch on `status`:**
   - `completed` → continue to step 5.
   - `failed` → step 5b: *(synthetic)* "Notify on-call" action with
     `{{step_3.error_message}}`.
   - (This recipe uses `approve_all`, so `awaiting_approval` is not
     expected here — Recipe 2 covers that branch.)

5. **Action: SuperDocs → Export document**
   - `session_id`: `"policy-#{trigger.policy_id}"`
   - `format`: `docx`

6. **Action: (synthetic) Internal Tools → Deliver restructured policy**
   - `file_base64`: `{{step_5.file_base64}}`
   - `destination`: `"policies/POL-2291-restructured.docx"`

## Why this shape

This is the recipe that demonstrates the assignment's required "prefer
callbacks for long-running jobs where supported" principle applied
honestly to an API that doesn't support true callbacks: rather than
faking a webhook that doesn't exist, or building a recipe-level sleep
loop (which WOULD block a worker, exactly what the assignment says not
to do), the polling trigger delegates the waiting to the platform's own
scheduler infrastructure — the same effect (a worker is never blocked)
achieved through the mechanism SuperDocs actually offers.

## What breaks first at scale

If many large restructures are in flight simultaneously, each has its
own polling trigger instance; Workato's documented trigger limits (1,000
events per poll, a 5-minute throttle after 600 consecutive empty polls —
see `docs/api-notes.md`) mean a single trigger instance handles one
`job_id` cleanly, but a fleet of hundreds of concurrent large jobs would
be worth revisiting against SuperDocs' own operation-quota limits (see
README "Known limitations") before assuming this scales unboundedly.
