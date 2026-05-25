// HTTP client for the LeadRails /v1 public API.
//
// Wraps `fetch` (WHATWG / Node 18+) with:
//   - Bearer-key Authorization header from `LEADRAILS_API_KEY`
//   - Idempotency-Key header (UUID v4) for every POST / PATCH / DELETE
//   - RFC-9457 problem-document parsing on non-2xx responses
//   - Structured error class so tool handlers can branch on:
//       * 401 (bad/expired key)
//       * 403 with `type` ending in `/plan-required` (events Pro+ gate)
//       * 429 (rate limited) — surfaces `Retry-After` header
//       * 5xx / network errors
//
// v1 invariant: the MCP server is a normal /v1 client. No admin
// shortcuts, no direct DB access, no bypassing rate limits. Every
// request goes through the same surface a 3rd-party SDK uses.
//
// We use bare `fetch` here (Node 18+ / WHATWG) and let each tool
// re-validate the response body against the matching Zod schema from
// the vendored `../schemas/` module (mirrors `@leadrails/schema/public`
// from the LeadRails monorepo). This keeps the SSOT principle intact
// without depending on a generated openapi-types artifact or pulling
// in `openapi-fetch` as a runtime dep.

import { randomUUID } from "node:crypto";

/**
 * Default API base URL. Customers override via `LEADRAILS_API_URL`
 * (e.g. when running against staging or a self-hosted instance).
 */
export const DEFAULT_API_URL = "https://api.leadrails.dev/v1";

/**
 * Options accepted by `createApiClient`. Both fields come from env vars
 * at the CLI entry point; tests pass them explicitly.
 *
 * `fetch` is injectable so unit tests can swap in a mock without
 * monkey-patching the global. Production code uses the WHATWG `fetch`
 * built into Node 18+ / the npx runtime.
 */
export interface ApiClientOptions {
  apiKey: string;
  apiUrl?: string | undefined;
  fetch?: typeof fetch | undefined;
}

/**
 * Surface a structured error so tool handlers can map status codes
 * onto MCP `content`-shaped error responses cleanly. The body is the
 * parsed RFC-9457 problem document when the server returns
 * `application/problem+json`; otherwise it's whatever the server sent
 * (or a synthetic envelope for network failures).
 */
export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly status: number;
  readonly body: ProblemDocument | { detail?: string } | undefined;
  readonly retryAfter: string | null;
  readonly requestId: string | null;

  constructor(args: {
    message: string;
    status: number;
    body?: ProblemDocument | { detail?: string } | undefined;
    retryAfter?: string | null | undefined;
    requestId?: string | null | undefined;
  }) {
    super(args.message);
    this.status = args.status;
    this.body = args.body;
    this.retryAfter = args.retryAfter ?? null;
    this.requestId = args.requestId ?? null;
  }

  /**
   * True if the failure is an RFC-9457 `plan-required` problem. The
   * /v1/events surface returns this on Free/Starter plans; the MCP
   * tool handlers branch on it to surface an upgrade hint in the
   * human-readable summary text.
   */
  get isPlanRequired(): boolean {
    if (this.status !== 403) return false;
    const type = (this.body as ProblemDocument | undefined)?.type;
    return typeof type === "string" && type.endsWith("/plan-required");
  }

  /** True if the failure is a 429 rate-limit response. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/**
 * Minimal RFC-9457 problem document shape — every field optional per
 * the spec (only `type` SHOULD be set to identify the problem class).
 */
export interface ProblemDocument {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  request_id?: string;
  // Vendor extensions (e.g. `code`, `field`, …) — keep open.
  [key: string]: unknown;
}

/**
 * Shape returned by every successful request. Includes the JSON body
 * plus a tiny slice of response metadata tool handlers may want to
 * surface (e.g. `Idempotent-Replayed` so the human summary can note
 * "this was a replay" if useful).
 */
export interface ApiResponse<T> {
  body: T;
  status: number;
  headers: Headers;
}

/**
 * Public factory. Returns a typed client with `get / post / patch /
 * delete` helpers. Each helper parses JSON, throws `ApiError` on
 * non-2xx, and forwards `Idempotency-Key` on mutating verbs.
 *
 * Tools should re-validate the parsed body against their resource's
 * Zod schema (e.g. `sourceSchema.parse(body)`) before returning it as
 * `structuredContent`. The client deliberately does NOT enforce the
 * schema itself — that would couple this module to every resource and
 * make it harder to add a new tool.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  if (!options.apiKey || typeof options.apiKey !== "string") {
    throw new Error(
      "LeadRails MCP: apiKey is required (set the LEADRAILS_API_KEY env var)",
    );
  }
  const baseUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;

  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    init: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<ApiResponse<T>> {
    const url = buildUrl(baseUrl, path, init.query);
    const headers = new Headers({
      Authorization: `Bearer ${options.apiKey}`,
      Accept: "application/json",
    });
    // `RequestInit.body` is `BodyInit | null` (not `… | undefined`) in
    // both WHATWG and the Cloudflare workers-types overlay, and
    // `exactOptionalPropertyTypes` forbids assigning `undefined`. So
    // we conditionally build the init object instead of setting
    // `body: undefined`.
    const fetchInit: { method: string; headers: Headers; body?: string } = {
      method,
      headers,
    };
    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
      fetchInit.body = JSON.stringify(init.body);
    }
    // Idempotency-Key on every mutating verb. The v1 spec mandates this
    // header on POST/PATCH; we also stamp DELETE for consistency
    // (idempotent by definition, but the server still caches the
    // response so a network retry returns the same payload).
    if (method !== "GET") {
      headers.set("Idempotency-Key", randomUUID());
    }

    let response: Response;
    try {
      response = await fetchImpl(url, fetchInit);
    } catch (cause) {
      throw new ApiError({
        message: `Network error calling ${method} ${path}: ${String((cause as Error)?.message ?? cause)}`,
        status: 0,
      });
    }

    const requestId = response.headers.get("x-request-id");
    if (response.ok) {
      // 204 No Content is valid for some endpoints; return an empty
      // object so tool handlers can still construct
      // structuredContent: { deleted: true } etc. without crashing on
      // an empty body.
      if (response.status === 204) {
        return { body: {} as T, status: response.status, headers: response.headers };
      }
      const parsed = (await response.json().catch(() => ({}))) as T;
      return { body: parsed, status: response.status, headers: response.headers };
    }

    // Failure path — try problem+json first, fall back to plain JSON
    // or text. Either way produces an ApiError the tool can branch on.
    const retryAfter = response.headers.get("retry-after");
    const contentType = response.headers.get("content-type") ?? "";
    let parsedBody: ProblemDocument | { detail?: string } | undefined;
    try {
      if (contentType.includes("json")) {
        parsedBody = (await response.json()) as ProblemDocument;
      } else {
        const text = await response.text();
        parsedBody = { detail: text };
      }
    } catch {
      parsedBody = undefined;
    }
    const detail =
      (parsedBody as ProblemDocument | undefined)?.detail ??
      (parsedBody as ProblemDocument | undefined)?.title ??
      `HTTP ${response.status}`;
    throw new ApiError({
      message: `${method} ${path} failed: ${detail}`,
      status: response.status,
      body: parsedBody,
      retryAfter,
      requestId,
    });
  }

  return {
    get<T>(path: string, query?: Record<string, string | number | undefined>) {
      return request<T>("GET", path, { query: query ?? {} });
    },
    post<T>(path: string, body?: unknown) {
      return request<T>("POST", path, body === undefined ? {} : { body });
    },
    patch<T>(path: string, body: unknown) {
      return request<T>("PATCH", path, { body });
    },
    delete<T>(path: string) {
      return request<T>("DELETE", path, {});
    },
    baseUrl,
  };
}

/**
 * Public type of the client returned by `createApiClient`. Exported so
 * tool-registration helpers can accept the client without depending on
 * the factory's internal shape.
 */
export interface ApiClient {
  get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<ApiResponse<T>>;
  post<T>(path: string, body?: unknown): Promise<ApiResponse<T>>;
  patch<T>(path: string, body: unknown): Promise<ApiResponse<T>>;
  delete<T>(path: string): Promise<ApiResponse<T>>;
  readonly baseUrl: string;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, string | number | undefined> | undefined,
): string {
  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}
