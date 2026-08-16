/**
 * A tiny, dependency-free mock `fetch` for tests. Callers register a
 * queue of responses (or a handler function for more dynamic scenarios);
 * every call to the returned mock records its request for later
 * assertions.
 */

/**
 * @typedef {object} MockResponseSpec
 * @property {number} status
 * @property {Record<string,string>} [headers]
 * @property {unknown} [jsonBody] - JSON-encoded automatically.
 * @property {string} [textBody] - used verbatim (e.g. plain-text 429).
 * @property {ArrayBuffer} [binaryBody] - used verbatim, response.ok path only.
 */

export function createMockFetch(responses) {
  const calls = [];
  let index = 0;

  /** @type {typeof fetch} */
  const mockFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const spec = typeof responses === "function" ? responses(calls[calls.length - 1], calls.length - 1) : responses[index++];
    if (!spec) {
      throw new Error(`Mock fetch called more times than responses were queued (call #${calls.length}, url=${url})`);
    }
    return buildResponse(spec);
  };

  mockFetch.calls = calls;
  return mockFetch;
}

/**
 * @param {MockResponseSpec} spec
 */
function buildResponse(spec) {
  const headers = new Map(Object.entries(spec.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

  const hasBinary = spec.binaryBody !== undefined;
  const hasText = spec.textBody !== undefined;
  const hasJson = spec.jsonBody !== undefined;

  return {
    ok: spec.status >= 200 && spec.status < 300,
    status: spec.status,
    headers: {
      forEach(cb) {
        headers.forEach((v, k) => cb(v, k));
      },
      get(k) {
        return headers.get(k.toLowerCase()) ?? null;
      },
    },
    async text() {
      if (hasJson) return JSON.stringify(spec.jsonBody);
      if (hasText) return spec.textBody;
      if (hasBinary) throw new Error("Mock response has a binary body; call arrayBuffer() instead of text().");
      return "";
    },
    async arrayBuffer() {
      if (hasBinary) return spec.binaryBody;
      if (hasJson || hasText) {
        const text = hasJson ? JSON.stringify(spec.jsonBody) : spec.textBody;
        return new TextEncoder().encode(text).buffer;
      }
      return new ArrayBuffer(0);
    },
  };
}
