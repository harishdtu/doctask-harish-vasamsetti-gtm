/**
 * Operation A -- Generate from Template.
 *
 * There is no dedicated "generate from template" endpoint in the real
 * SuperDocs API. Templates are a distinct concept (POST /v1/templates/upload,
 * GET /v1/templates -- see https://docs.superdocs.app/concepts/templates)
 * that the AI *references* during a normal chat turn ("draft an NDA using
 * my standard template"); there's no separate "instantiate this template
 * with this data" endpoint with its own request/response shape.
 *
 * ASSUMPTION (documented per Phase 0's instruction to record, not hide,
 * assumptions when a detail isn't directly verifiable): this operation is
 * implemented as a chat/chat_async turn whose message references the
 * template by name and supplies the substitution data as structured
 * context in the instruction text -- i.e. "generate from template" is a
 * thin, purpose-named wrapper over the same `/v1/chat` (or `/v1/chat/async`)
 * call every other generation goes through, NOT a fabricated dedicated
 * endpoint. See PROGRESS.md for why this was chosen over inventing an
 * endpoint that doesn't exist.
 */
import { AWAITING_KINDS } from "../schema.js";

/**
 * @typedef {object} GenerateFromTemplateInput
 * @property {string} template_name - matched against the caller's saved
 *   templates (GET /v1/templates); passed through in the instruction text
 *   since there is no dedicated template_id parameter on /v1/chat.
 * @property {Record<string, string>} substitution_data - flattened
 *   key/value pairs describing what should replace template placeholders.
 *   Serialized into the chat instruction as the connector cannot assume
 *   the caller's template uses any particular merge-field syntax.
 * @property {string} session_id
 * @property {"core"|"turbo"|"pro"|"max"} [model_tier]
 * @property {boolean} [async] - true routes through /v1/chat/async +
 *   job polling (recommended for anything non-trivial); false calls the
 *   synchronous /v1/chat endpoint directly.
 */

/**
 * @typedef {object} GenerateFromTemplateOutput
 * @property {string} session_id
 * @property {string|null} job_id - null when `async` was false (the sync
 *   path has no job id at all).
 * @property {"completed"|"pending"} status - sync calls are always
 *   "completed" by the time this returns; async calls return "pending"
 *   immediately and the caller polls (see pollForCompletion.js).
 * @property {string|null} document_html - populated only on the sync path
 *   or when the caller awaits completion themselves.
 */

/**
 * @param {import("../client.js").SuperDocsClient} client
 * @param {GenerateFromTemplateInput} input
 * @returns {Promise<GenerateFromTemplateOutput>}
 */
export async function generateFromTemplate(client, input) {
  if (!input.template_name || typeof input.template_name !== "string") {
    throwValidation("template_name is required and must be a non-empty string.");
  }
  if (!input.session_id) {
    throwValidation("session_id is required (SuperDocs sessions are caller-chosen ids, not server-minted).");
  }

  const instructionLines = [
    `Draft a new document using my saved template "${input.template_name}".`,
  ];
  const entries = Object.entries(input.substitution_data ?? {});
  if (entries.length > 0) {
    instructionLines.push("Use the following values to fill in the template:");
    for (const [key, value] of entries) {
      instructionLines.push(`- ${key}: ${value}`);
    }
  }

  const payload = {
    message: instructionLines.join("\n"),
    session_id: input.session_id,
    ...(input.model_tier ? { model_tier: input.model_tier } : {}),
  };

  if (input.async) {
    const job = await client.chatAsync(payload);
    return {
      session_id: input.session_id,
      job_id: job.job_id,
      status: "pending",
      document_html: null,
    };
  }

  const result = await client.chatSync(payload);
  return {
    session_id: input.session_id,
    job_id: null,
    status: "completed",
    document_html: result?.document_changes?.updated_html ?? null,
  };
}

function throwValidation(message) {
  const err = new Error(message);
  err.category = "validation";
  err.retryable = false;
  throw err;
}

// Re-export for platform adapters that want the awaiting-kind constant
// without a separate import.
export { AWAITING_KINDS };
