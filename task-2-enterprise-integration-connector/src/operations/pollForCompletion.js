/**
 * Operation D -- Poll for Completion.
 *
 * Maps onto GET /v1/jobs/{job_id}. Source:
 * https://docs.superdocs.app/guides/async-jobs
 *
 * SuperDocs has NO webhook/callback registration endpoint anywhere in
 * its documented API surface (verified by fetching the complete page
 * index at docs.superdocs.app/llms.txt and finding no /webhooks path,
 * no webhook_url field on any documented endpoint, and no mention of
 * push notifications outside of the platform's OWN outbound webhook_url
 * concept, which does not exist here either). The only asynchronous
 * completion signals SuperDocs offers are: polling (this module), SSE
 * streaming (org/B2B keys can also long-poll via GET /v1/poll/{session_id}),
 * and email delivery for large-export jobs specifically. This module
 * implements the POLLING contract precisely as documented; see
 * PROGRESS.md and README.md "Async/callback behavior" for why the
 * platform-side "callback pattern" this connector exposes to recipe
 * authors is a PLATFORM-side polling trigger (the integration platform's
 * own scheduler polls on the recipe author's behalf), not a true
 * SuperDocs-originated webhook.
 *
 * Terminal states, timeout, and retry limits are all explicit per the
 * assignment's own requirement ("NEVER implement an infinite polling
 * loop"):
 *   - Terminal statuses: completed, failed, cancelled (see schema.js)
 *   - awaiting_approval is NOT terminal -- it is a paused state requiring
 *     caller action (approve/deny or continue/stop) before polling can
 *     usefully continue; see resolvePollOutcome below.
 *   - maxWaitMs bounds the whole poll loop (default 10 minutes; the docs'
 *     own latency table puts "complex operation" at up to 300s, so 10
 *     minutes gives real headroom without polling forever).
 *   - SuperDocs itself hard-cleans up ANY job -- pending, in-progress,
 *     awaiting-approval, or terminal -- 1 hour after creation. A 404
 *     partway through a legitimate poll loop is that documented cleanup,
 *     not necessarily a bug -- pollForCompletion surfaces it as a
 *     `not_found` SuperDocsApiError rather than retrying it forever.
 */
import { TERMINAL_JOB_STATUSES } from "../schema.js";

/**
 * @typedef {object} PollForCompletionInput
 * @property {string} job_id
 * @property {number} [pollIntervalMs=2000] - matches the docs' own
 *   example polling loops (`time.sleep(2)`).
 * @property {number} [maxWaitMs=600000] - 10 minutes; see rationale above.
 * @property {(job: import("../schema.js").JobResult) => void} [onPoll] -
 *   observability hook, called once per poll with the raw job payload.
 */

/**
 * @typedef {object} PollOutcome
 * @property {"completed"} kind
 * @property {import("../schema.js").JobResult} job
 * OR
 * @property {"failed"} kind
 * @property {string} error
 * OR
 * @property {"cancelled"} kind
 * OR
 * @property {"awaiting_change_review"} kind
 * @property {import("../schema.js").PendingChange[]} pendingChanges
 * OR
 * @property {"awaiting_continue_decision"} kind
 * @property {object} continuePrompt
 */

/**
 * @param {import("../client.js").SuperDocsClient} client
 * @param {PollForCompletionInput} input
 * @returns {Promise<PollOutcome>}
 */
export async function pollForCompletion(client, input) {
  if (!input.job_id) throwValidation("job_id is required.");
  const pollIntervalMs = input.pollIntervalMs ?? 2000;
  const maxWaitMs = input.maxWaitMs ?? 600_000;

  const startedAt = Date.now();

  while (true) {
    const job = await client.getJob(input.job_id);
    input.onPoll?.(job);

    const outcome = resolvePollOutcome(job);
    if (outcome) return outcome;

    if (Date.now() - startedAt >= maxWaitMs) {
      const err = new Error(
        `Job ${input.job_id} did not reach a terminal or actionable state within ${maxWaitMs}ms. ` +
          "This is a CLIENT-side timeout, distinct from SuperDocs' own 30-minute per-turn cap -- " +
          "the job may still be running server-side. Increase maxWaitMs for known-large operations " +
          "(see the documented latency table) rather than retrying the same poll loop indefinitely."
      );
      err.category = "timeout";
      err.retryable = false;
      throw err;
    }

    await sleep(pollIntervalMs);
  }
}

/**
 * Pure function: given one job payload, decides whether polling should
 * stop (terminal or actionable-pause) or continue. Separated from the
 * loop above specifically so it's independently unit-testable without
 * fake timers.
 *
 * @param {import("../schema.js").JobResult} job
 * @returns {PollOutcome | null} null means "keep polling"
 */
export function resolvePollOutcome(job) {
  if (job.status === "completed") {
    return { kind: "completed", job };
  }
  if (job.status === "failed") {
    return { kind: "failed", error: job.error ?? "Job failed with no error detail provided." };
  }
  if (job.status === "cancelled") {
    return { kind: "cancelled" };
  }
  if (job.status === "awaiting_approval") {
    // Two documented, DISTINCT flavours -- branch on awaiting_kind first,
    // exactly as the docs' own warning insists (calling /approve on a
    // continue_prompt pause, or vice versa, is rejected with 409).
    const awaitingKind = job.metadata?.awaiting_kind;
    if (awaitingKind === "continue_prompt") {
      return { kind: "awaiting_continue_decision", continuePrompt: job.metadata?.continue_prompt ?? null };
    }
    // "otherwise -> a HITL change review" per the docs' own phrasing.
    return {
      kind: "awaiting_change_review",
      pendingChanges: job.metadata?.pending_changes ?? [],
    };
  }
  // pending, in_progress -> keep polling.
  if (job.status === "pending" || job.status === "in_progress") {
    return null;
  }
  const err = new Error(`Unrecognized job status "${job.status}".`);
  err.category = "unknown";
  err.retryable = false;
  throw err;
}

export { TERMINAL_JOB_STATUSES };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwValidation(message) {
  const err = new Error(message);
  err.category = "validation";
  err.retryable = false;
  throw err;
}
