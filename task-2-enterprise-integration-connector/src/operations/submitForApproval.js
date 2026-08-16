/**
 * Operation C -- Submit for Approval.
 *
 * Maps onto POST /v1/chat/{session_id}/approve. Source:
 * https://docs.superdocs.app/guides/human-in-the-loop
 *
 * This connector NEVER auto-approves on the caller's behalf -- the
 * assignment is explicit that the human-review step must be preserved,
 * and the real API backs that up structurally: there is no bulk
 * "approve everything for this job" shortcut baked into the endpoint
 * itself (the `approved: true` + full `changes` array pattern is a
 * client-side convenience for a human who already decided to approve
 * everything, not an implicit default). This module only ever
 * constructs a request from decisions the caller explicitly supplies.
 *
 * DOCUMENTED PITFALL handled here (not assumed -- verified against the
 * docs' own worked "Incorrect" example): the top-level `approved` field
 * is REQUIRED on every request to this endpoint, even for a full batch
 * where every entry in `changes` carries its own `approved`. A request
 * shaped `{ job_id, changes: [...] }` with no top-level `approved` is
 * rejected with a generic 422. This module always sets a sensible
 * top-level default so recipe authors can never hit that specific,
 * documented trap.
 */

/**
 * @typedef {object} ChangeDecision
 * @property {string} change_id
 * @property {boolean} [approved] - if omitted, falls back to the
 *   request's top-level `defaultApproved`.
 * @property {string} [feedback] - only meaningful when approved=false;
 *   the AI may revise and propose a new change next round.
 */

/**
 * @typedef {object} SubmitForApprovalInput
 * @property {string} session_id
 * @property {string} job_id
 * @property {boolean} defaultApproved - becomes the request's REQUIRED
 *   top-level `approved` field. When every entry in `decisions` sets its
 *   own `approved`, this value is unused by the server but still sent
 *   (see the documented pitfall above).
 * @property {ChangeDecision[]} [decisions] - omit for a single-change
 *   approval (the `change_id` decision applies directly); provide for a
 *   batch. See docs/human-in-the-loop for the three valid request shapes.
 * @property {string} [singleChangeId] - for the "single change" request
 *   shape; mutually exclusive with `decisions`.
 */

/**
 * @typedef {object} SubmitForApprovalOutput
 * @property {string} job_id
 * @property {string} status - the job's status immediately after the
 *   approve call (typically back to "in_progress" -- processing resumes).
 */

/**
 * @param {import("../client.js").SuperDocsClient} client
 * @param {SubmitForApprovalInput} input
 * @returns {Promise<SubmitForApprovalOutput>}
 */
export async function submitForApproval(client, input) {
  if (!input.session_id) throwValidation("session_id is required.");
  if (!input.job_id) throwValidation("job_id is required.");
  if (typeof input.defaultApproved !== "boolean") {
    throwValidation(
      "defaultApproved must be an explicit boolean. This connector never guesses a default " +
        "approval decision on the caller's behalf -- see the human-review-preservation note above."
    );
  }
  if (input.decisions && input.singleChangeId) {
    throwValidation("Provide either `decisions` (batch) or `singleChangeId` (single change), not both.");
  }

  /** @type {Record<string, unknown>} */
  const payload = {
    job_id: input.job_id,
    approved: input.defaultApproved, // ALWAYS present -- see documented pitfall above.
  };

  if (input.singleChangeId) {
    payload.change_id = input.singleChangeId;
  } else if (input.decisions && input.decisions.length > 0) {
    payload.changes = input.decisions.map((d) => ({
      change_id: d.change_id,
      ...(typeof d.approved === "boolean" ? { approved: d.approved } : {}),
      ...(d.feedback ? { feedback: d.feedback } : {}),
    }));
  } else {
    throwValidation("Provide `singleChangeId` or a non-empty `decisions` array.");
  }

  const result = await client.approveChanges(input.session_id, payload);
  return {
    job_id: input.job_id,
    status: result?.status ?? "in_progress",
  };
}

/**
 * Parses a batch of pending changes into the connector's typed shape,
 * handling the ONE place the real API genuinely requires a double
 * JSON.parse -- confirmed directly against the docs' own worked example:
 *
 *   const data = JSON.parse(event.data);          // SSE envelope
 *   const batch = JSON.parse(data.content);        // batch payload (STRING)
 *
 * This applies ONLY to the SSE `proposed_change_batch` event's `content`
 * field. The POLLING path (GET /v1/jobs/{job_id} -> metadata.pending_changes)
 * is a plain, already-parsed JSON array -- NOT a string requiring a
 * second parse. This function branches on `source` explicitly rather
 * than guessing from the shape of the value, per the assignment's own
 * instruction: "do not blindly JSON.parse arbitrary objects; validate
 * types first."
 *
 * @param {object} params
 * @param {"polling"|"sse"} params.source
 * @param {unknown} params.raw - `metadata.pending_changes` (polling) or
 *   the parsed SSE envelope's `.content` field (sse)
 * @returns {import("../schema.js").PendingChange[]}
 */
export function parsePendingChanges({ source, raw }) {
  if (source === "polling") {
    if (!Array.isArray(raw)) {
      throw typeError(
        `Expected metadata.pending_changes to be an array when source="polling", got ${typeof raw}. ` +
          "Do not attempt to JSON.parse this value -- the polling path is already-parsed JSON."
      );
    }
    return raw.map(validateChangeShape);
  }

  if (source === "sse") {
    if (typeof raw !== "string") {
      throw typeError(
        `Expected a JSON-encoded string for the SSE 'content' field when source="sse", got ${typeof raw}. ` +
          "The SSE proposed_change_batch event's data.content field is documented as a string requiring a second JSON.parse."
      );
    }
    let batch;
    try {
      batch = JSON.parse(raw);
    } catch (cause) {
      throw typeError(`SSE 'content' field was not valid JSON: ${cause.message}`);
    }
    if (!batch || !Array.isArray(batch.changes)) {
      throw typeError("Parsed SSE batch payload is missing a 'changes' array.");
    }
    return batch.changes.map(validateChangeShape);
  }

  throw typeError(`Unknown source "${source}" -- expected "polling" or "sse".`);
}

function validateChangeShape(change) {
  if (!change || typeof change !== "object" || typeof change.change_id !== "string") {
    throw typeError("A proposed change is missing a string change_id.");
  }
  if (!["edit", "create", "delete"].includes(change.operation)) {
    throw typeError(`Unexpected operation "${change.operation}" on change ${change.change_id}.`);
  }
  return {
    change_id: change.change_id,
    operation: change.operation,
    chunk_id: change.chunk_id ?? null,
    old_html: change.old_html ?? null,
    new_html: change.new_html ?? null,
    ai_explanation: change.ai_explanation ?? "",
    insert_after_chunk_id: change.insert_after_chunk_id ?? null,
  };
}

function typeError(message) {
  const err = new TypeError(message);
  err.category = "validation";
  err.retryable = false;
  return err;
}

function throwValidation(message) {
  const err = new Error(message);
  err.category = "validation";
  err.retryable = false;
  throw err;
}
