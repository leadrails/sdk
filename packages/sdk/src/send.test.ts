import { describe, it, expect, vi } from "vitest";
import { createHmac, createHash } from "node:crypto";
import { sendLeadEvent } from "./send.js";
import { LeadRailsApiError, LeadRailsAuthError } from "./errors.js";
import type { LeadEventV1 } from "./types.js";

// Verifies the on-the-wire contract: headers, signature math against
// the canonical base string, default API URL, HTTP status mapping,
// and one-retry-on-TypeError. Any silent change here would break
// every customer's intake auth without throwing locally.

const FIXED_NOW = new Date("2026-05-22T12:00:00.000Z");

function makeEvent(): LeadEventV1 {
  return {
    schema_version: "lead_event.v1",
    event_type: "lead.submitted",
    submitted_at: FIXED_NOW.toISOString(),
    source: { source_system: "test" },
    lead: { email: "x@example.com" },
  };
}

function makeOkResponse(body: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      event_id: "evt_123",
      status: "accepted",
      delivery_job_count: 1,
      workflow: "default",
      ...body,
    }),
    { status: 202, headers: { "X-Request-Id": "req_abc" } },
  );
}

function baseConfig(fetchMock: typeof fetch) {
  return {
    clientId: "cli_test",
    sourceId: "src_test",
    keyId: "key_test",
    signingSecret: "test-secret",
    fetch: fetchMock,
    now: () => FIXED_NOW,
    idempotencyKey: "fixed-idem-key",
  };
}

describe("sendLeadEvent", () => {
  describe("request shape", () => {
    it("POSTs to the default API URL when none is provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
      await sendLeadEvent(makeEvent(), baseConfig(fetchMock));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://intake.leadrails.dev/v1/lead-events");
      expect(init?.method).toBe("POST");
    });

    it("honors a custom apiUrl and strips trailing slashes", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
      await sendLeadEvent(makeEvent(), {
        ...baseConfig(fetchMock),
        apiUrl: "https://staging.intake.leadrails.dev///",
      });

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://staging.intake.leadrails.dev/v1/lead-events");
    });

    it("sends a JSON body matching the event", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
      const event = makeEvent();
      await sendLeadEvent(event, baseConfig(fetchMock));

      const init = fetchMock.mock.calls[0]![1];
      expect(init?.body).toBe(JSON.stringify(event));
    });

    it("sets the documented identification + signing headers", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
      await sendLeadEvent(makeEvent(), baseConfig(fetchMock));

      const init = fetchMock.mock.calls[0]![1];
      const headers = init?.headers as Record<string, string>;

      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-LR-Client-Id"]).toBe("cli_test");
      expect(headers["X-LR-Source-Id"]).toBe("src_test");
      expect(headers["X-LR-Key-Id"]).toBe("key_test");
      expect(headers["X-LR-Timestamp"]).toBe(FIXED_NOW.toISOString());
      expect(headers["X-LR-Idempotency-Key"]).toBe("fixed-idem-key");
      expect(headers["X-LR-Nonce"]).toMatch(/^[0-9a-f]{32}$/);
      expect(headers["X-LR-Signature"]).toMatch(/^v1=/);
    });

    it("produces a signature that matches Node's HMAC over the canonical base string", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
      const event = makeEvent();
      await sendLeadEvent(event, baseConfig(fetchMock));

      const init = fetchMock.mock.calls[0]![1];
      const headers = init?.headers as Record<string, string>;
      const nonce = headers["X-LR-Nonce"]!;
      const sentSignature = headers["X-LR-Signature"]!.replace(/^v1=/, "");

      // Reconstruct the base string with the same inputs the SDK
      // used, then HMAC it with Node's crypto — must match.
      const body = JSON.stringify(event);
      const bodySha = createHash("sha256").update(body, "utf8").digest("hex");
      const baseString = [
        FIXED_NOW.toISOString(),
        nonce,
        "fixed-idem-key",
        "post",
        "/v1/lead-events",
        bodySha,
      ].join(".");
      const expectedSignature = createHmac("sha256", "test-secret")
        .update(baseString, "utf8")
        .digest("base64");

      expect(sentSignature).toBe(expectedSignature);
    });
  });

  describe("response handling", () => {
    it("returns the parsed result on success", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeOkResponse({ event_id: "evt_999", workflow: "wf_main" }));
      const result = await sendLeadEvent(makeEvent(), baseConfig(fetchMock));

      expect(result).toEqual({
        event_id: "evt_999",
        status: "accepted",
        delivery_job_count: 1,
        workflow: "wf_main",
        requestId: "req_abc",
      });
    });

    it("throws LeadRailsAuthError on 401", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "auth_failed", reason: "bad signature" }), {
          status: 401,
        }),
      );
      await expect(sendLeadEvent(makeEvent(), baseConfig(fetchMock))).rejects.toBeInstanceOf(
        LeadRailsAuthError,
      );
    });

    it("throws LeadRailsApiError on non-401 non-2xx", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "schema_validation_failed" }), { status: 400 }),
      );
      const err = await sendLeadEvent(makeEvent(), baseConfig(fetchMock)).catch((e) => e);
      expect(err).toBeInstanceOf(LeadRailsApiError);
      expect(err).not.toBeInstanceOf(LeadRailsAuthError);
      expect((err as LeadRailsApiError).status).toBe(400);
      expect((err as LeadRailsApiError).errorCode).toBe("schema_validation_failed");
    });

    it("falls back to http_<status> when the response has no `error` field", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 502 }));
      await expect(sendLeadEvent(makeEvent(), baseConfig(fetchMock))).rejects.toMatchObject({
        errorCode: "http_502",
        status: 502,
      });
    });
  });

  describe("retries and observability", () => {
    it("retries once on a TypeError ('fetch failed')", async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(makeOkResponse());

      await sendLeadEvent(makeEvent(), baseConfig(fetchMock));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry on AbortError", async () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      const fetchMock = vi.fn().mockRejectedValue(abort);

      await expect(sendLeadEvent(makeEvent(), baseConfig(fetchMock))).rejects.toThrow("aborted");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("fires onRequest on success with the response status + requestId", async () => {
      const onRequest = vi.fn();
      const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
      await sendLeadEvent(makeEvent(), { ...baseConfig(fetchMock), onRequest });

      expect(onRequest).toHaveBeenCalledTimes(1);
      expect(onRequest.mock.calls[0]![0]).toMatchObject({
        status: 202,
        method: "POST",
        requestId: "req_abc",
      });
    });

    it("fires onError when the upstream returns non-2xx", async () => {
      const onError = vi.fn();
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "auth_failed" }), { status: 401 }),
      );
      await sendLeadEvent(makeEvent(), { ...baseConfig(fetchMock), onError }).catch(() => {});
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(LeadRailsAuthError);
    });
  });
});
