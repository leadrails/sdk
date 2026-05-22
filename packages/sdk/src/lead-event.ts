import type { LeadEventV1, LeadEventV1Input } from "./types";

/**
 * Build a LeadEventV1 from typed input. Pre-fills the constant
 * `schema_version` / `event_type` literals and defaults
 * `submitted_at` to `new Date().toISOString()` if not provided.
 *
 * This is a typed factory — it does NOT validate the payload at
 * runtime. Validation happens server-side at the intake endpoint;
 * any schema problem comes back as a `LeadRailsApiError` with
 * `errorCode === "schema_validation_failed"`.
 *
 * @example
 * const event = leadEvent({
 *   source: { source_system: "world-flags-feedback" },
 *   lead:   { full_name: name, email },
 * });
 * await sendLeadEvent(event);
 */
export function leadEvent(input: LeadEventV1Input): LeadEventV1 {
  return {
    schema_version: "lead_event.v1",
    event_type: "lead.submitted",
    submitted_at: input.submitted_at ?? new Date().toISOString(),
    source: input.source,
    lead: input.lead,
    ...(input.workflow !== undefined ? { workflow: input.workflow } : {}),
    ...(input.workflow_name !== undefined ? { workflow_name: input.workflow_name } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.attribution !== undefined ? { attribution: input.attribution } : {}),
    ...(input.consent !== undefined ? { consent: input.consent } : {}),
    ...(input.custom_fields !== undefined ? { custom_fields: input.custom_fields } : {}),
  };
}

/**
 * Type for `leadEvent.fromFormData()`'s `fields` mapping. Each key
 * is a dotted path into the LeadEventV1 input shape; each value is
 * the FormData field name that holds that value.
 */
export type FormDataFieldMap = {
  [K in `lead.${keyof NonNullable<LeadEventV1Input["lead"]>}`]?: string;
} & {
  [K in `location.${keyof NonNullable<LeadEventV1Input["location"]>}`]?: string;
} & {
  [K in `attribution.${keyof NonNullable<LeadEventV1Input["attribution"]>}`]?: string;
} & {
  [K in `consent.${keyof NonNullable<LeadEventV1Input["consent"]>}`]?: string;
} & {
  // Free-form passthrough for custom_fields.* paths.
  [K in `custom_fields.${string}`]?: string;
};

/**
 * Build a LeadEventV1 from a Web `FormData` instance. Typed mapping
 * lets you point each schema field at the matching form input name.
 *
 * @example
 * const event = leadEvent.fromFormData(formData, {
 *   source: { source_system: "my-app" },
 *   fields: {
 *     "lead.full_name":          "name",
 *     "lead.email":              "emailAddr",
 *     "lead.message":            "feedback",
 *     "attribution.utm_source":  "utm_source",
 *   },
 * });
 */
leadEvent.fromFormData = function fromFormData(
  formData: FormData,
  config: {
    source: LeadEventV1["source"];
    fields: FormDataFieldMap;
    submitted_at?: string;
    workflow?: string;
    consent?: LeadEventV1["consent"];
  },
): LeadEventV1 {
  const lead: Record<string, unknown> = {};
  const location: Record<string, unknown> = {};
  const attribution: Record<string, unknown> = {};
  const consent: Record<string, unknown> = { ...(config.consent ?? {}) };
  const custom_fields: Record<string, unknown> = {};

  for (const [path, formField] of Object.entries(config.fields)) {
    if (typeof formField !== "string") continue;
    const raw = formData.get(formField);
    if (raw === null) continue;
    const value = typeof raw === "string" ? raw : raw.name; // File → its name
    const [group, ...rest] = path.split(".");
    const key = rest.join(".");
    if (group === "lead") lead[key] = value;
    else if (group === "location") location[key] = value;
    else if (group === "attribution") attribution[key] = value;
    else if (group === "consent") consent[key] = value;
    else if (group === "custom_fields") custom_fields[key] = value;
  }

  const input = {
    source: config.source,
    lead: lead as NonNullable<LeadEventV1Input["lead"]>,
    ...(Object.keys(location).length > 0 ? { location: location as NonNullable<LeadEventV1Input["location"]> } : {}),
    ...(Object.keys(attribution).length > 0 ? { attribution: attribution as NonNullable<LeadEventV1Input["attribution"]> } : {}),
    ...(Object.keys(consent).length > 0 ? { consent: consent as NonNullable<LeadEventV1Input["consent"]> } : {}),
    ...(Object.keys(custom_fields).length > 0 ? { custom_fields } : {}),
    ...(config.workflow !== undefined ? { workflow: config.workflow } : {}),
    ...(config.submitted_at !== undefined ? { submitted_at: config.submitted_at } : {}),
  } satisfies LeadEventV1Input;

  return leadEvent(input);
};
