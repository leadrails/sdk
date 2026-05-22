import { describe, it, expect } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { sha256Hex, hmacSha256Base64, buildSignatureBaseString } from "./sign.js";

// Cross-check: the SDK's Web Crypto signing must produce the same
// bytes as Node's native crypto. A regression here would cause the
// intake worker to reject every signed request with `auth_failed` —
// silent customer-facing breakage.

describe("sha256Hex", () => {
  it.each([
    "",
    "hello",
    "the quick brown fox jumps over the lazy dog",
    "unicode — naïve résumé 🚀",
    JSON.stringify({ a: 1, b: [2, 3], c: "x" }),
  ])("matches Node's crypto.createHash for %j", async (input) => {
    const expected = createHash("sha256").update(input, "utf8").digest("hex");
    const actual = await sha256Hex(input);
    expect(actual).toBe(expected);
  });

  it("returns 64 lowercase hex characters", async () => {
    const out = await sha256Hex("anything");
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hmacSha256Base64", () => {
  it.each([
    ["secret-1", "POST.lead-events.123"],
    ["another-secret", ""],
    ["k", "a longer message with spaces and 数字 and 🔐"],
    ["s", "x".repeat(10_000)],
  ])("matches Node's crypto.createHmac for secret=%j message=%j", async (secret, message) => {
    const expected = createHmac("sha256", secret).update(message, "utf8").digest("base64");
    const actual = await hmacSha256Base64(secret, message);
    expect(actual).toBe(expected);
  });

  it("is deterministic", async () => {
    const a = await hmacSha256Base64("secret", "message");
    const b = await hmacSha256Base64("secret", "message");
    expect(a).toBe(b);
  });

  it("differs when secret differs by one byte", async () => {
    const a = await hmacSha256Base64("secret-a", "msg");
    const b = await hmacSha256Base64("secret-b", "msg");
    expect(a).not.toBe(b);
  });

  it("differs when message differs by one byte", async () => {
    const a = await hmacSha256Base64("secret", "msg-a");
    const b = await hmacSha256Base64("secret", "msg-b");
    expect(a).not.toBe(b);
  });
});

describe("buildSignatureBaseString", () => {
  it("joins fields with '.' in the documented order", () => {
    const out = buildSignatureBaseString({
      timestamp: "2026-05-22T00:00:00.000Z",
      nonce: "abc123",
      idempotencyKey: "idem-xyz",
      method: "POST",
      pathname: "/v1/lead-events",
      bodySha256Hex: "deadbeef",
    });
    expect(out).toBe(
      "2026-05-22T00:00:00.000Z.abc123.idem-xyz.post./v1/lead-events.deadbeef",
    );
  });

  it("lowercases the HTTP method", () => {
    const out = buildSignatureBaseString({
      timestamp: "t",
      nonce: "n",
      idempotencyKey: "i",
      method: "POST",
      pathname: "/p",
      bodySha256Hex: "b",
    });
    expect(out).toContain(".post.");
    expect(out).not.toContain(".POST.");
  });

  it("preserves dots in input fields verbatim (caller's responsibility)", () => {
    // Documenting current behavior: if the caller passes a value
    // containing ".", the base string is ambiguous to parse — but
    // the SDK signs over the joined string, the server verifies the
    // same joined string, so byte-equality is what matters.
    const out = buildSignatureBaseString({
      timestamp: "ts.with.dots",
      nonce: "n",
      idempotencyKey: "i",
      method: "post",
      pathname: "/p",
      bodySha256Hex: "b",
    });
    expect(out).toBe("ts.with.dots.n.i.post./p.b");
  });
});
