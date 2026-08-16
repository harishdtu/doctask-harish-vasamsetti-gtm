/**
 * Shared typed constants and JSDoc typedefs used across every operation
 * module. This is the connector's "typed schema" layer -- platform
 * adapters (Workato input_fields/output_fields, etc.) are generated from
 * these shapes, not from ad-hoc guesses per adapter.
 *
 * Every enum value here is copied verbatim from documented SuperDocs
 * values -- see docs/api-notes.md.
 */

/**
 * Documented export formats.
 * Source: https://docs.superdocs.app/concepts/documents#exporting-documents
 * ("doc" is accepted as a legacy alias but intentionally excluded here --
 * the docs say new integrations should use "docx" and that "doc" will be
 * removed in a future release, so this connector never emits it.)
 */
export const EXPORT_FORMATS = /** @type {const} */ (["docx", "pdf", "html", "markdown", "txt"]);

/**
 * Documented job statuses.
 * Source: https://docs.superdocs.app/guides/async-jobs
 */
export const JOB_STATUSES = /** @type {const} */ ([
  "pending",
  "in_progress",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

export const TERMINAL_JOB_STATUSES = /** @type {const} */ (["completed", "failed", "cancelled"]);

/**
 * Documented `awaiting_kind` values distinguishing the two different
 * reasons a job can pause in `awaiting_approval`.
 * Source: https://docs.superdocs.app/guides/human-in-the-loop
 */
export const AWAITING_KINDS = /** @type {const} */ (["continue_prompt", "change_review"]);
// NOTE: the docs describe change-review as "otherwise" (i.e. the ABSENCE
// of awaiting_kind="continue_prompt"), rather than naming a literal
// "change_review" string anywhere. We define AWAITING_KINDS.CHANGE_REVIEW
// as a connector-internal label for that case -- see
// operations/pollForCompletion.js for exactly how it's derived, and
// PROGRESS.md for this assumption being called out explicitly.

/**
 * Documented approval_mode values.
 * Source: https://docs.superdocs.app/guides/human-in-the-loop and
 * https://docs.superdocs.app/guides/server-integration
 */
export const APPROVAL_MODES = /** @type {const} */ (["approve_all", "ask_every_time"]);

/**
 * Documented model tiers.
 * Source: https://docs.superdocs.app/guides/model-selection (referenced
 * throughout the fetched pages; tier names confirmed as core/turbo/pro/max)
 */
export const MODEL_TIERS = /** @type {const} */ (["core", "turbo", "pro", "max"]);

/**
 * @typedef {object} PendingChange
 * @property {string} change_id
 * @property {"edit"|"create"|"delete"} operation
 * @property {string|null} chunk_id
 * @property {string|null} old_html
 * @property {string|null} new_html
 * @property {string} ai_explanation
 * @property {string|null} insert_after_chunk_id
 */

/**
 * @typedef {object} JobResult
 * @property {string} job_id
 * @property {"pending"|"in_progress"|"awaiting_approval"|"completed"|"failed"|"cancelled"} status
 * @property {object} [result]
 * @property {object} [metadata]
 * @property {string} [error]
 */
