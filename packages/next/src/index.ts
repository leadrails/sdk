// The Next.js adapter for @leadrails/sdk. Each export is server-
// only — the @leadrails/sdk it wraps imports the `server-only`
// marker module which Next.js fails-fast on at build time if any
// client component transitively pulls it in.

export { createLeadEventRoute } from "./route.js";
export type { CreateLeadEventRouteOptions } from "./route.js";
export { createLeadEventAction } from "./action.js";
export type { CreateLeadEventActionOptions, LeadEventActionResult } from "./action.js";
