# Recipe 1 — Template → Generate → Export

**Pattern:** synchronous generation pipeline, no human review needed.
CRM/order data drives a document generation, which is immediately
exported and handed to a downstream system.

## Scenario (synthetic)

A synthetic order-management system ("Northstar Analytics Order System")
fires a "New order confirmed" event. The recipe generates a
customer-facing order confirmation letter from a saved SuperDocs
template, exports it as a PDF, and stores it in a synthetic document
store. No real company, customer, or order — every value below is
fabricated for this recipe's demonstration.

## Recipe steps

1. **Trigger:** *New order confirmed* (synthetic trigger on a fictional
   "Northstar Order System" connector — stands in for any CRM/order
   platform's real "new record" trigger).
   Sample synthetic payload:
   ```json
   {
     "order_id": "ORD-88213",
     "customer_name": "Fictional Buyer Co.",
     "amount": "$4,250.00",
     "delivery_date": "2026-09-02"
   }
   ```

2. **Action: SuperDocs → Generate document from template**
   - `template_name`: `"Order Confirmation Template"`
   - `session_id`: `"order-#{trigger.order_id}"` (formula field — unique
     per order, so re-runs against the same order reuse the same
     SuperDocs session rather than creating a new document each time)
   - `substitution_data`:
     ```json
     {
       "customer_name": "{{trigger.customer_name}}",
       "order_id": "{{trigger.order_id}}",
       "amount": "{{trigger.amount}}",
       "delivery_date": "{{trigger.delivery_date}}"
     }
     ```

3. **Action: SuperDocs → Export document**
   - `session_id`: `{{step_2.session_id}}`
   - `format`: `pdf`
   - `filename`: `"confirmation-{{trigger.order_id}}"`

4. **Action: (synthetic) Document Store → Upload file**
   - `file_base64`: `{{step_3.file_base64}}`
   - `path`: `"/confirmations/{{trigger.order_id}}.pdf"`

## Why this shape

Order confirmations are low-risk, templated, and high-volume — exactly
the profile where `approval_mode: "ask_every_time"` would add friction
with no real benefit. This recipe deliberately uses the simplest path
(generate → export, no polling, no approval) to demonstrate the
synchronous half of the connector; Recipe 2 demonstrates the HITL path,
and Recipe 3 demonstrates the async/polling path.

## Idempotency note

Re-running this recipe for the same `order_id` reuses the same
`session_id`, so a retried recipe run edits the same SuperDocs session
rather than silently creating a duplicate document. This is the
connector's documented idempotency posture — see the main README
"Idempotency" section for why SuperDocs itself has no idempotency-key
mechanism and session-id reuse is the practical alternative.
