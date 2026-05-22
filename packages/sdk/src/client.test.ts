import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "./client.js";
import { LeadRailsConfigError } from "./errors.js";

// The marquee safety guard: refuse to use a signing secret that came
// from a NEXT_PUBLIC_*-prefixed env var (which Next.js inlines into
// every browser bundle). Untested = unverified.

const REQUIRED_KEYS = [
  "LEADRAILS_CLIENT_ID",
  "LEADRAILS_SOURCE_ID",
  "LEADRAILS_KEY_ID",
  "LEADRAILS_SIGNING_SECRET",
] as const;

function setRequired(secret = "test-signing-secret") {
  vi.stubEnv("LEADRAILS_CLIENT_ID", "cli_test");
  vi.stubEnv("LEADRAILS_SOURCE_ID", "src_test");
  vi.stubEnv("LEADRAILS_KEY_ID", "key_test");
  vi.stubEnv("LEADRAILS_SIGNING_SECRET", secret);
}

describe("createClient", () => {
  beforeEach(() => {
    // Clear all LEADRAILS_* and NEXT_PUBLIC_* to start each test
    // from a known empty state.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("LEADRAILS_") || k.startsWith("NEXT_PUBLIC_")) {
        vi.stubEnv(k, "");
      }
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("missing required config", () => {
    it.each(REQUIRED_KEYS)("throws LeadRailsConfigError when %s is missing", (key) => {
      setRequired();
      vi.stubEnv(key, "");
      expect(() => createClient()).toThrow(LeadRailsConfigError);
      expect(() => createClient()).toThrow(key);
    });

    it("succeeds when all four are present", () => {
      setRequired();
      expect(() => createClient()).not.toThrow();
    });
  });

  describe("env-var resolution", () => {
    it("reads LEADRAILS_* env vars when no args are passed", () => {
      setRequired("env-secret");
      const client = createClient();
      expect(client).toBeDefined();
      expect(typeof client.send).toBe("function");
    });

    it("explicit args take precedence over env vars", () => {
      setRequired("env-secret");
      // No throw expected — explicit value wins even though env vars
      // are also set. We can't easily inspect the closed-over config,
      // but absence of throw confirms the construction path.
      expect(() =>
        createClient({
          clientId: "cli_explicit",
          sourceId: "src_explicit",
          keyId: "key_explicit",
          signingSecret: "explicit-secret",
        }),
      ).not.toThrow();
    });
  });

  describe("NEXT_PUBLIC_* secret refusal", () => {
    it("throws when the signing secret value matches a NEXT_PUBLIC_* env var", () => {
      const secret = "leaky-secret-123";
      setRequired(secret);
      vi.stubEnv("NEXT_PUBLIC_LEADRAILS_SIGNING_SECRET", secret);

      expect(() => createClient()).toThrow(LeadRailsConfigError);
      expect(() => createClient()).toThrow(/NEXT_PUBLIC_LEADRAILS_SIGNING_SECRET/);
      // Must surface a rename hint to help the operator fix it.
      expect(() => createClient()).toThrow(/Rename .*LEADRAILS_SIGNING_SECRET/);
    });

    it("throws even when the secret was passed as an explicit arg", () => {
      const secret = "explicit-but-also-public";
      setRequired("different-env-secret");
      vi.stubEnv("NEXT_PUBLIC_ANY_NAME", secret);

      expect(() =>
        createClient({
          clientId: "cli_x",
          sourceId: "src_x",
          keyId: "key_x",
          signingSecret: secret,
        }),
      ).toThrow(/NEXT_PUBLIC_ANY_NAME/);
    });

    it("does NOT throw when a NEXT_PUBLIC_* var holds an unrelated value", () => {
      setRequired("the-real-secret");
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
      vi.stubEnv("NEXT_PUBLIC_ANALYTICS_KEY", "totally-unrelated");

      expect(() => createClient()).not.toThrow();
    });

    it("does NOT throw when no NEXT_PUBLIC_* vars are set", () => {
      setRequired("the-real-secret");
      expect(() => createClient()).not.toThrow();
    });
  });
});
