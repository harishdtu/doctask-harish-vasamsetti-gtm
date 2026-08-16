# Recipe 2 — Document → AI Edit → Human Approval → Export

**Pattern:** the human-review boundary, explicit and unavoidable. A
contract-like document is edited by AI, every proposed change is routed
to a human for approval before anything is finalized, and only the
approved result is exported.

## Scenario (synthetic)

A fictional legal-ops team ("Cratrock Labs Legal Ops") wants every
AI-proposed contract edit reviewed before it reaches a signed document.
The document, the company, and the reviewer role below are all
synthetic — no real company or person.

## Recipe steps

1. **Trigger:** *(synthetic)* "New contract draft uploaded" — a fictional
   document-management connector's new-file trigger. Sample synthetic
   payload:
   ```json
   {
     "document_id": "draft-4471",
     "document_html": "<div data-chunk-id=\"c1\"><h1>Master Services Agreement</h1></div><div data-chunk-id=\"c2\"><p>Term: 12 months.</p></div>",
     "requested_edit": "Extend the term to 24 months and add a mutual indemnification clause."
   }
   ```

2. **Action: SuperDocs → Edit document by instruction**
   - `session_id`: `"contract-#{trigger.document_id}"`
   - `document_html`: `{{trigger.document_html}}`
   - `instruction`: `{{trigger.requested_edit}}`
   - `approval_mode`: `ask_every_time` — **this is the whole point of the
     recipe**; every proposed change pauses for review rather than
     applying automatically.
   - Output: `job_id`, `status: "pending"`

3. **Trigger-style wait: SuperDocs → New/updated SuperDocs job status**
   (the polling trigger, configured with `job_id` = `{{step_2.job_id}}`)
   fires when the job reaches `awaiting_approval`.

4. **Action: (synthetic) Notify Legal Ops → Send review request**
   A synthetic Slack/email-style notification step. Sends the
   `pending_changes` (from step 3's `poll_job_status`-equivalent output)
   to a fictional `#legal-ops-review` channel with Approve/Deny buttons
   (illustrative — the actual button-to-decision wiring is host-platform
   specific and out of scope for this connector).
   ```
   Message: "Contract draft-4471 has 2 proposed changes awaiting review.
   Change 1 (edit): extend term 12mo -> 24mo.
   Change 2 (create): new mutual indemnification clause.
   Reply APPROVE or DENY for each."
   ```

5. **Action: SuperDocs → Submit approval decision**
   - `session_id`: `"contract-#{trigger.document_id}"`
   - `job_id`: `{{step_2.job_id}}`
   - `default_approved`: the human reviewer's decision from step 4
     (`true` for this recipe's synthetic walkthrough)
   - `changes`: the per-change decisions the reviewer made (batch mode)

6. **Poll again (SuperDocs → New/updated SuperDocs job status)** until
   `status` reaches `completed`.

7. **Action: SuperDocs → Export document**
   - `session_id`: `"contract-#{trigger.document_id}"`
   - `format`: `docx`
   - Only reached once the job is `completed` — i.e., only after a human
     explicitly approved every change that made it into the final file.

## Why this shape

This recipe exists specifically to prove the connector cannot be used to
silently bypass human review: `approval_mode: "ask_every_time"` combined
with the mandatory `submit_for_approval` step means no edit reaches the
exported document without an explicit approval decision recorded in the
recipe's own audit trail (visible in the host platform's job history).

## What NOT to build into step 4

Step 4 is deliberately illustrative rather than a concrete
implementation, because the actual notification → decision-capture
mechanism is entirely host-platform and organization specific (Slack
interactive buttons, an approval queue in an internal tool, an email
reply parser). Building a opinionated version of that step would be
scope creep beyond what this connector's assignment asks for — see
PROGRESS.md "What was cut."
