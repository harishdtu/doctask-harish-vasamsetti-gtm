import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SuperDocsClient } from "../src/client.js";
import { createMockFetch } from "./mocks/mockFetch.js";
import { generateFromTemplate } from "../src/operations/generateFromTemplate.js";
import { editByInstruction } from "../src/operations/editByInstruction.js";
import { submitForApproval } from "../src/operations/submitForApproval.js";
import { pollForCompletion, resolvePollOutcome } from "../src/operations/pollForCompletion.js";
import { fetchExport } from "../src/operations/fetchExport.js";

// ---- A. Generate from Template -----------------------------------

describe("generateFromTemplate", () => {
  test("sync mode: calls POST /v1/chat and returns document_html", async () => {
    const fetchImpl = createMockFetch([
      { status: 200, jsonBody: { response: "done", document_changes: { updated_html: "<h1>Invoice</h1>" } } },
    ]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const result = await generateFromTemplate(client, {
      template_name: "Invoice Template",
      substitution_data: { customer_name: "Acme Co", amount: "$500" },
      session_id: "sess-invoice-1",
    });
    assert.equal(result.status, "completed");
    assert.equal(result.job_id, null);
    assert.equal(result.document_html, "<h1>Invoice</h1>");
    const sentBody = JSON.parse(fetchImpl.calls[0].options.body);
    assert.match(sentBody.message, /Invoice Template/);
    assert.match(sentBody.message, /Acme Co/);
  });

  test("async mode: calls POST /v1/chat/async and returns a pending job_id", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { job_id: "job-1", session_id: "sess-1", status: "pending" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const result = await generateFromTemplate(client, {
      template_name: "NDA Template",
      substitution_data: {},
      session_id: "sess-1",
      async: true,
    });
    assert.equal(result.status, "pending");
    assert.equal(result.job_id, "job-1");
    assert.match(fetchImpl.calls[0].url, /\/v1\/chat\/async$/);
  });

  test("rejects with a validation error when template_name is missing", async () => {
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl: createMockFetch([]) });
    await assert.rejects(
      () => generateFromTemplate(client, { session_id: "s1", substitution_data: {} }),
      (err) => err.category === "validation"
    );
  });
});

// ---- B. Edit by Instruction -----------------------------------

describe("editByInstruction", () => {
  test("always calls the ASYNC endpoint, never sync /v1/chat", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { job_id: "job-2", session_id: "sess-2", status: "pending" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const result = await editByInstruction(client, { session_id: "sess-2", instruction: "Add a confidentiality clause" });
    assert.match(fetchImpl.calls[0].url, /\/v1\/chat\/async$/);
    assert.equal(result.status, "pending");
    assert.equal(result.job_id, "job-2");
  });

  test("defaults approval_mode to approve_all when not specified", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { job_id: "job-3", status: "pending" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await editByInstruction(client, { session_id: "s1", instruction: "Fix typos" });
    const sentBody = JSON.parse(fetchImpl.calls[0].options.body);
    assert.equal(sentBody.approval_mode, "approve_all");
  });

  test("passes through ask_every_time for HITL workflows", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { job_id: "job-4", status: "pending" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await editByInstruction(client, { session_id: "s1", instruction: "Rewrite section 3", approval_mode: "ask_every_time" });
    const sentBody = JSON.parse(fetchImpl.calls[0].options.body);
    assert.equal(sentBody.approval_mode, "ask_every_time");
  });

  test("rejects with validation error when instruction is missing", async () => {
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl: createMockFetch([]) });
    await assert.rejects(() => editByInstruction(client, { session_id: "s1" }), (err) => err.category === "validation");
  });
});

// ---- C. Submit for Approval + proposed-changes parsing -----------

describe("submitForApproval", () => {
  test("always sends a top-level `approved` field (the documented required-field pitfall)", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { status: "in_progress" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await submitForApproval(client, {
      session_id: "sess-1",
      job_id: "job-1",
      defaultApproved: true,
      decisions: [
        { change_id: "ch_1", approved: true },
        { change_id: "ch_2", approved: false, feedback: "Keep original wording" },
      ],
    });
    const sentBody = JSON.parse(fetchImpl.calls[0].options.body);
    assert.equal(sentBody.approved, true); // top-level, always present
    assert.equal(sentBody.changes.length, 2);
    assert.equal(sentBody.changes[1].feedback, "Keep original wording");
  });

  test("single-change shape sends change_id at top level, not a changes array", async () => {
    const fetchImpl = createMockFetch([{ status: 200, jsonBody: { status: "in_progress" } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await submitForApproval(client, { session_id: "s1", job_id: "j1", defaultApproved: true, singleChangeId: "ch_9" });
    const sentBody = JSON.parse(fetchImpl.calls[0].options.body);
    assert.equal(sentBody.change_id, "ch_9");
    assert.equal(sentBody.changes, undefined);
  });

  test("rejects when defaultApproved is not an explicit boolean (never silently defaults)", async () => {
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl: createMockFetch([]) });
    await assert.rejects(
      () => submitForApproval(client, { session_id: "s1", job_id: "j1", singleChangeId: "ch_1" }),
      (err) => err.category === "validation"
    );
  });

  test("rejects when both decisions and singleChangeId are given", async () => {
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl: createMockFetch([]) });
    await assert.rejects(
      () =>
        submitForApproval(client, {
          session_id: "s1",
          job_id: "j1",
          defaultApproved: true,
          singleChangeId: "ch_1",
          decisions: [{ change_id: "ch_2" }],
        }),
      (err) => err.category === "validation"
    );
  });
});

describe("parsePendingChanges (the documented double-parse case)", () => {
  test("polling source: metadata.pending_changes is ALREADY a plain array -- single parse only", async () => {
    const { parsePendingChanges } = await import("../src/operations/submitForApproval.js");
    const raw = [
      { change_id: "ch_1", operation: "edit", chunk_id: "abc", old_html: "<p>old</p>", new_html: "<p>new</p>", ai_explanation: "clarify" },
    ];
    const parsed = parsePendingChanges({ source: "polling", raw });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].change_id, "ch_1");
  });

  test("polling source rejects a raw STRING instead of throwing an opaque JSON error", async () => {
    const { parsePendingChanges } = await import("../src/operations/submitForApproval.js");
    assert.throws(
      () => parsePendingChanges({ source: "polling", raw: JSON.stringify([{ change_id: "x" }]) }),
      (err) => err.category === "validation" && /Do not attempt to JSON.parse/.test(err.message)
    );
  });

  test("sse source: content is a JSON-ENCODED STRING requiring a second JSON.parse", async () => {
    const { parsePendingChanges } = await import("../src/operations/submitForApproval.js");
    // Mirrors the docs' own worked example exactly:
    //   const data = JSON.parse(event.data);
    //   const batch = JSON.parse(data.content);
    const batchPayload = {
      type: "single_approval",
      batch_id: "ch_1",
      batch_total: 1,
      changes: [{ change_id: "ch_1", operation: "create", chunk_id: null, old_html: null, new_html: "<p>new section</p>", ai_explanation: "add clause", insert_after_chunk_id: "chunk_5" }],
    };
    const sseContentField = JSON.stringify(batchPayload); // this is what data.content holds: a STRING
    const parsed = parsePendingChanges({ source: "sse", raw: sseContentField });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].operation, "create");
    assert.equal(parsed[0].insert_after_chunk_id, "chunk_5");
  });

  test("sse source rejects a raw OBJECT instead of blindly re-stringifying/parsing it", async () => {
    const { parsePendingChanges } = await import("../src/operations/submitForApproval.js");
    assert.throws(
      () => parsePendingChanges({ source: "sse", raw: { changes: [] } }),
      (err) => err.category === "validation" && /Expected a JSON-encoded string/.test(err.message)
    );
  });

  test("rejects a change missing change_id rather than silently passing through malformed data", async () => {
    const { parsePendingChanges } = await import("../src/operations/submitForApproval.js");
    assert.throws(() => parsePendingChanges({ source: "polling", raw: [{ operation: "edit" }] }));
  });
});

// ---- D. Poll for Completion -----------------------------------

describe("resolvePollOutcome (pure state-machine logic)", () => {
  test("pending/in_progress -> null (keep polling)", () => {
    assert.equal(resolvePollOutcome({ status: "pending" }), null);
    assert.equal(resolvePollOutcome({ status: "in_progress" }), null);
  });

  test("completed -> terminal 'completed' outcome", () => {
    const outcome = resolvePollOutcome({ status: "completed", result: { response: "done" } });
    assert.equal(outcome.kind, "completed");
  });

  test("failed -> terminal 'failed' outcome with error message", () => {
    const outcome = resolvePollOutcome({ status: "failed", error: "AI processing error" });
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.error, "AI processing error");
  });

  test("cancelled -> terminal 'cancelled' outcome", () => {
    assert.equal(resolvePollOutcome({ status: "cancelled" }).kind, "cancelled");
  });

  test("awaiting_approval + awaiting_kind=continue_prompt -> 'awaiting_continue_decision', NOT change review", () => {
    const outcome = resolvePollOutcome({
      status: "awaiting_approval",
      metadata: { awaiting_kind: "continue_prompt", continue_prompt: { done: 500, total: 864, remaining: 364 } },
    });
    assert.equal(outcome.kind, "awaiting_continue_decision");
    assert.equal(outcome.continuePrompt.remaining, 364);
  });

  test("awaiting_approval WITHOUT continue_prompt kind -> 'awaiting_change_review' (the 'otherwise' case)", () => {
    const outcome = resolvePollOutcome({
      status: "awaiting_approval",
      metadata: { pending_changes: [{ change_id: "ch_1", operation: "edit" }] },
    });
    assert.equal(outcome.kind, "awaiting_change_review");
    assert.equal(outcome.pendingChanges.length, 1);
  });

  test("unrecognized status throws rather than looping forever or guessing", () => {
    assert.throws(() => resolvePollOutcome({ status: "not_a_real_status" }));
  });
});

describe("pollForCompletion (loop + client integration)", () => {
  test("polls until completed, calling GET /v1/jobs/{id} each time", async () => {
    const fetchImpl = createMockFetch([
      { status: 200, jsonBody: { job_id: "j1", status: "pending" } },
      { status: 200, jsonBody: { job_id: "j1", status: "in_progress" } },
      { status: 200, jsonBody: { job_id: "j1", status: "completed", result: { response: "done" } } },
    ]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const outcome = await pollForCompletion(client, { job_id: "j1", pollIntervalMs: 1 });
    assert.equal(outcome.kind, "completed");
    assert.equal(fetchImpl.calls.length, 3);
  });

  test("stops immediately on awaiting_change_review without infinite-looping", async () => {
    const fetchImpl = createMockFetch([
      { status: 200, jsonBody: { job_id: "j1", status: "awaiting_approval", metadata: { pending_changes: [{ change_id: "c1", operation: "edit" }] } } },
    ]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const outcome = await pollForCompletion(client, { job_id: "j1", pollIntervalMs: 1 });
    assert.equal(outcome.kind, "awaiting_change_review");
    assert.equal(fetchImpl.calls.length, 1);
  });

  test("enforces a client-side maxWaitMs timeout rather than polling forever", async () => {
    const fetchImpl = createMockFetch(() => ({ status: 200, jsonBody: { job_id: "j1", status: "in_progress" } }));
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await assert.rejects(
      () => pollForCompletion(client, { job_id: "j1", pollIntervalMs: 5, maxWaitMs: 20 }),
      (err) => err.category === "timeout"
    );
  });

  test("a 404 mid-poll (documented 1-hour job cleanup) surfaces as not_found, not an infinite retry", async () => {
    const fetchImpl = createMockFetch([
      { status: 200, jsonBody: { job_id: "j1", status: "in_progress" } },
      { status: 404, jsonBody: { detail: "Job not found" } },
    ]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await assert.rejects(
      () => pollForCompletion(client, { job_id: "j1", pollIntervalMs: 1 }),
      (err) => err.category === "not_found"
    );
  });
});

// ---- E. Fetch Export -----------------------------------

describe("fetchExport", () => {
  test("exports from session_id, defaults to docx format", async () => {
    const fakeDocxBytes = new TextEncoder().encode("fake docx bytes").buffer;
    const fetchImpl = createMockFetch([
      {
        status: 200,
        binaryBody: fakeDocxBytes,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": 'attachment; filename="contract.docx"',
        },
      },
    ]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const result = await fetchExport(client, { session_id: "sess-1" });
    assert.equal(result.format, "docx");
    assert.equal(result.filename, "contract.docx");
    assert.equal(result.fileBytes.toString(), "fake docx bytes");
    const sentBody = JSON.parse(fetchImpl.calls[0].options.body);
    assert.equal(sentBody.format, "docx");
  });

  test("supports all 5 documented formats, never the legacy 'doc' alias", async () => {
    const { EXPORT_FORMATS } = await import("../src/schema.js");
    assert.deepEqual([...EXPORT_FORMATS].sort(), ["docx", "html", "markdown", "pdf", "txt"]);
  });

  test("rejects an unsupported format before making any HTTP call", async () => {
    const fetchImpl = createMockFetch([]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    await assert.rejects(
      () => fetchExport(client, { session_id: "s1", format: "doc" }),
      (err) => err.category === "validation"
    );
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("rejects when both session_id and html are given", async () => {
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl: createMockFetch([]) });
    await assert.rejects(
      () => fetchExport(client, { session_id: "s1", html: "<p>x</p>" }),
      (err) => err.category === "validation"
    );
  });

  test("parses X-Export-Warnings header (base64 JSON) into a typed warnings array", async () => {
    const warnings = [{ code: "image_download_failed", message: "could not fetch image", detail: { src: "https://example.com/x.png" } }];
    const headerValue = Buffer.from(JSON.stringify(warnings)).toString("base64");
    const fetchImpl = createMockFetch([
      {
        status: 200,
        binaryBody: new ArrayBuffer(4),
        headers: { "content-disposition": 'attachment; filename="doc.pdf"', "x-export-warnings": headerValue },
      },
    ]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const result = await fetchExport(client, { session_id: "s1", format: "pdf" });
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, "image_download_failed");
  });

  test("warnings defaults to an empty array (never undefined) when the header is absent", async () => {
    const fetchImpl = createMockFetch([{ status: 200, binaryBody: new ArrayBuffer(4), headers: { "content-disposition": 'attachment; filename="doc.pdf"' } }]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const result = await fetchExport(client, { session_id: "s1", format: "pdf" });
    assert.deepEqual(result.warnings, []);
  });

  test("export retries a transient 503 like every other operation", async () => {
    const fetchImpl = createMockFetch([
      { status: 503, jsonBody: null },
      { status: 200, binaryBody: new ArrayBuffer(4), headers: { "content-disposition": 'attachment; filename="doc.pdf"' } },
    ]);
    const client = new SuperDocsClient({ apiKey: "sk_x", fetchImpl });
    const result = await fetchExport(client, { session_id: "s1", format: "pdf" });
    assert.equal(result.filename, "doc.pdf");
    assert.equal(fetchImpl.calls.length, 2);
  });
});
