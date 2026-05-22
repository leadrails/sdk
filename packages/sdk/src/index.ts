// Server-only guards — see package.json `exports` map's
// `browser` condition for the build-time defense.
import "server-only";

if (typeof window !== "undefined") {
  throw new Error(
    "@leadrails/sdk loaded in a browser environment. " +
      "This package is server-only — call it from a Route Handler, " +
      "Server Action, or any server-side context. The HMAC signing " +
      "secret must never reach a browser bundle.",
  );
}

export { leadEvent } from "./lead-event";
export type { FormDataFieldMap } from "./lead-event";
export { sendLeadEvent } from "./send";
export type { SendLeadEventConfig, SendLeadEventResult } from "./send";
export { createClient } from "./client";
export type { ClientOptions, LeadRailsClient } from "./client";
export {
  LeadRailsError,
  LeadRailsApiError,
  LeadRailsAuthError,
  LeadRailsConfigError,
} from "./errors";
export type {
  LeadEventV1,
  LeadEventV1Input,
  LeadV1,
  SourceV1,
  LocationV1,
  AttributionV1,
  ConsentV1,
} from "./types";
