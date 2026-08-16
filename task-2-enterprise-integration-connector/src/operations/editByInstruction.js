/**
 * Operation B -- Edit by Instruction.
 *
 * Maps directly onto the documented POST /v1/chat/async endpoint:
 * https://docs.superdocs.app/api-reference/v1/start-a-long-running-or-hitl-approved-ai-edit;-returns-a-job_id-to-poll-for-results
 *
 * Always uses the ASYNC endpoint (never sync /v1/chat) because an
 * enterprise connector cannot know in advance whether the edit will be
 * trivial or large, and the platform-side action timeout (documented at
 * 180 seconds for Workato SDK actions specifically -- see
 * docs/api-notes.md) is well under SuperDocs' own 30-minute per-turn cap.
 * Blocking synchronously risks the CONNECTOR timing out even when
 * SuperDocs would have finished. Poll via pollForCompletion.js instead.
 */

/**
 * @typedef {object} EditByInstructionInput
 * @property {string} session_id
 * @property {string} instruction - natural-language edit instruction.
 * @property {string} [document_html] - required only to LOAD a document
 *   into a new session or REPLACE it wholesale; omit on follow-up turns
 *   against a session that already holds a document (server persists it).
 * @property {"approve_all"|"ask_every_time"} [approval_mode="approve_all"]
 * @property {"core"|"turbo"|"pro"|"max"} [model_tier]
 * @property {"fast"|"balanced"|"deep"} [thinking_depth]
 */

/**
 * @typedef {object} EditByInstructionOutput
 * @property {string} job_id
 * @property {string} session_id
 * @property {"pending"} status - always "pending" immediately after
 *   starting; the caller must poll (see pollForCompletion.js) to reach a
 *   terminal state.
 */

/**
 * @param {import("../client.js").SuperDocsClient} client
 * @param {EditByInstructionInput} input
 * @returns {Promise<EditByInstructionOutput>}
 */
export async function editByInstruction(client, input) {
  if (!input.session_id) throwValidation("session_id is required.");
  if (!input.instruction || typeof input.instruction !== "string") {
    throwValidation("instruction is required and must be a non-empty string.");
  }

  const payload = {
    message: input.instruction,
    session_id: input.session_id,
    approval_mode: input.approval_mode ?? "approve_all",
    ...(input.document_html !== undefined ? { document_html: input.document_html } : {}),
    ...(input.model_tier ? { model_tier: input.model_tier } : {}),
    ...(input.thinking_depth ? { thinking_depth: input.thinking_depth } : {}),
  };

  const job = await client.chatAsync(payload);
  return {
    job_id: job.job_id,
    session_id: job.session_id ?? input.session_id,
    status: "pending",
  };
}

function throwValidation(message) {
  const err = new Error(message);
  err.category = "validation";
  err.retryable = false;
  throw err;
}
