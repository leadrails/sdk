// Shared helpers for building MCP tool responses.
//
// Every tool registered by `@leadrails/mcp` emits a "dual-emit" response:
//
//   {
//     structuredContent: <typed object>,       // machine-readable; JSON-Schema validated
//     content: [{ type: "text", text: ... }],  // human-readable summary + JSON dump
//   }
//
// MCP spec: clients that understand `structuredContent` (Claude
// Desktop 1.6+, Claude Code, ChatGPT MCP, Cursor) bind the typed value
// directly to the tool's `outputSchema`; clients that only render `content`
// still see a friendly multi-line summary. The first 1–3 lines are the
// summary an LLM should read aloud / show to the user; the trailing
// `JSON.stringify(...)` block is for agents that want to feed the full
// payload back into their reasoning loop without a second tool call.
//
// Centralizing the shape here ensures:
//   - every tool emits the same key order, the same JSON indentation, and
//     the same upgrade-hint / retry-after surface on error paths;
//   - changing the wire format (e.g. switching to YAML, adding a per-tool
//     resource link) is a one-file change instead of a 23-file change.

import type { ApiError } from "./api-client.js";

/**
 * Shape MCP SDK 1.29 expects from a tool handler. We narrow it from the
 * SDK's exported `CallToolResult` so dependents on this module don't have
 * to pull the SDK type — keeps tool factories testable without the SDK.
 */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Build a successful dual-emit response.
 *
 * @param summary  1–3 lines of human-readable description. Plain text;
 *                 no Markdown. Newlines render as paragraph breaks in
 *                 Claude Desktop / Code chat surfaces.
 * @param data     The typed payload to attach as `structuredContent` and
 *                 to dump as pretty JSON in the trailing text block.
 */
export function successResult<T extends Record<string, unknown>>(
  summary: string,
  data: T,
): ToolResult {
  return {
    structuredContent: data,
    content: [
      {
        type: "text",
        text: `${summary}\n\n${JSON.stringify(data, null, 2)}`,
      },
    ],
  };
}

/**
 * Build a successful dual-emit response from a list-shaped payload.
 *
 * Convenience over `successResult` because list responses share the
 * same `{ data, has_more, next_cursor }` envelope; the summary line
 * benefits from showing the count + the presence of a next page.
 */
export function listResult<TItem>(
  resource: string,
  payload: { data: TItem[]; has_more: boolean; next_cursor: string | null },
): ToolResult {
  const count = payload.data.length;
  const more = payload.has_more
    ? ` (more available — pass cursor=${JSON.stringify(payload.next_cursor)} to continue)`
    : "";
  return successResult(`Listed ${count} ${resource}${more}.`, payload as unknown as Record<string, unknown>);
}

/**
 * Build a tool-error response from a thrown `ApiError`. Surfaces:
 *
 *   - 401 → "API key was rejected" + request_id (no body leak; the
 *           bearer is the secret, but the problem document might
 *           include identifying detail like which prefix was used).
 *   - 403 + `plan-required` → upgrade-hint message pulled from the
 *     problem document's `detail`, falling back to a generic upsell.
 *   - 403 other → forwards `detail` verbatim.
 *   - 429 → surfaces `Retry-After` seconds, suggests pacing.
 *   - 5xx / network → forwards `detail` plus the LeadRails request id
 *     so support can grep logs.
 *
 * Every error response sets `isError: true` so MCP clients render the
 * message in error-styled UI and the LLM knows the call did NOT succeed.
 */
export function errorResult(err: ApiError): ToolResult {
  const requestId = err.requestId ? ` (request_id=${err.requestId})` : "";
  let summary: string;
  if (err.status === 0) {
    summary = `Network error calling LeadRails: ${err.message}`;
  } else if (err.status === 401) {
    summary =
      "LeadRails rejected the API key (401). " +
      "Check that LEADRAILS_API_KEY is set to a valid `lr_live_…` key and " +
      "that the key has not been revoked.";
  } else if (err.isPlanRequired) {
    const detail =
      (err.body as { detail?: string } | undefined)?.detail ??
      "This endpoint requires a Pro plan or higher.";
    summary =
      `${detail} ` +
      "Upgrade your workspace at https://leadrails.dev/billing — events " +
      "read access (query_events / get_event / get_delivery_jobs_for_event) " +
      "is gated to Pro, Agency, and Scale plans.";
  } else if (err.isRateLimited) {
    const retry = err.retryAfter ? `${err.retryAfter}s` : "a few seconds";
    summary =
      `LeadRails rate-limited this request (429). Retry after ${retry}. ` +
      "Per-key quotas are documented at https://docs.leadrails.dev/rate-limits.";
  } else if (err.status >= 500) {
    summary =
      `LeadRails returned ${err.status}${requestId}. ` +
      `Detail: ${(err.body as { detail?: string } | undefined)?.detail ?? err.message}`;
  } else {
    summary =
      `LeadRails returned ${err.status}${requestId}. ` +
      `Detail: ${(err.body as { detail?: string } | undefined)?.detail ?? err.message}`;
  }
  const bodyDump = err.body ? `\n\n${JSON.stringify(err.body, null, 2)}` : "";
  return {
    isError: true,
    content: [{ type: "text", text: `${summary}${bodyDump}` }],
  };
}
