// Tests for the dual-emit shape helpers.
//
// What we want to verify:
//   - `successResult` emits both `structuredContent` and a single
//     `content[0].text` block that includes the summary + the
//     stringified JSON.
//   - `listResult` summary mentions count, and adds an explicit "more
//     available" hint when `has_more` is true.
//   - `errorResult` branches:
//        401  → mentions LEADRAILS_API_KEY in the summary.
//        403 + plan-required → surfaces the upgrade hint URL.
//        429  → mentions Retry-After.
//        5xx  → mentions request_id when present.
//        0    → mentions "Network error".
//   - Every error result sets `isError: true`.

import { describe, it, expect } from "vitest";
import { ApiError } from "./api-client.js";
import { errorResult, listResult, successResult } from "./dual-emit.js";

describe("successResult", () => {
  it("returns both structuredContent and a content[0].text block", () => {
    const out = successResult("Hello", { foo: "bar" });
    expect(out.structuredContent).toEqual({ foo: "bar" });
    expect(out.content).toHaveLength(1);
    expect(out.content[0]!.type).toBe("text");
    expect(out.content[0]!.text).toContain("Hello");
    expect(out.content[0]!.text).toContain('"foo": "bar"');
    expect(out.isError).toBeUndefined();
  });
});

describe("listResult", () => {
  it("mentions count and skips the more-available hint when has_more is false", () => {
    const out = listResult("source(s)", {
      data: [1, 2, 3],
      has_more: false,
      next_cursor: null,
    });
    expect(out.content[0]!.text).toContain("Listed 3 source(s).");
    expect(out.content[0]!.text).not.toContain("more available");
  });

  it("surfaces the next cursor when has_more is true", () => {
    const out = listResult("event(s)", {
      data: [1],
      has_more: true,
      next_cursor: "cur_abc",
    });
    expect(out.content[0]!.text).toContain("more available");
    expect(out.content[0]!.text).toContain('"cur_abc"');
  });
});

describe("errorResult", () => {
  it("flags 401 with the LEADRAILS_API_KEY hint", () => {
    const out = errorResult(
      new ApiError({
        message: "GET /me failed: invalid key",
        status: 401,
      }),
    );
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain("LEADRAILS_API_KEY");
  });

  it("surfaces the upgrade hint for plan-required problems", () => {
    const out = errorResult(
      new ApiError({
        message: "GET /events failed: plan required",
        status: 403,
        body: {
          type: "https://docs.leadrails.dev/errors/plan-required",
          detail: "Events read requires Pro, Agency, or Scale.",
        },
      }),
    );
    expect(out.content[0]!.text).toContain("Pro");
    expect(out.content[0]!.text).toContain("https://leadrails.dev/billing");
  });

  it("surfaces Retry-After on 429", () => {
    const out = errorResult(
      new ApiError({
        message: "GET /sources failed: rate limited",
        status: 429,
        retryAfter: "12",
      }),
    );
    expect(out.content[0]!.text).toContain("Retry after 12s");
  });

  it("includes request_id on 5xx errors", () => {
    const out = errorResult(
      new ApiError({
        message: "GET /me failed: boom",
        status: 500,
        requestId: "req_01J5",
        body: { detail: "internal" },
      }),
    );
    expect(out.content[0]!.text).toContain("500");
    expect(out.content[0]!.text).toContain("request_id=req_01J5");
  });

  it("calls out network errors explicitly (status 0)", () => {
    const out = errorResult(
      new ApiError({
        message: "Network error calling GET /me: ECONNREFUSED",
        status: 0,
      }),
    );
    expect(out.content[0]!.text).toContain("Network error");
  });
});
