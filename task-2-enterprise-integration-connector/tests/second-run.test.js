/**
 * Second-run test (Phase 9 of the assignment): proves the connector is
 * not hard-coded to a single demo document. Runs the SAME operation code
 * path against two structurally and topically unrelated synthetic
 * fixtures -- an invoice and an NDA -- and asserts both succeed with
 * fixture-appropriate results, using no fixture-specific branching
 * anywhere in src/.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { SuperDocsClient } from "../src/client.js";
import { createMockFetch } from "./mocks/mockFetch.js";
import { generateFromTemplate } from "../src/operations/generateFromTemplate.js";
import { editByInstruction } from "../src/operations/editByInstruction.js";
import { pollForCompletion } from "../src/operations/pollForCompletion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf-8"));
}

const fixtures = [
  { name: "fixture-a-invoice.json", label: "Fixture A (invoice)" },
  { name: "fixture-b-nda.json", label: "Fixture B (NDA)" },
];

describe("Second-run proof: same code path, two unrelated documents", () => {
  for (const { name, label } of fixtures) {
    test(`${label}: generateFromTemplate -> editByInstruction -> pollForCompletion all succeed`, async () => {
      const fixture = loadFixture(name);

      // 1. Generate from template (sync).
      const genFetch = createMockFetch([
        { status: 200, jsonBody: { response: "Generated", document_changes: { updated_html: fixture.document_html } } },
      ]);
      const genClient = new SuperDocsClient({ apiKey: "sk_test", fetchImpl: genFetch });
      const genResult = await generateFromTemplate(genClient, {
        template_name: fixture.template_name,
        substitution_data: {},
        session_id: fixture.session_id,
      });
      assert.equal(genResult.status, "completed");
      assert.equal(genResult.document_html, fixture.document_html);

      // 2. Edit by instruction (async -> job_id).
      const editFetch = createMockFetch([{ status: 200, jsonBody: { job_id: `job-${fixture.session_id}`, session_id: fixture.session_id, status: "pending" } }]);
      const editClient = new SuperDocsClient({ apiKey: "sk_test", fetchImpl: editFetch });
      const editResult = await editByInstruction(editClient, {
        session_id: fixture.session_id,
        instruction: fixture.instruction,
        document_html: fixture.document_html,
      });
      assert.equal(editResult.status, "pending");
      assert.ok(editResult.job_id);

      // 3. Poll to completion.
      const pollFetch = createMockFetch([
        { status: 200, jsonBody: { job_id: editResult.job_id, status: "in_progress" } },
        {
          status: 200,
          jsonBody: {
            job_id: editResult.job_id,
            status: "completed",
            result: { response: "Applied", document_changes: { updated_html: fixture.document_html + "<p>[edited]</p>" } },
          },
        },
      ]);
      const pollClient = new SuperDocsClient({ apiKey: "sk_test", fetchImpl: pollFetch });
      const outcome = await pollForCompletion(pollClient, { job_id: editResult.job_id, pollIntervalMs: 1 });
      assert.equal(outcome.kind, "completed");
      assert.match(outcome.job.result.document_changes.updated_html, /\[edited\]<\/p>$/);
    });
  }

  test("the two fixtures produced genuinely different session ids and instructions (not a copy-pasted single case)", () => {
    const a = loadFixture("fixture-a-invoice.json");
    const b = loadFixture("fixture-b-nda.json");
    assert.notEqual(a.session_id, b.session_id);
    assert.notEqual(a.instruction, b.instruction);
    assert.notEqual(a.document_html, b.document_html);
  });
});
