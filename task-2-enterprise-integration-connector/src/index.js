export { SuperDocsClient, DEFAULT_BASE_URL } from "./client.js";
export { SuperDocsApiError, classifyHttpError, classifyNetworkError } from "./errors.js";
export { withRetry, computeBackoffMs } from "./retry.js";
export * from "./schema.js";

export { generateFromTemplate } from "./operations/generateFromTemplate.js";
export { editByInstruction } from "./operations/editByInstruction.js";
export { submitForApproval, parsePendingChanges } from "./operations/submitForApproval.js";
export { pollForCompletion, resolvePollOutcome } from "./operations/pollForCompletion.js";
export { fetchExport } from "./operations/fetchExport.js";
