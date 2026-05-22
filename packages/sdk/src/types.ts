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

/**
 * Where the event came from — the integration / form / system that
 * captured the lead. `source_system` is required; everything else
 * is metadata used by LeadRails for routing and audit attribution.
 */
export interface SourceV1 {
  /**
   * Identifier for the system that generated this event (e.g.
   * `"wordpress-gravityforms"`, `"my-app-feedback"`). Must be a
   * non-empty string ≤200 characters; the empty string is rejected
   * server-side with HTTP 422 `schema_validation_failed`.
   */
  source_system: string;
  /** Optional upstream event ID — useful for cross-system tracing and dedup. */
  source_event_id?: string;
  /** URL of the page the lead submitted from. */
  site_url?: string;
  /** Form identifier within the source system. */
  form_id?: string;
  /** Human-readable form name. */
  form_name?: string;
}

/**
 * The actual person behind the lead. All fields are optional and
 * nullable on the wire — different sources capture different
 * subsets (e.g. a name-only feedback form vs. a full intake form).
 * LeadRails handles enrichment and de-duplication downstream.
 */
export interface LeadV1 {
  /** Full name as a single string. Prefer this when the source doesn't split given/family names. */
  full_name?: string | null;
  /** Given/first name. */
  first_name?: string | null;
  /** Family/last name. */
  last_name?: string | null;
  /** Email address. */
  email?: string | null;
  /** Phone number in any format — LeadRails normalizes server-side. */
  phone?: string | null;
  /** Free-form message / inquiry text from the lead. */
  message?: string | null;
  /** Domain-specific category (e.g. `"plumbing"`, `"sales-demo"`). */
  service_type?: string | null;
  /** Free-form urgency indicator (e.g. `"emergency"`, `"this-week"`). */
  urgency?: string | null;
  /** Preferred channel back to the lead (e.g. `"phone"`, `"email"`, `"sms"`). */
  preferred_contact_method?: string | null;
}

/**
 * Physical location of the lead. All fields are optional and
 * nullable; LeadRails geocodes / normalizes server-side when
 * routing rules need it.
 */
export interface LocationV1 {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

/**
 * Marketing attribution — where the lead came from before they
 * reached the form. Standard UTM parameters plus click-IDs from the
 * major ad platforms. LeadRails uses these for ROI reporting.
 */
export interface AttributionV1 {
  /** URL of the landing page the lead first visited in this session. */
  landing_page?: string | null;
  /** HTTP `Referer` header. */
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  /** Google Ads click ID. */
  gclid?: string | null;
  /** Google Ads enhanced conversions identifier (mobile app). */
  gbraid?: string | null;
  /** Google Ads enhanced conversions identifier (web). */
  wbraid?: string | null;
  /** Microsoft Advertising click ID. */
  msclkid?: string | null;
  /** Meta (Facebook/Instagram) click ID. */
  fbclid?: string | null;
}

/**
 * Lead-provided consent flags. Important for TCPA / GDPR / CCPA
 * compliance — LeadRails records these alongside the lead and can
 * route based on consent status.
 */
export interface ConsentV1 {
  /** Did the lead explicitly consent to SMS messaging? */
  sms_consent?: boolean;
  /** Did the lead explicitly consent to marketing email? */
  email_consent?: boolean;
  /** URL of the privacy policy the lead accepted, if any. */
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
