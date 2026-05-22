import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The real `server-only` package throws at import time. The SDK
      // entry points import it as a build-time guard against client-
      // component bundling; in Node-based tests that throw is noise.
      // Alias to an empty module so the import is a no-op under test.
      "server-only": path.resolve(here, "test/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
  },
});
