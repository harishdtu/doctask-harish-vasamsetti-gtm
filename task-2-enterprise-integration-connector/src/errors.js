/**
 * Typed error model for the SuperDocs enterprise connector.
 *
 * Every code and classification here traces to a specific, documented
 * SuperDocs behavior -- see docs/api-notes.md for the source page per
 * status code. Nothing here is invented: SuperDocs' actual error body is
 * `{ "detail": "..." }` (see https://docs.superdocs.app/errors/error-codes),
 * so `SuperDocsApiError` normalizes that flat shape into the richer,
 * typed contract this connector exposes to recipe authors.
 *
 * @typedef {"auth" | "authorization" | "validation" | "not_found" |
 *   "rate_limited" | "transient_server" | "timeout" | "conflict" |
 *   "permanent" | "unknown"} SuperDocsErrorCategory
 */

/**
 * The connector's typed error. Every field is meant to answer the three
 * questions the assignment calls out explicitly:
 *   1. What happened            -> message / category
 *   2. Is retrying appropriate  -> retryable
 *   3. What should the user do  -> actionHint
 */
export class SuperDocsApiError extends Error {
  /**
   * @param {object} params
   * @param {SuperDocsErrorCategory} params.category
   * @param {string} params.message
   * @param {boolean} params.retryable
   * @param {string} [params.actionHint]
   * @param {number} [params.httpStatus]
   * @param {number} [params.retryAfterSeconds] - honored verbatim from the
   *   documented `Retry-After` header when present.
   * @param {unknown} [params.rawBody]
   */
  constructor({ category, message, retryable, actionHint, httpStatus, retryAfterSeconds, rawBody }) {
    super(message);
    this.name = "SuperDocsApiError";
    this.category = category;
    this.retryable = retryable;
    this.actionHint = actionHint ?? null;
    this.httpStatus = httpStatus ?? null;
    this.retryAfterSeconds = retryAfterSeconds ?? null;
    this.rawBody = rawBody ?? null;
  }

  toJSON() {
    return {
      code: this.category,
      message: this.message,
      retryable: this.retryable,
      action_hint: this.actionHint,
      http_status: this.httpStatus,
      retry_after_seconds: this.retryAfterSeconds,
    };
  }
}

/**
 * Classifies an HTTP response into the connector's typed error taxonomy.
 * This is the single source of truth the retry contract (retry.js) reads
 * from -- classification and retry decisions must never diverge.
 *
 * Sources (see docs/api-notes.md for exact citations):
 * - Status code table: https://docs.superdocs.app/errors/error-codes
 * - 429 two-flavors (application vs infrastructure) and Retry-After:
 *   https://docs.superdocs.app/errors/rate-limits
 * - 504 = 30-minute wall-clock cap on a chat turn (documented, not assumed)
 *
 * @param {object} params
 * @param {number} params.status
 * @param {Record<string,string>} params.headers - lower-cased header names
 * @param {unknown} params.body - parsed JSON body, or null if the body
 *   was not valid JSON (the documented "infrastructure 429" case, which
 *   is plain text, not JSON)
 * @returns {SuperDocsApiError}
 */
export function classifyHttpError({ status, headers, body }) {
  const detail = body && typeof body === "object" && "detail" in body ? String(body.detail) : null;
  const retryAfterHeader = headers?.["retry-after"];
  const retryAfterSeconds = retryAfterHeader != null ? Number(retryAfterHeader) : undefined;

  switch (status) {
    case 400:
      return new SuperDocsApiError({
        category: "validation",
        message: detail ?? "Request validation failed.",
        retryable: false,
        actionHint: "Fix the request body (empty message, malformed field) and resubmit. Do not retry as-is.",
        httpStatus: status,
        rawBody: body,
      });

    case 401:
      return new SuperDocsApiError({
        category: "auth",
        message: detail ?? "Authentication failed.",
        retryable: false,
        actionHint:
          "Check the connection's API key: missing 'Bearer ' prefix, revoked key, or a key generated for the wrong surface " +
          "(e.g. a web-app session token instead of an sk_/lce_ key). Re-enter the connection credentials.",
        httpStatus: status,
        rawBody: body,
      });

    case 403:
      return new SuperDocsApiError({
        category: "authorization",
        message: detail ?? "Not authorized for this resource.",
        retryable: false,
        actionHint:
          "The authenticated account does not own this document/session/job, or an agent-takeover code was wrong. " +
          "Verify the resource id belongs to the connected account.",
        httpStatus: status,
        rawBody: body,
      });

    case 404:
      return new SuperDocsApiError({
        category: "not_found",
        message: detail ?? "Resource not found.",
        retryable: false,
        actionHint: "The job/session/template/attachment id does not exist, or a job was auto-cleaned up (jobs are removed 1 hour after creation). Start a new operation.",
        httpStatus: status,
        rawBody: body,
      });

    case 409:
      return new SuperDocsApiError({
        category: "conflict",
        message: detail ?? "Conflicting state.",
        retryable: false,
        actionHint:
          "Documented conflict cases: reverting a session with a job still pending/in_progress/awaiting_approval; " +
          "archiving a document another session has open without force=true. Resolve the conflicting state, then retry the original request (not this error).",
        httpStatus: status,
        rawBody: body,
      });

    case 410:
      return new SuperDocsApiError({
        category: "permanent",
        message: detail ?? "This resource is permanently gone.",
        retryable: false,
        actionHint: "An agent-takeover link was disabled after too many wrong codes. A fresh handoff link must be issued -- this exact link can never work again.",
        httpStatus: status,
        rawBody: body,
      });

    case 413:
      return new SuperDocsApiError({
        category: "validation",
        message: detail ?? "Request or export payload exceeds the size cap.",
        retryable: false,
        actionHint:
          "Split the document, use the pre-signed upload flow (POST /v1/uploads) for anything over ~20MB, " +
          "or use the large-export email fallback for exports over 100MB.",
        httpStatus: status,
        rawBody: body,
      });

    case 415:
      return new SuperDocsApiError({
        category: "validation",
        message: detail ?? "Unsupported file type.",
        retryable: false,
        actionHint: "Use one of: .pdf, .docx, .txt, .rtf, .md, .html, .htm. Legacy .doc must be converted to .docx first.",
        httpStatus: status,
        rawBody: body,
      });

    case 422:
      return new SuperDocsApiError({
        category: "validation",
        message: detail ?? "Request body does not match the expected schema.",
        retryable: false,
        actionHint:
          "Common cause on the approve endpoint specifically: a batch decision body is missing the required " +
          "top-level `approved` field. Fix the request shape and resubmit.",
        httpStatus: status,
        rawBody: body,
      });

    case 429: {
      // Two documented flavours. Application 429s are JSON with a Retry-After
      // header (and, on quota exhaustion, X-Usage-* headers). Infrastructure
      // 429s are plain text with NO Retry-After. We tell them apart by
      // whether `body` parsed as JSON at all -- see classifyHttpError's
      // `body: null` contract above.
      const isApplication429 = body !== null;
      return new SuperDocsApiError({
        category: "rate_limited",
        message: isApplication429
          ? (detail ?? "Rate limited.")
          : "Infrastructure-level rate limiting (traffic surge). No Retry-After was provided.",
        retryable: true,
        actionHint: isApplication429
          ? "Honor Retry-After. If this is monthly-quota exhaustion (see X-Usage-* headers), waiting is rarely practical -- surface an upgrade prompt instead of silently retrying for weeks."
          : "Back off exponentially with jitter; this is a transient platform-level throttle, not an application error.",
        httpStatus: status,
        retryAfterSeconds,
        rawBody: body,
      });
    }

    case 500:
      return new SuperDocsApiError({
        category: "transient_server",
        message: detail ?? "Unexpected server error.",
        retryable: true,
        actionHint: "Retry with backoff. If it persists across retries, treat as a platform incident and stop -- do not retry indefinitely.",
        httpStatus: status,
        rawBody: body,
      });

    case 502:
    case 503:
      return new SuperDocsApiError({
        category: "transient_server",
        message: detail ?? `Upstream error (${status}).`,
        retryable: true,
        actionHint: "Retry with backoff. These are documented as transient gateway/service errors.",
        httpStatus: status,
        rawBody: body,
      });

    case 504:
      return new SuperDocsApiError({
        category: "timeout",
        message: detail ?? "The operation exceeded the documented 30-minute wall-clock cap.",
        retryable: false,
        actionHint:
          "Do not blindly retry the same synchronous call -- it will time out again. Split the edit across smaller turns, " +
          "or switch to /v1/chat/async so the 30-minute cap applies per-turn in the background instead of blocking your worker.",
        httpStatus: status,
        rawBody: body,
      });

    default:
      if (status >= 500) {
        return new SuperDocsApiError({
          category: "transient_server",
          message: detail ?? `Unclassified server error (${status}).`,
          retryable: true,
          actionHint: "Retry with backoff; unrecognized 5xx is treated conservatively as transient.",
          httpStatus: status,
          rawBody: body,
        });
      }
      return new SuperDocsApiError({
        category: "unknown",
        message: detail ?? `Unclassified response (${status}).`,
        retryable: false,
        actionHint: "Inspect the raw response body; this status code is not in the documented SuperDocs error table.",
        httpStatus: status,
        rawBody: body,
      });
  }
}

/**
 * Classifies a network-level failure (fetch threw before a response was
 * received at all -- DNS failure, connection reset, client-side abort).
 * Distinct from classifyHttpError because there is no status code to key
 * off of.
 *
 * @param {Error} cause
 * @returns {SuperDocsApiError}
 */
export function classifyNetworkError(cause) {
  const isAbort = cause?.name === "AbortError";
  return new SuperDocsApiError({
    category: isAbort ? "timeout" : "transient_server",
    message: isAbort ? "Request aborted (client-side timeout)." : `Network error: ${cause?.message ?? String(cause)}`,
    retryable: true,
    actionHint: isAbort
      ? "The client-side timeout fired before SuperDocs responded. For long edits, use the async + polling pattern instead of a long synchronous call."
      : "Transient network failure (DNS, connection reset, etc). Retry with backoff.",
  });
}
