// Vendored public-API schemas for @leadrails/mcp.
//
// These mirror the Zod schemas from `@leadrails/schema/public` in the
// LeadRails monorepo. Vendored here so this package is self-contained
// (no workspace dep on @leadrails/schema) — bumping a schema in the
// monorepo requires re-copying the file here and cutting a new release.
// Wire-stable types only; intake/delivery internals are not vendored.
export * from "./me.js";
export * from "./destinations.js";
export * from "./events.js";
export * from "./pagination.js";
export * from "./routes.js";
export * from "./sources.js";
