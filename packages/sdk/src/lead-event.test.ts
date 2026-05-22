import { describe, it, expect } from "vitest";
import { leadEvent } from "./lead-event.js";

// The most likely place to silently mis-shape a payload before it
// reaches the wire. Lock down the defaults + the FormData mapping.

describe("leadEvent", () => {
  it("pre-fills schema_version, event_type, and submitted_at", () => {
    const event = leadEvent({
      source: { source_system: "test" },
      lead: { email: "x@example.com" },
    });

    expect(event.schema_version).toBe("lead_event.v1");
    expect(event.event_type).toBe("lead.submitted");
    expect(event.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("preserves an explicit submitted_at", () => {
    const event = leadEvent({
      source: { source_system: "test" },
      lead: { email: "x@example.com" },
      submitted_at: "2026-01-15T10:30:00.000Z",
    });
    expect(event.submitted_at).toBe("2026-01-15T10:30:00.000Z");
  });

  it("only adds optional fields when they are provided (no undefined keys)", () => {
    const event = leadEvent({
      source: { source_system: "test" },
      lead: { email: "x@example.com" },
    });
    expect("workflow" in event).toBe(false);
    expect("workflow_name" in event).toBe(false);
    expect("location" in event).toBe(false);
    expect("attribution" in event).toBe(false);
    expect("consent" in event).toBe(false);
    expect("custom_fields" in event).toBe(false);
  });

  it("passes through provided optional fields", () => {
    const event = leadEvent({
      source: { source_system: "test" },
      lead: { email: "x@example.com" },
      workflow: "wf_main",
      attribution: { utm_source: "google" },
    });
    expect(event.workflow).toBe("wf_main");
    expect(event.attribution).toEqual({ utm_source: "google" });
  });
});

describe("leadEvent.fromFormData", () => {
  it("maps lead.* / attribution.* / custom_fields.* paths to their groups", () => {
    const fd = new FormData();
    fd.set("name", "Alice");
    fd.set("emailAddr", "alice@example.com");
    fd.set("utm", "twitter");
    fd.set("plan", "pro");

    const event = leadEvent.fromFormData(fd, {
      source: { source_system: "test" },
      fields: {
        "lead.full_name": "name",
        "lead.email": "emailAddr",
        "attribution.utm_source": "utm",
        "custom_fields.plan": "plan",
      },
    });

    expect(event.lead).toEqual({ full_name: "Alice", email: "alice@example.com" });
    expect(event.attribution).toEqual({ utm_source: "twitter" });
    expect(event.custom_fields).toEqual({ plan: "pro" });
  });

  it("skips fields whose form key is absent (null) — no empty strings sent", () => {
    const fd = new FormData();
    fd.set("name", "Alice");
    // emailAddr deliberately not set

    const event = leadEvent.fromFormData(fd, {
      source: { source_system: "test" },
      fields: {
        "lead.full_name": "name",
        "lead.email": "emailAddr",
      },
    });

    expect(event.lead).toEqual({ full_name: "Alice" });
    expect("email" in (event.lead ?? {})).toBe(false);
  });

  it("does not add empty groups (no `location: {}` if no location.* fields matched)", () => {
    const fd = new FormData();
    fd.set("name", "Alice");

    const event = leadEvent.fromFormData(fd, {
      source: { source_system: "test" },
      fields: {
        "lead.full_name": "name",
        "location.city": "city", // form key not in fd → skipped
      },
    });

    expect("location" in event).toBe(false);
    expect("attribution" in event).toBe(false);
    expect("custom_fields" in event).toBe(false);
  });

  it("uses File.name when the form value is a File", () => {
    const fd = new FormData();
    const file = new File(["contents"], "résumé.pdf", { type: "application/pdf" });
    fd.set("upload", file);

    const event = leadEvent.fromFormData(fd, {
      source: { source_system: "test" },
      fields: {
        "custom_fields.attachment": "upload",
      },
    });

    expect(event.custom_fields).toEqual({ attachment: "résumé.pdf" });
  });

  it("merges consent defaults from config with consent.* form fields", () => {
    const fd = new FormData();
    fd.set("emailOptIn", "true");

    const event = leadEvent.fromFormData(fd, {
      source: { source_system: "test" },
      consent: { sms_consent: true },
      fields: {
        "consent.email_consent": "emailOptIn",
      },
    });

    expect(event.consent).toEqual({
      sms_consent: true,
      email_consent: "true",
    });
  });

  it("passes the resulting input through leadEvent() (so schema_version etc. land)", () => {
    const fd = new FormData();
    fd.set("name", "Alice");

    const event = leadEvent.fromFormData(fd, {
      source: { source_system: "test" },
      fields: { "lead.full_name": "name" },
    });

    expect(event.schema_version).toBe("lead_event.v1");
    expect(event.event_type).toBe("lead.submitted");
    expect(event.submitted_at).toBeDefined();
  });
});
