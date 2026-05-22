import { describe, it, expect, vi } from "vitest";
import { createLeadEventRoute } from "./route.js";

// Verifies the thing every Next.js consumer actually touches: HTTP
// status mapping, error-shape redaction, and the override hooks.

function makeOkUpstreamResponse(): Response {
  return new Response(
    JSON.stringify({
      event_id: "evt_123",
      status: "accepted",
      delivery_job_count: 1,
      workflow: "default",
    }),
    { status: 202, headers: { "X-Request-Id": "req_abc" } },
  );
}

function makeBody(): Record<string, unknown> {
  return {
    source: { source_system: "test" },
    lead: { email: "x@example.com" },
  };
}

function makeRequest(body: Record<string, unknown> = makeBody()): Request {
  return new Request("https://app.example.com/api/lead", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function baseRouteOptions(fetchMock: typeof fetch) {
  return {
    clientId: "cli_test",
    sourceId: "src_test",
    keyId: "key_test",
    signingSecret: "test-secret",
    fetch: fetchMock,
  };
}

describe("createLeadEventRoute", () => {
  describe("happy path", () => {
    it("returns 202 with { ok, event_id, status } on success", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeOkUpstreamResponse());
      const POST = createLeadEventRoute(baseRouteOptions(fetchMock));

      const res = await POST(makeRequest());
      expect(res.status).toBe(202);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ ok: true, event_id: "evt_123", status: "accepted" });
    });

    it("forwards the request body to the SDK (no mapRequest)", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeOkUpstreamResponse());
      const POST = createLeadEventRoute(baseRouteOptions(fetchMock));

      await POST(makeRequest({ source: { source_system: "test" }, lead: { email: "y@z.com" } }));

      const upstreamInit = fetchMock.mock.calls[0]![1];
      const upstreamBody = JSON.parse(upstreamInit?.body as string) as Record<string, unknown>;
      expect(upstreamBody.lead).toEqual({ email: "y@z.com" });
    });
  });

  describe("mapRequest", () => {
    it("transforms the incoming body before sending", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeOkUpstreamResponse());
      const POST = createLeadEventRoute({
        ...baseRouteOptions(fetchMock),
        mapRequest: (raw) => {
          const b = raw as { name: string; email: string };
          return {
            source: { source_system: "world-flags-feedback" },
            lead: { full_name: b.name, email: b.email },
          };
        },
      });

      const req = new Request("https://x.example/api/lead", {
        method: "POST",
        body: JSON.stringify({ name: "Alice", email: "a@b.com" }),
        headers: { "content-type": "application/json" },
      });
      await POST(req);

      const upstreamBody = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string) as {
        source: { source_system: string };
        lead: { full_name: string; email: string };
      };
      expect(upstreamBody.source.source_system).toBe("world-flags-feedback");
      expect(upstreamBody.lead).toEqual({ full_name: "Alice", email: "a@b.com" });
    });
  });

  describe("error handling", () => {
    it("preserves the upstream status when the SDK throws a LeadRailsApiError", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "schema_validation_failed", reason: "x" }), {
          status: 400,
        }),
      );
      const POST = createLeadEventRoute(baseRouteOptions(fetchMock));

      const res = await POST(makeRequest());
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ ok: false, error: "schema_validation_failed" });
    });

    it("preserves the upstream 401 when the SDK throws a LeadRailsAuthError", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "auth_failed" }), { status: 401 }),
      );
      const POST = createLeadEventRoute(baseRouteOptions(fetchMock));

      const res = await POST(makeRequest());
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "auth_failed" });
    });

    it("returns 500 + internal_error on any non-API error (no detail leaked)", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("kaboom — secret-ish details"));
      const POST = createLeadEventRoute(baseRouteOptions(fetchMock));

      const res = await POST(makeRequest());
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ ok: false, error: "internal_error" });
      // The "kaboom" detail must NOT appear in the response body.
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("kaboom");
    });

    it("returns 500 + internal_error when mapRequest itself throws", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeOkUpstreamResponse());
      const POST = createLeadEventRoute({
        ...baseRouteOptions(fetchMock),
        mapRequest: () => {
          throw new Error("bad input");
        },
      });

      const res = await POST(makeRequest());
      expect(res.status).toBe(500);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("response overrides", () => {
    it("honors formatSuccessResponse", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeOkUpstreamResponse());
      const POST = createLeadEventRoute({
        ...baseRouteOptions(fetchMock),
        formatSuccessResponse: (result) =>
          Response.json({ customShape: true, id: result.event_id }, { status: 201 }),
      });

      const res = await POST(makeRequest());
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ customShape: true, id: "evt_123" });
    });

    it("honors formatErrorResponse", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "schema_validation_failed" }), { status: 400 }),
      );
      const POST = createLeadEventRoute({
        ...baseRouteOptions(fetchMock),
        formatErrorResponse: (err) =>
          Response.json({ trapped: true, name: (err as Error).name }, { status: 422 }),
      });

      const res = await POST(makeRequest());
      expect(res.status).toBe(422);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.trapped).toBe(true);
    });
  });
});
