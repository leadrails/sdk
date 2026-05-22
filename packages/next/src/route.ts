import "server-only";
import {
  createClient,
  leadEvent,
  type ClientOptions,
  type LeadEventV1Input,
  type SendLeadEventResult,
} from "@leadrails/sdk";
import { isApiError } from "./utils.js";

export interface CreateLeadEventRouteOptions extends Partial<ClientOptions> {
  /**
   * Override the default request → LeadEventV1Input mapping. By
   * default, the route casts the parsed JSON body to
   * `LeadEventV1Input` with no client-side validation; any shape
   * problem surfaces as an upstream `LeadRailsApiError` with
   * `errorCode === "schema_validation_failed"`. Override to perform
   * your own validation or to transform a domain-specific request
   * shape into a LeadRails event.
   */
  mapRequest?: (body: unknown, req: Request) => LeadEventV1Input | Promise<LeadEventV1Input>;
  /**
   * Override the success response shape. Default returns
   * `Response.json({ ok: true, event_id, status })` with HTTP 202.
   * Distinct from the inherited `onRequest` observability hook.
   */
  formatSuccessResponse?: (
    result: SendLeadEventResult,
    req: Request,
  ) => Response | Promise<Response>;
  /**
   * Override the error response shape. Default returns the upstream
   * HTTP status when the error is a `LeadRailsApiError`, or 500 for
   * any other error — and never leaks internal detail. Distinct from
   * the inherited `onError` observability hook (which still fires).
   */
  formatErrorResponse?: (err: unknown, req: Request) => Response | Promise<Response>;
}

/**
 * Build a Next.js Route Handler (`POST`) that signs and sends the
 * request body as a LeadRails event.
 *
 * @example
 * // app/api/lead/route.ts
 * import { createLeadEventRoute } from "@leadrails/next";
 *
 * export const POST = createLeadEventRoute({
 *   mapRequest: (body) => ({
 *     source: { source_system: "world-flags-feedback" },
 *     lead: { full_name: body.name, email: body.email, message: body.feedback },
 *   }),
 * });
 */
export function createLeadEventRoute(
  options: CreateLeadEventRouteOptions = {},
): (req: Request) => Promise<Response> {
  const client = createClient(options);

  return async function POST(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as unknown;
      const input = options.mapRequest
        ? await options.mapRequest(body, req)
        : (body as LeadEventV1Input);
      const event = leadEvent(input);
      const result = await client.send(event);

      if (options.formatSuccessResponse) {
        return await options.formatSuccessResponse(result, req);
      }
      return Response.json(
        {
          ok: true,
          event_id: result.event_id,
          status: result.status,
        },
        { status: 202 },
      );
    } catch (err) {
      if (options.formatErrorResponse) {
        return await options.formatErrorResponse(err, req);
      }
      // Default error response — no internal detail leaked, but
      // preserve the upstream HTTP status when it's a LeadRailsApiError.
      const status = isApiError(err) ? err.status : 500;
      const errorCode = isApiError(err) ? err.errorCode : "internal_error";
      return Response.json({ ok: false, error: errorCode }, { status });
    }
  };
}
