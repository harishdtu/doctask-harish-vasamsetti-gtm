/**
 * Retry contract.
 *
 * Retries ONLY the categories documented as transient by the SuperDocs
 * error table (see errors.js / docs/api-notes.md):
 *   - rate_limited      (429, both flavours)
 *   - transient_server  (500, 502, 503)
 *   - network-level failures (classifyNetworkError -> transient_server)
 *
 * NEVER retries: validation (400/413/415/422), auth (401), authorization
 * (403), not_found (404), conflict (409), permanent (410), or timeout
 * (504) -- a 504 means the SAME request will time out again; the fix is
 * to change the request shape (split the edit, use async), not to retry
 * it unmodified. This mapping is exhaustive and mirrors `retryable` on
 * every SuperDocsApiError instance, so this module never has to
 * re-derive retryability from a status code -- it just reads `.retryable`.
 */

/**
 * @param {object} params
 * @param {() => Promise<any>} params.attempt - performs one try; must
 *   throw a SuperDocsApiError (see errors.js) on failure.
 * @param {number} [params.maxRetries=3] - retries AFTER the first attempt,
 *   so maxRetries=3 means up to 4 total attempts.
 * @param {number} [params.baseDelayMs=1000]
 * @param {number} [params.maxDelayMs=30000]
 * @param {(attempt: number, delayMs: number, error: import("./errors.js").SuperDocsApiError) => void} [params.onRetry]
 * @param {() => number} [params.random] - injectable for deterministic tests
 * @returns {Promise<any>}
 */
export async function withRetry({
  attempt,
  maxRetries = 3,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
  onRetry,
  random = Math.random,
}) {
  let lastError;
  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex++) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;

      const isRetryable = err && typeof err === "object" && err.retryable === true;
      const attemptsRemain = attemptIndex < maxRetries;

      if (!isRetryable || !attemptsRemain) {
        throw err;
      }

      const delayMs = computeBackoffMs({
        attemptIndex,
        baseDelayMs,
        maxDelayMs,
        retryAfterSeconds: err.retryAfterSeconds,
        random,
      });

      onRetry?.(attemptIndex + 1, delayMs, err);
      await sleep(delayMs);
    }
  }
  // Unreachable in practice (the loop always returns or throws), but keeps
  // control flow analysis happy and gives a sane fallback.
  throw lastError;
}

/**
 * Exponential backoff with full jitter, honoring a documented
 * `Retry-After` when the server supplied one (application 429s always
 * carry one; infrastructure 429s never do -- see errors.js).
 *
 * @param {object} params
 * @param {number} params.attemptIndex - 0-based
 * @param {number} params.baseDelayMs
 * @param {number} params.maxDelayMs
 * @param {number|null} [params.retryAfterSeconds]
 * @param {() => number} params.random
 * @returns {number} delay in milliseconds
 */
export function computeBackoffMs({ attemptIndex, baseDelayMs, maxDelayMs, retryAfterSeconds, random }) {
  if (retryAfterSeconds != null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    // Retry-After is an explicit server instruction -- honor it as a floor,
    // not just a suggestion, and skip jitter (the server already told us
    // exactly when it'll accept the request again).
    return Math.round(retryAfterSeconds * 1000);
  }
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attemptIndex);
  // Full jitter (AWS-style): uniform random in [0, exponential] avoids
  // synchronized retry storms across many concurrent connector instances.
  return Math.round(random() * exponential);
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
