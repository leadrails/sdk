// Tests for the bare-fetch HTTP wrapper.
//
// What we want to verify:
//   - Authorization header is `Bearer <key>`.
//   - Idempotency-Key is set on POST/PATCH/DELETE (UUID v4 shape) but
//     NOT on GET.
//   - JSON body is serialized + Content-Type set when body is supplied.
//   - 2xx responses parse JSON and return `{ body, status, headers }`.
//   - 204 No Content returns an empty object body (don't try to
//     JSON.parse an empty stream).
//   - Non-2xx responses throw `ApiError` with the parsed problem doc.
//   - 403 plan-required → `err.isPlanRequired === true`.
//   - 429 → `err.retryAfter` carries the `Retry-After` header.
//   - Network errors throw `ApiError` with `status: 0`.
//
// `fetch` is injected via the `fetch` option on `createApiClient`, so
// these tests don't depend on the global being installed.

import { describe, it, expect } from "vitest";
import { ApiError, createApiClient, DEFAULT_API_URL } from "./api-client.js";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("createApiClient", () => {
  it("requires an apiKey", () => {
    expect(() => createApiClient({ apiKey: "" })).toThrow(/apiKey/);
  });

  it("defaults to the prod API URL when apiUrl is not supplied", async () => {
    const seen: string[] = [];
    const client = createApiClient({
      apiKey: "lr_live_x",
      fetch: async (url: RequestInfo | URL) => {
        seen.push(String(url));
        return jsonResponse({ ok: true });
      },
    });
    await client.get("/me");
    expect(seen[0]).toBe(`${DEFAULT_API_URL}/me`);
  });

  it("sets Authorization: Bearer and Accept: application/json on every request", async () => {
    let capturedHeaders: Headers | undefined;
    const client = createApiClient({
      apiKey: "lr_live_x",
      apiUrl: "http://test/v1",
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = init?.headers as Headers;
        return jsonResponse({ ok: true });
      },
    });
    await client.get("/me");
    expect(capturedHeaders?.get("authorization")).toBe("Bearer lr_live_x");
    expect(capturedHeaders?.get("accept")).toBe("application/json");
  });

  it("does NOT send Idempotency-Key on GET", async () => {
    let capturedHeaders: Headers | undefined;
    const client = createApiClient({
      apiKey: "lr_live_x",
      apiUrl: "http://test/v1",
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = init?.headers as Headers;
        return jsonResponse({ ok: true });
      },
    });
    await client.get("/me");
    expect(capturedHeaders?.get("idempotency-key")).toBeNull();
  });

  it("stamps a fresh UUID v4 Idempotency-Key on POST / PATCH / DELETE", async () => {
    const keys: string[] = [];
    const client = createApiClient({
      apiKey: "lr_live_x",
      apiUrl: "http://test/v1",
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        const k = (init?.headers as Headers).get("idempotency-key");
        if (k) keys.push(k);
        return jsonResponse({ ok: true });
      },
    });
    await client.post("/sources", { name: "x" });
    await client.patch("/sources/src_1", { name: "y" });
    await client.delete("/routes/rt_1");
    expect(keys).toHaveLength(3);
    for (const k of keys) expect(k).toMatch(UUID_V4_RE);
    // All distinct.
    expect(new Set(keys).size).toBe(3);
  });

  it("serializes JSON body + sets Content-Type when body is supplied", async () => {
    let capturedHeaders: Headers | undefined;
    let capturedBody: string | undefined;
    const client = createApiClient({
      apiKey: "lr_live_x",
      apiUrl: "http://test/v1",
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = init?.headers as Headers;
        capturedBody = init?.body as string;
        return jsonResponse({ ok: true });
      },
    });
    await client.post("/sources", { name: "Form A" });
    expect(capturedHeaders?.get("content-type")).toBe("application/json");
    expect(JSON.parse(capturedBody!)).toEqual({ name: "Form A" });
  });

  it("returns an empty body object for 204 responses", async () => {
    const client = createApiClient({
      apiKey: "lr_live_x",
      apiUrl: "http://test/v1",
      fetch: async () =>
        new Response(null, { status: 204 }),
    });
    const res = await client.delete("/routes/rt_1");
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it("throws ApiError with parsed problem doc on 4xx", async () => {
    const client = createApiClient({
      apiKey: "lr_live_x",
      apiUrl: "http://test/v1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            type: "https://docs.leadrails.dev/errors/not-found",
            title: "Source not found",
            detail: "no source with id src_unknown",
          }),
          {
            status: 404,
            headers: {
              "content-type": "application/problem+json",
              "x-request-id": "req_01J0",
            },
          },
        ),
    });
    await expect(client.get("/sources/src_unknown")).rejects.toMatchObject({
      status: 404,
      requestId: "req_01J0",
      body: expect.objectContaining({ title: "Source not found" }),
    });
  });

  it("marks 403 plan-required problems via isPlanRequired", async () => {
    const client = createApiClient({
      apiKey: "lr_live_x",
      apiUrl: "http://test/v1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            type: "https://docs.leadrails.dev/errors/plan-required",
            detail: "Events read requires Pro+",
          }),
          {
            status: 403,
            headers: { "content-type": "application/problem+json" },
          },
        ),
    });
    try {
      await client.get("/events");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).isPlanRequired).toBe(true);
    }
  });

  it("carries Retry-After on 429", async () => {
    const client = createApiClient({
      apiKey: "lr_live_x",
      apiUrl: "http://test/v1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            type: "https://docs.leadrails.dev/errors/rate-limited",
            detail: "Slow down",
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/problem+json",
              "retry-after": "12",
            },
          },
        ),
    });
    try {
      await client.get("/sources");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).isRateLimited).toBe(true);
      expect((err as ApiError).retryAfter).toBe("12");
    }
  });

  it("translates network errors into ApiError(status: 0)", async () => {
    const client = createApiClient({
      apiKey: "lr_live_x",
      apiUrl: "http://test/v1",
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    try {
      await client.get("/me");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
      expect((err as ApiError).message).toMatch(/Network error/);
    }
  });
});
