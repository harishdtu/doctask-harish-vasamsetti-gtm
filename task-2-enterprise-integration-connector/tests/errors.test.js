import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyHttpError, classifyNetworkError } from "../src/errors.js";

describe("classifyHttpError", () => {
  test("400 -> validation, not retryable", () => {
    const err = classifyHttpError({ status: 400, headers: {}, body: { detail: "Message cannot be empty." } });
    assert.equal(err.category, "validation");
    assert.equal(err.retryable, false);
    assert.equal(err.message, "Message cannot be empty.");
  });

  test("401 -> auth, not retryable, has actionable hint", () => {
    const err = classifyHttpError({ status: 401, headers: {}, body: { detail: "Invalid API key" } });
    assert.equal(err.category, "auth");
    assert.equal(err.retryable, false);
    assert.match(err.actionHint, /API key/);
  });

  test("403 -> authorization, not retryable", () => {
    const err = classifyHttpError({ status: 403, headers: {}, body: { detail: "Forbidden" } });
    assert.equal(err.category, "authorization");
    assert.equal(err.retryable, false);
  });

  test("404 -> not_found, not retryable, mentions job cleanup", () => {
    const err = classifyHttpError({ status: 404, headers: {}, body: { detail: "Job not found" } });
    assert.equal(err.category, "not_found");
    assert.equal(err.retryable, false);
    assert.match(err.actionHint, /1 hour/);
  });

  test("409 -> conflict, not retryable", () => {
    const err = classifyHttpError({ status: 409, headers: {}, body: { detail: "Conflict" } });
    assert.equal(err.category, "conflict");
    assert.equal(err.retryable, false);
  });

  test("410 -> permanent, not retryable", () => {
    const err = classifyHttpError({ status: 410, headers: {}, body: { detail: "Gone" } });
    assert.equal(err.category, "permanent");
    assert.equal(err.retryable, false);
  });

  test("413 -> validation, not retryable, mentions pre-signed upload", () => {
    const err = classifyHttpError({ status: 413, headers: {}, body: { detail: "Too large" } });
    assert.equal(err.category, "validation");
    assert.equal(err.retryable, false);
    assert.match(err.actionHint, /pre-signed/);
  });

  test("415 -> validation, not retryable", () => {
    const err = classifyHttpError({ status: 415, headers: {}, body: { detail: "Unsupported file type" } });
    assert.equal(err.category, "validation");
    assert.equal(err.retryable, false);
  });

  test("422 -> validation, not retryable, mentions the documented approve-endpoint pitfall", () => {
    const err = classifyHttpError({ status: 422, headers: {}, body: { detail: "Unprocessable" } });
    assert.equal(err.category, "validation");
    assert.equal(err.retryable, false);
    assert.match(err.actionHint, /approved/);
  });

  test("429 application flavour (JSON body) -> rate_limited, retryable, retryAfterSeconds parsed", () => {
    const err = classifyHttpError({
      status: 429,
      headers: { "retry-after": "1209600" },
      body: { detail: "Your monthly operation quota (500) is exhausted." },
    });
    assert.equal(err.category, "rate_limited");
    assert.equal(err.retryable, true);
    assert.equal(err.retryAfterSeconds, 1209600);
  });

  test("429 infrastructure flavour (non-JSON body) -> rate_limited, retryable, no retryAfterSeconds", () => {
    const err = classifyHttpError({ status: 429, headers: {}, body: null });
    assert.equal(err.category, "rate_limited");
    assert.equal(err.retryable, true);
    assert.equal(err.retryAfterSeconds, null);
    assert.match(err.actionHint, /jitter/);
  });

  test("500 -> transient_server, retryable", () => {
    const err = classifyHttpError({ status: 500, headers: {}, body: { detail: "Internal error" } });
    assert.equal(err.category, "transient_server");
    assert.equal(err.retryable, true);
  });

  test("502 -> transient_server, retryable", () => {
    const err = classifyHttpError({ status: 502, headers: {}, body: null });
    assert.equal(err.category, "transient_server");
    assert.equal(err.retryable, true);
  });

  test("503 -> transient_server, retryable", () => {
    const err = classifyHttpError({ status: 503, headers: {}, body: null });
    assert.equal(err.category, "transient_server");
    assert.equal(err.retryable, true);
  });

  test("504 -> timeout, NOT retryable (retrying the same call fails again)", () => {
    const err = classifyHttpError({ status: 504, headers: {}, body: { detail: "took longer than 30 minutes" } });
    assert.equal(err.category, "timeout");
    assert.equal(err.retryable, false);
    assert.match(err.actionHint, /async/);
  });

  test("unrecognized 5xx -> transient_server, retryable (conservative default)", () => {
    const err = classifyHttpError({ status: 599, headers: {}, body: null });
    assert.equal(err.category, "transient_server");
    assert.equal(err.retryable, true);
  });

  test("unrecognized 4xx -> unknown, not retryable", () => {
    const err = classifyHttpError({ status: 418, headers: {}, body: null });
    assert.equal(err.category, "unknown");
    assert.equal(err.retryable, false);
  });

  test("toJSON exposes the code/message/retryable/action_hint/retry_after_seconds contract", () => {
    const err = classifyHttpError({ status: 429, headers: { "retry-after": "30" }, body: { detail: "slow down" } });
    const json = err.toJSON();
    assert.deepEqual(Object.keys(json).sort(), ["action_hint", "code", "http_status", "message", "retry_after_seconds", "retryable"].sort());
    assert.equal(json.retryable, true);
    assert.equal(json.retry_after_seconds, 30);
  });
});

describe("classifyNetworkError", () => {
  test("AbortError -> timeout, retryable", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    const err = classifyNetworkError(abort);
    assert.equal(err.category, "timeout");
    assert.equal(err.retryable, true);
  });

  test("generic network failure -> transient_server, retryable", () => {
    const err = classifyNetworkError(new Error("getaddrinfo ENOTFOUND api.superdocs.app"));
    assert.equal(err.category, "transient_server");
    assert.equal(err.retryable, true);
  });
});
