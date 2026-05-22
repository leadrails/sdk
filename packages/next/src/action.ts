import "server-only";
import { createClient, leadEvent, type ClientOptions, type LeadEventV1Input } from "@leadrails/sdk";
import { isApiError } from "./utils";

export interface CreateLeadEventActionOptions extends Partial<ClientOptions> {
  /**
   * Convert a FormData submission into a LeadEventV1Input. Called
   * with the FormData the Server Action receives.
   */
  mapFormData: (formData: FormData) => LeadEventV1Input | Promise<LeadEventV1Input>;
}

export interface LeadEventActionResult {
  ok: boolean;
  event_id?: string;
  error?: string;
  status?: number;
}

/**
 * Build a Next.js Server Action that signs and sends a LeadRails
 * event derived from the submitted FormData.
 *
 * @example
 * // app/actions.ts
 * "use server";
 * import { createLeadEventAction } from "@leadrails/next";
 *
 * export const submitLead = createLeadEventAction({
 *   mapFormData: (fd) => ({
 *     source: { source_system: "my-app" },
 *     lead: {
 *       full_name: String(fd.get("name") ?? ""),
 *       email:     String(fd.get("email") ?? ""),
 *       message:   String(fd.get("message") ?? ""),
 *     },
 *   }),
 * });
 *
 * // In a Server Component:
 * <form action={submitLead}>...</form>
 */
export function createLeadEventAction(
  options: CreateLeadEventActionOptions,
): (formData: FormData) => Promise<LeadEventActionResult> {
  const client = createClient(options);

  return async function submitLead(formData: FormData): Promise<LeadEventActionResult> {
    try {
      const input = await options.mapFormData(formData);
      const event = leadEvent(input);
      const result = await client.send(event);
      return { ok: true, event_id: result.event_id };
    } catch (err) {
      if (isApiError(err)) {
        return { ok: false, error: err.errorCode, status: err.status };
      }
      return { ok: false, error: "internal_error", status: 500 };
    }
  };
}
