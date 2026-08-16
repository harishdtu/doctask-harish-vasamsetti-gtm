import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SuperDocsClient, DEFAULT_BASE_URL } from "../src/client.js";
import { createMockFetch } from "./mocks/mockFetch.js";

describe("SuperDocsClient construction", () => {
  test("throws a typed auth error when no apiKey is given", () => {
    assert.throws(() => new SuperDocsClient({ apiKey: "" }), (err) => err.category === "auth");
  });

  test("defaults to the real documented base URL", () => {
    const client = new SuperDocsClient({ apiKey: "sk_test", fetchImpl: createMockFetch([]) });
    assert.equal(client.baseUrl, DEFAULT_BASE_URL);
    assert.equal(DEFAULT_BASE_URL, "https://api.superdocs.app");
  });
});

describe("SuperDocsClient authentication", () => {
  test("sends 'Authorization: Bearer <key>' on every request, per docs.superdocs.app/account/api-keys", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { sessions: [] } }]);
    const client = new SuperDocsClient({ apiKey: "sk_abc123", fetchImpl });
    await client.request({ method: "GET", path: "/v1/sessions" });
    const [call] = fetchImpl.calls;
    assert.equal(call.options.headers.Authorization, "Bearer sk_abc123");
  });

  test("401 surfaces as a typed, non-retryable auth error", async () => {
    const fetchImpl = createMockFetch([{ status: 401, jsonBody: { detail: "Invalid API key" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_bad", fetchImpl });
    await assert.rejects(
      () => client.request({ method: "GET", path: "/v1/sessions" }),
      (err) => err.category === "auth" && err.retryable === false
    );
  });
});

describe("SuperDocsClient endpoint paths (verified against docs.superdocs.app)", () => {
  test("chatSync -> POST /v1/chat", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { response: "ok", document_changes: {} } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await client.chatSync({ message: "hi", session_id: "s1" });
    assert.match(fetchImpl.calls[0].url, /\/v1\/chat$/);
    assert.equal(fetchImpl.calls[0].options.method, "POST");
  });

  test("chatAsync -> POST /v1/chat/async", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { job_id: "j1", status: "pending" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await client.chatAsync({ message: "hi", session_id: "s1" });
    assert.match(fetchImpl.calls[0].url, /\/v1\/chat\/async$/);
  });

  test("getJob -> GET /v1/jobs/{job_id}", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { job_id: "j1", status: "completed" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await client.getJob("job-xyz");
    assert.match(fetchImpl.calls[0].url, /\/v1\/jobs\/job-xyz$/);
    assert.equal(fetchImpl.calls[0].options.method, "GET");
  });

  test("cancelJob -> POST /v1/jobs/{job_id}/cancel", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { job_id: "j1", status: "cancelled" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await client.cancelJob("job-xyz");
    assert.match(fetchImpl.calls[0].url, /\/v1\/jobs\/job-xyz\/cancel$/);
  });

  test("approveChanges -> POST /v1/chat/{session_id}/approve", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { status: "in_progress" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await client.approveChanges("sess-1", { job_id: "j1", approved: true });
    assert.match(fetchImpl.calls[0].url, /\/v1\/chat\/sess-1\/approve$/);
  });

  test("continueJob -> POST /v1/chat/{session_id}/continue", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { status: "in_progress" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await client.continueJob("sess-1", { job_id: "j1", continue: true });
    assert.match(fetchImpl.calls[0].url, /\/v1\/chat\/sess-1\/continue$/);
  });

  test("listTemplates -> GET /v1/templates", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { templates: [] } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await client.listTemplates();
    assert.match(fetchImpl.calls[0].url, /\/v1\/templates$/);
  });

  test("session ids with special characters are URL-encoded in path segments", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { status: "in_progress" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await client.approveChanges("sess with space/slash", { job_id: "j1", approved: true });
    assert.doesNotMatch(fetchImpl.calls[0].url, / /);
  });
});

describe("SuperDocsClient retry integration (real behavior, not just retry.js in isolation)", () => {
  test("requestWithRetry retries a 503 then succeeds", async () => {
    const fetchImpl = createMockFetch([
      { status: 503, jsonBody: null },
      { status: 200, jsonBody: { job_id: "j1", status: "completed" } },
    ]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const result = await client.getJob("j1"); // getJob uses requestWithRetry internally
    assert.equal(result.status, "completed");
    assert.equal(fetchImpl.calls.length, 2);
  });

  test("requestWithRetry does not retry a 400", async () => {
    const fetchImpl = createMockFetch([{ status: 400, jsonBody: { detail: "bad" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await assert.rejects(() => client.getJob("j1"));
    assert.equal(fetchImpl.calls.length, 1);
  });
});

describe("SuperDocsClient body parsing edge cases", () => {
  test("plain-text infrastructure 429 (no JSON, no Retry-After) classifies correctly end-to-end", async () => {
    const fetchImpl = createMockFetch([{ status: 429, textBody: "Rate exceeded" }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await assert.rejects(
      () => client.request({ method: "GET", path: "/v1/sessions" }),
      (err) => err.category === "rate_limited" && err.retryAfterSeconds === null
    );
  });

  test("empty response body (e.g. some 200s) does not throw a JSON parse error", async () => {
    const fetchImpl = createMockFetch([{ status: 200, textBody: "" }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const result = await client.request({ method: "GET", path: "/health" });
    assert.equal(result, null);
  });
});
