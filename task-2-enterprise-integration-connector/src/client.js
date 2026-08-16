import { classifyHttpError, classifyNetworkError, SuperDocsApiError } from "./errors.js";
import { withRetry } from "./retry.js";

/**
 * The real, documented SuperDocs API base URL.
 * Source: https://docs.superdocs.app/account/api-keys (curl examples throughout)
 */
export const DEFAULT_BASE_URL = "https://api.superdocs.app";

/**
 * Minimal, dependency-free SuperDocs API client. This is the ONLY module
 * in this package that performs I/O -- every operation module (see
 * src/operations/*.js) is a thin, pure wrapper around one or more of
 * these calls, which keeps the platform adapters (Workato, etc.) free of
 * HTTP/retry/error logic entirely.
 *
 * Every endpoint path, request field, and response field below is
 * verified against docs.superdocs.app (fetched 2026-08-15) -- see
 * docs/api-notes.md for the exact source page per method. Nothing here
 * is invented.
 */
export class SuperDocsClient {
  /**
   * @param {object} params
   * @param {string} params.apiKey - an `sk_...` or `lce_...` key (both
   *   use the identical Bearer auth scheme per the docs).
   * @param {string} [params.baseUrl]
   * @param {typeof fetch} [params.fetchImpl] - injectable for tests.
   * @param {number} [params.requestTimeoutMs=300000] - client-side abort;
   *   the docs' own server-integration examples use a 300s timeout for
   *   long synchronous edits, so that's the default here too.
   */
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, requestTimeoutMs = 300_000 }) {
    if (!apiKey) {
      throw new SuperDocsApiError({
        category: "auth",
        message: "No API key configured.",
        retryable: false,
        actionHint: "Set the connection's API key field (an sk_... or lce_... value from SuperDocs Settings > API Keys).",
      });
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  /**
   * Low-level request helper. Applies auth, JSON encode/decode, timeout,
   * and error classification uniformly. Does NOT retry -- callers that
   * want retry wrap this (or a method built on it) in `withRetry`.
   *
   * @param {object} params
   * @param {"GET"|"POST"|"PATCH"|"DELETE"} params.method
   * @param {string} params.path - e.g. "/v1/chat"
   * @param {object} [params.body]
   * @param {Record<string,string>} [params.query]
   * @returns {Promise<any>}
   */
  async request({ method, path, body, query }) {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      throw classifyNetworkError(cause);
    } finally {
      clearTimeout(timeout);
    }

    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const rawText = await response.text();
    let parsedBody = null;
    if (rawText.length > 0) {
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        // Documented case: infrastructure-level 429s are plain text, not
        // JSON. classifyHttpError uses `body === null` specifically to
        // detect this -- see errors.js.
        parsedBody = null;
      }
    }

    if (!response.ok) {
      throw classifyHttpError({ status: response.status, headers, body: parsedBody });
    }

    return parsedBody;
  }

  /**
   * Wraps `request` with the connector's standard retry contract.
   * @param {Parameters<SuperDocsClient["request"]>[0]} requestParams
   * @param {Partial<Parameters<typeof withRetry>[0]>} [retryParams]
   */
  async requestWithRetry(requestParams, retryParams = {}) {
    return withRetry({
      attempt: () => this.request(requestParams),
      ...retryParams,
    });
  }

  // ---- Documents / chat --------------------------------------------

  /**
   * POST /v1/chat (synchronous). Source:
   * https://docs.superdocs.app/api-reference/v1/edit-draft-or-restructure-a-document-using-natural-language-preserves-tables-styling-and-formatting
   */
  chatSync(payload) {
    return this.requestWithRetry({ method: "POST", path: "/v1/chat", body: payload });
  }

  /**
   * POST /v1/chat/async. Returns { job_id, session_id, status: "pending", message }.
   * Source: https://docs.superdocs.app/guides/async-jobs
   */
  chatAsync(payload) {
    return this.requestWithRetry({ method: "POST", path: "/v1/chat/async", body: payload });
  }

  /**
   * GET /v1/jobs/{job_id}. Source: https://docs.superdocs.app/guides/async-jobs
   * Note: jobs (all statuses, including terminal) are auto-cleaned up 1
   * hour after creation -- a 404 on a job you started minutes ago is a
   * real "not found", not a bug.
   */
  getJob(jobId) {
    return this.requestWithRetry({ method: "GET", path: `/v1/jobs/${encodeURIComponent(jobId)}` });
  }

  /**
   * POST /v1/jobs/{job_id}/cancel. Only pending/in_progress jobs can be
   * cancelled. Source: https://docs.superdocs.app/guides/async-jobs
   */
  cancelJob(jobId) {
    return this.requestWithRetry({ method: "POST", path: `/v1/jobs/${encodeURIComponent(jobId)}/cancel` });
  }

  /**
   * POST /v1/chat/{session_id}/approve.
   * IMPORTANT (documented pitfall): the top-level `approved` field is
   * ALWAYS required, even for a full batch decision where every entry in
   * `changes` carries its own `approved`. See
   * https://docs.superdocs.app/guides/human-in-the-loop -- this method
   * enforces that at the type level (see operations/submitForApproval.js)
   * rather than leaving it to the caller to remember.
   */
  approveChanges(sessionId, payload) {
    return this.requestWithRetry({ method: "POST", path: `/v1/chat/${encodeURIComponent(sessionId)}/approve`, body: payload });
  }

  /**
   * POST /v1/chat/{session_id}/continue. For the DISTINCT
   * `awaiting_kind: "continue_prompt"` pause (large multi-section edits),
   * never to be confused with change-approval -- calling the wrong one
   * returns 409. Source: https://docs.superdocs.app/guides/async-jobs
   */
  continueJob(sessionId, payload) {
    return this.requestWithRetry({ method: "POST", path: `/v1/chat/${encodeURIComponent(sessionId)}/continue`, body: payload });
  }

  // ---- Export ---------------------------------------------------------

  /**
   * POST /v1/documents/export. format in docx|pdf|html|markdown|txt.
   * Source: https://docs.superdocs.app/concepts/documents#exporting-documents
   * Note: this endpoint returns a binary file body (not JSON) on success
   * -- callers needing the raw bytes should not go through this typed
   * client's JSON-parsing `request()` path; see operations/fetchExport.js
   * for the binary-safe variant.
   */
  exportDocumentMetadataOnly(payload) {
    // Reserved for future use if SuperDocs ever adds a JSON-metadata
    // export mode. Today export is always binary -- see fetchExport.js.
    return this.requestWithRetry({ method: "POST", path: "/v1/documents/export", body: payload });
  }

  // ---- Templates --------------------------------------------------

  /** GET /v1/templates. Source: https://docs.superdocs.app/concepts/templates */
  listTemplates() {
    return this.requestWithRetry({ method: "GET", path: "/v1/templates" });
  }
}
