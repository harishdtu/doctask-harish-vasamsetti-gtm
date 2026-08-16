import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { withRetry, computeBackoffMs } from "../src/retry.js";
import { classifyHttpError } from "../src/errors.js";

// Deterministic "sleep" -- withRetry uses real setTimeout, but we keep
// delays at 0 by injecting random()=>0 and tiny baseDelayMs so tests run
// fast without needing fake timers.

describe("withRetry", () => {
  test("returns the result on first success without retrying", async () => {
    let calls = 0;
    const result = await withRetry({
      attempt: async () => {
        calls++;
        return "ok";
      },
    });
    assert.equal(result, "ok");
    assert.equal(calls, 1);
  });

  test("retries a retryable error up to maxRetries, then succeeds", async () => {
    let calls = 0;
    const result = await withRetry({
      attempt: async () => {
        calls++;
        if (calls < 3) throw classifyHttpError({ status: 503, headers: {}, body: null });
        return "ok";
      },
      maxRetries: 3,
      baseDelayMs: 1,
      random: () => 0,
    });
    assert.equal(result, "ok");
    assert.equal(calls, 3);
  });

  test("gives up after maxRetries and throws the last error", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry({
          attempt: async () => {
            calls++;
            throw classifyHttpError({ status: 500, headers: {}, body: null });
          },
          maxRetries: 2,
          baseDelayMs: 1,
          random: () => 0,
        }),
      (err) => err.category === "transient_server"
    );
    assert.equal(calls, 3); // initial + 2 retries
  });

  test("never retries a non-retryable error (fails fast on attempt 1)", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry({
          attempt: async () => {
            calls++;
            throw classifyHttpError({ status: 401, headers: {}, body: null });
          },
          maxRetries: 5,
          baseDelayMs: 1,
        }),
      (err) => err.category === "auth"
    );
    assert.equal(calls, 1);
  });

  test("never retries validation (400/413/415/422) or not_found/conflict/permanent/timeout", async () => {
    const nonRetryableStatuses = [400, 404, 409, 410, 413, 415, 422, 504];
    for (const status of nonRetryableStatuses) {
      let calls = 0;
      await assert.rejects(() =>
        withRetry({
          attempt: async () => {
            calls++;
            throw classifyHttpError({ status, headers: {}, body: null });
          },
          maxRetries: 3,
          baseDelayMs: 1,
        })
      );
      assert.equal(calls, 1, `status ${status} should not be retried`);
    }
  });

  test("onRetry callback fires with attempt number, delay, and error", async () => {
    const events = [];
    let calls = 0;
    await withRetry({
      attempt: async () => {
        calls++;
        if (calls === 1) throw classifyHttpError({ status: 503, headers: {}, body: null });
        return "ok";
      },
      baseDelayMs: 1,
      random: () => 0,
      onRetry: (attempt, delayMs, err) => events.push({ attempt, delayMs, category: err.category }),
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].attempt, 1);
    assert.equal(events[0].category, "transient_server");
  });

  test("honors Retry-After as an exact delay floor, ignoring exponential/jitter math", async () => {
    let calls = 0;
    const events = [];
    await withRetry({
      attempt: async () => {
        calls++;
        if (calls === 1) throw classifyHttpError({ status: 429, headers: { "retry-after": "2" }, body: { detail: "slow down" } });
        return "ok";
      },
      baseDelayMs: 1000, // would normally be seconds -- Retry-After should override
      onRetry: (_a, delayMs) => events.push(delayMs),
    });
    assert.equal(events[0], 2000);
  });
});

describe("computeBackoffMs", () => {
  test("respects retryAfterSeconds when present, ignoring jitter entirely", () => {
    const delay = computeBackoffMs({ attemptIndex: 5, baseDelayMs: 1000, maxDelayMs: 30000, retryAfterSeconds: 7, random: () => 0.99 });
    assert.equal(delay, 7000);
  });

  test("exponential growth caps at maxDelayMs", () => {
    const delay = computeBackoffMs({ attemptIndex: 10, baseDelayMs: 1000, maxDelayMs: 5000, retryAfterSeconds: null, random: () => 1 });
    assert.equal(delay, 5000);
  });

  test("full jitter: random()=0 gives delay 0, random()=1 gives the full exponential value", () => {
    const zero = computeBackoffMs({ attemptIndex: 2, baseDelayMs: 1000, maxDelayMs: 30000, retryAfterSeconds: null, random: () => 0 });
    const full = computeBackoffMs({ attemptIndex: 2, baseDelayMs: 1000, maxDelayMs: 30000, retryAfterSeconds: null, random: () => 1 });
    assert.equal(zero, 0);
    assert.equal(full, 4000); // 1000 * 2^2
  });
});
