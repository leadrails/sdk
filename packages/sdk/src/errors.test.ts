import { describe, it, expect } from "vitest";
import {
  LeadRailsError,
  LeadRailsApiError,
  LeadRailsAuthError,
  LeadRailsConfigError,
} from "./errors.js";

// The marquee security claim: a LeadRailsError thrown anywhere in the
// SDK must not leak the signing secret to logs / stack traces /
// structured error reporters. This file pins that contract down.

const SECRET = "super-secret-signing-key-do-not-leak-xyz123";

describe("LeadRailsError.toString() redaction", () => {
  it("replaces the configured secret in the message with [REDACTED]", () => {
    const err = new LeadRailsApiError({
      status: 400,
      errorCode: "schema_validation_failed",
      requestId: "req_abc",
      body: null,
      message: `Failed with secret ${SECRET} inside`,
      redactPattern: SECRET,
    });
    const stringified = err.toString();
    expect(stringified).not.toContain(SECRET);
    expect(stringified).toContain("[REDACTED]");
  });

  it("replaces ALL occurrences when the secret appears multiple times", () => {
    const err = new LeadRailsApiError({
      status: 500,
      errorCode: "x",
      requestId: null,
      body: null,
      message: `first ${SECRET} middle ${SECRET} last ${SECRET}`,
      redactPattern: SECRET,
    });
    const out = err.toString();
    expect(out).not.toContain(SECRET);
    // [REDACTED] should appear three times.
    expect(out.match(/\[REDACTED\]/g)?.length).toBe(3);
  });

  it("is a no-op when no redactPattern is set", () => {
    const err = new LeadRailsConfigError("plain message with no secret here");
    expect(err.toString()).toBe("LeadRailsConfigError: plain message with no secret here");
  });

  it("does not falsely match unrelated text", () => {
    const err = new LeadRailsApiError({
      status: 400,
      errorCode: "x",
      requestId: null,
      body: null,
      message: "innocuous message with no secret",
      redactPattern: SECRET,
    });
    expect(err.toString()).toContain("innocuous message");
    expect(err.toString()).not.toContain("[REDACTED]");
  });
});

describe("LeadRailsError enumerability — JSON.stringify safety", () => {
  // Structured loggers (Sentry, Datadog, Pino) often call
  // JSON.stringify(err). Anything they would see must be safe to
  // index, store, and replay.

  it("does NOT expose the secret via _redactPattern in JSON.stringify", () => {
    const err = new LeadRailsApiError({
      status: 400,
      errorCode: "x",
      requestId: null,
      body: null,
      message: "any",
      redactPattern: SECRET,
    });
    const json = JSON.stringify(err);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("_redactPattern");
  });

  it("does NOT expose `name` as an enumerable own property", () => {
    // `name` is set non-enumerable so it stays out of JSON. Class
    // identity is still queryable via instanceof / err.name access.
    const err = new LeadRailsConfigError("any");
    const json = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    expect("name" in json).toBe(false);
    // But err.name still works.
    expect(err.name).toBe("LeadRailsConfigError");
  });

  it("does NOT expose the secret via Error's message field (Error sets it non-enumerable)", () => {
    // Standard Error semantics: `message` is a non-enumerable own
    // property. JSON.stringify of an Error subclass does not include
    // it, so a secret embedded in the message via redactPattern
    // protection is doubly safe (toString redacts it, JSON skips it).
    const err = new LeadRailsConfigError(`config rejected secret ${SECRET}`);
    const json = JSON.stringify(err);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("config rejected");
  });
});

describe("LeadRailsError public surface", () => {
  it("LeadRailsAuthError is a subclass of LeadRailsApiError", () => {
    const err = new LeadRailsAuthError({
      status: 401,
      errorCode: "auth_failed",
      requestId: null,
      body: null,
      message: "x",
    });
    expect(err).toBeInstanceOf(LeadRailsAuthError);
    expect(err).toBeInstanceOf(LeadRailsApiError);
    expect(err).toBeInstanceOf(LeadRailsError);
    expect(err).toBeInstanceOf(Error);
  });

  it("LeadRailsApiError exposes status, errorCode, requestId, body as own props", () => {
    const err = new LeadRailsApiError({
      status: 422,
      errorCode: "schema_validation_failed",
      requestId: "req_abc",
      body: { reason: "missing email" },
    });
    expect(err.status).toBe(422);
    expect(err.errorCode).toBe("schema_validation_failed");
    expect(err.requestId).toBe("req_abc");
    expect(err.body).toEqual({ reason: "missing email" });
  });

  it("LeadRailsApiError.name is the class name (useful for branching)", () => {
    const apiErr = new LeadRailsApiError({
      status: 500,
      errorCode: "x",
      requestId: null,
      body: null,
    });
    const authErr = new LeadRailsAuthError({
      status: 401,
      errorCode: "x",
      requestId: null,
      body: null,
    });
    expect(apiErr.name).toBe("LeadRailsApiError");
    expect(authErr.name).toBe("LeadRailsAuthError");
  });
});

describe("LeadRailsError.body — unredacted by design (known limitation)", () => {
  it("body IS exposed in JSON.stringify (callers must not put secrets in body)", () => {
    // Documents current behavior: if the server EVER echoes a signed
    // input back in the error body, that field reaches structured
    // logs unredacted. The intake server is expected never to do
    // this, but the SDK does NOT defend against it. If we ever need
    // body-side redaction, this test should change first.
    const err = new LeadRailsApiError({
      status: 400,
      errorCode: "x",
      requestId: null,
      body: { echoed_field: "some-value" },
      redactPattern: SECRET,
    });
    const json = JSON.parse(JSON.stringify(err)) as { body: Record<string, unknown> };
    expect(json.body).toEqual({ echoed_field: "some-value" });
  });
});
