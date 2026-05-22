import { LeadRailsApiError } from "@leadrails/sdk";

/**
 * Type-narrow an unknown caught value to LeadRailsApiError. Uses
 * `instanceof` (correct via @leadrails/sdk's exported class) so it
 * won't false-positive on arbitrary objects that happen to carry
 * `status` + `errorCode` props.
 */
export function isApiError(err: unknown): err is LeadRailsApiError {
  return err instanceof LeadRailsApiError;
}
