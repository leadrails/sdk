// Empty shim for the `server-only` package. The real package throws
// at import time when bundled into a client component — useful in
// production, but it breaks Node-based test runners. vitest.config.ts
// aliases `server-only` to this file.
export {};
