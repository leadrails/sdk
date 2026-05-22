// This file is served when a browser bundler resolves @leadrails/sdk
// via the `browser` condition in package.json `exports`. Importing
// this module throws immediately — the SDK must never run in a
// browser context because the HMAC signing secret would leak.
throw new Error(
  "@leadrails/sdk cannot be imported in browser bundles. " +
    "Use @leadrails/next's createLeadEventRoute / createLeadEventAction, " +
    "or call the SDK from a Route Handler / Server Action / API route.",
);
