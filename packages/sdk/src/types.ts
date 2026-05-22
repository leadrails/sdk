// Wire-contract types for LeadRails LeadEventV1.
//
// These mirror @leadrails/schema's exports. We inline them in v0.1.0
// of @leadrails/sdk so the SDK can ship without waiting on the
// schema-package publish flow. When @leadrails/schema@0.1.0 lands
// on JSR/npm, this file can be replaced with a thin re-export:
//
//   export * from "@leadrails/schema";
//
// The shape MUST stay byte-identical to @leadrails/schema's
// LeadEventV1 type so the swap is non-breaking for consumers.

/**
 * A LeadEventV1 — the payload shape that `intake.leadrails.dev`
 * accepts. Construct one via `leadEvent({ ... })` from this package
 * to get the constants pre-filled and a typed-input shape.
 */
export interface LeadEventV1 {
  schema_version: "lead_event.v1";
  event_type: "lead.submitted";
  workflow?: string;
  /** Legacy alias for `workflow` (accepted on the wire; prefer `workflow`). */
  workflow_name?: string;
  source: SourceV1;
  lead: LeadV1;
  location?: LocationV1;
  attribution?: AttributionV1;
  consent?: ConsentV1;
  /**
   * Free-form bag for fields not covered by the named groups.
   * Keys must be ≤200 characters server-side; values can be any
   * JSON-serializable type. Longer keys are rejected with HTTP 422
   * `schema_validation_failed`.
   */
  custom_fields?: Record<string, unknown>;
  submitted_at: string;
}

export interface SourceV1 {
  /**
   * Identifier for the system that generated this event (e.g.
   * `"wordpress-gravityforms"`, `"my-app-feedback"`). Must be a
   * non-empty string ≤200 characters; the empty string is rejected
   * server-side with HTTP 422 `schema_validation_failed`.
   */
  source_system: string;
  source_event_id?: string;
  site_url?: string;
  form_id?: string;
  form_name?: string;
}

export interface LeadV1 {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  service_type?: string | null;
  urgency?: string | null;
  preferred_contact_method?: string | null;
}

export interface LocationV1 {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export interface AttributionV1 {
  landing_page?: string | null;
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  msclkid?: string | null;
  fbclid?: string | null;
}

export interface ConsentV1 {
  sms_consent?: boolean;
  email_consent?: boolean;
  privacy_policy_url?: string | null;
}

/**
 * What you pass to `leadEvent({ ... })`. The `schema_version`,
 * `event_type`, and `submitted_at` fields are filled in for you —
 * everything else mirrors LeadEventV1.
 */
export type LeadEventV1Input = Omit<LeadEventV1, "schema_version" | "event_type" | "submitted_at"> & {
  /** Optional; defaults to `new Date().toISOString()` at send time. */
  submitted_at?: string;
};
