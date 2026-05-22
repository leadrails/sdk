import "server-only";
import { createClient, leadEvent, type ClientOptions, type LeadEventV1Input } from "@leadrails/sdk";

export interface CreateLeadEventRouteOptions extends Partial<ClientOptions> {
  /**
   * Override the default request → LeadEventV1Input mapping. By
   * default, the route assumes the request body IS a
   * `LeadEventV1Input` (matching `leadEvent()`'s input shape).
   * Override this to accept your form's specific JSON shape and
   * transform it.
   */
  mapRequest?: (body: unknown, req: Request) => LeadEventV1Input | Promise<LeadEventV1Input>;
  /**
   * Override the success response shape. Default returns
   * `Response.json({ ok: true, event_id, status })` with 202.
   * Distinct from the inherited `onRequest` observability hook.
   */
  formatSuccessResponse?: (
    result: Awaited<ReturnType<ReturnType<typeof createClient>["send"]>>,
    req: Request,
  ) => Response | Promise<Response>;
  /**
   * Override the error response shape. Default catches
   * LeadRailsApiError and returns the upstream status; everything
   * else returns 500 with a generic message (no internal detail
   * leaked). Distinct from the inherited `onError` observability
   * hook (which still fires for telemetry purposes).
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

function isApiError(err: unknown): err is { status: number; errorCode: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { status?: unknown }).status === "number" &&
    typeof (err as { errorCode?: unknown }).errorCode === "string"
  );
}
