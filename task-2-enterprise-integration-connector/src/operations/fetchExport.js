/**
 * Operation E -- Fetch Export.
 *
 * Maps onto POST /v1/documents/export. Source:
 * https://docs.superdocs.app/concepts/documents#exporting-documents
 *
 * This is a binary-response endpoint (the file bytes, not JSON), which
 * is why it does NOT go through SuperDocsClient.request() -- that method
 * always attempts response.text() + JSON.parse. This module makes its
 * own fetch call, reusing the client's auth/retry/error-classification
 * building blocks directly so the contract stays identical to every
 * other operation.
 *
 * Only the five documented, non-legacy formats are exposed -- see
 * schema.js EXPORT_FORMATS for why "doc" (legacy alias) is deliberately
 * excluded rather than offered as a sixth option.
 */
import { classifyHttpError, classifyNetworkError } from "../errors.js";
import { withRetry } from "../retry.js";
import { EXPORT_FORMATS } from "../schema.js";

/**
 * @typedef {object} FetchExportInput
 * @property {string} [session_id] - export the session's current
 *   document state. Mutually exclusive with `html`.
 * @property {string} [html] - export ad-hoc HTML content directly.
 *   Mutually exclusive with `session_id`. Capped at 20MB inline; larger
 *   documents need the pre-signed-upload flow, which is out of scope for
 *   this operation (see README "Known limitations").
 * @property {"docx"|"pdf"|"html"|"markdown"|"txt"} [format="docx"]
 * @property {object} [options] - paper_size, orientation, margins,
 *   filename, watermark_text, watermark_opacity -- passed through
 *   verbatim; see docs.superdocs.app export-options table for the full
 *   set. This module does not re-validate every option field, since the
 *   API itself returns a typed 422 on an invalid one (see errors.js).
 */

/**
 * @typedef {object} FetchExportOutput
 * @property {Buffer} fileBytes
 * @property {string} mimeType
 * @property {string} filename
 * @property {"docx"|"pdf"|"html"|"markdown"|"txt"} format
 * @property {Array<{code:string,message:string,detail?:object}>} warnings -
 *   parsed from the documented X-Export-Warnings header (base64-encoded
 *   JSON), always present as an array (possibly empty) rather than
 *   sometimes-undefined, so callers never need an existence check.
 */

const MIME_BY_FORMAT = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  html: "text/html",
  markdown: "text/markdown",
  txt: "text/plain",
};

/**
 * @param {import("../client.js").SuperDocsClient} client
 * @param {FetchExportInput} input
 * @returns {Promise<FetchExportOutput>}
 */
export async function fetchExport(client, input) {
  if (!input.session_id && !input.html) {
    throwValidation("Provide either `session_id` or `html` (mutually exclusive; see docs.superdocs.app large-document tiers for upload_id, not implemented here).");
  }
  if (input.session_id && input.html) {
    throwValidation("Provide only one of `session_id` or `html`, not both.");
  }
  const format = input.format ?? "docx";
  if (!EXPORT_FORMATS.includes(format)) {
    throwValidation(`Unsupported format "${format}". Supported: ${EXPORT_FORMATS.join(", ")}.`);
  }

  const payload = {
    ...(input.session_id ? { session_id: input.session_id } : { html: input.html }),
    format,
    ...(input.options ? { options: input.options } : {}),
  };

  const attempt = async () => {
    const url = `${client.baseUrl}/v1/documents/export`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), client.requestTimeoutMs);

    let response;
    try {
      response = await client.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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

    if (!response.ok) {
      // Error responses ARE JSON (per the docs' uniform {"detail": ...}
      // shape) even though success responses are binary -- so error
      // parsing here mirrors the main client exactly.
      const rawText = await response.text();
      let parsedBody = null;
      try {
        parsedBody = rawText.length > 0 ? JSON.parse(rawText) : null;
      } catch {
        parsedBody = null;
      }
      throw classifyHttpError({ status: response.status, headers, body: parsedBody });
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentDisposition = headers["content-disposition"] ?? "";
    const filename = extractFilename(contentDisposition) ?? `export.${format === "markdown" ? "md" : format}`;

    let warnings = [];
    const warningsHeader = headers["x-export-warnings"];
    if (warningsHeader) {
      try {
        warnings = JSON.parse(Buffer.from(warningsHeader, "base64").toString("utf-8"));
      } catch {
        // Documented header is base64 JSON; if it's somehow malformed,
        // don't fail the whole export over a warnings side-channel --
        // surface an empty list rather than throwing.
        warnings = [];
      }
    }

    return {
      fileBytes: Buffer.from(arrayBuffer),
      mimeType: headers["content-type"] ?? MIME_BY_FORMAT[format],
      filename,
      format,
      warnings,
    };
  };

  return withRetry({ attempt });
}

function extractFilename(contentDisposition) {
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(contentDisposition);
  return match ? decodeURIComponent(match[1]) : null;
}

function throwValidation(message) {
  const err = new Error(message);
  err.category = "validation";
  err.retryable = false;
  throw err;
}
