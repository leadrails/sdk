/**
 * @module
 *
 * ESLint flat-config preset for `@leadrails/next` consumers. The
 * default export is an `ESLintFlatConfigEntry[]` that bans
 * `@leadrails/sdk` imports outside conventional server-side file
 * locations (Route Handlers, Server Actions, `*.route.{ts,tsx}`,
 * `actions/**`).
 *
 * Editor-level guardrail that fires before the build-time
 * `server-only` marker and the `browser` exports stub catch the
 * same problem.
 *
 * @example
 * ```ts
 * // eslint.config.js
 * import leadrailsNext from "@leadrails/next/lint/eslint";
 *
 * export default [
 *   ...leadrailsNext,
 *   // ...your other configs
 * ];
 * ```
 */

/**
 * Severity level for an ESLint rule. ESLint accepts both string and
 * numeric forms, so we type both.
 */
export type ESLintRuleSeverity = "error" | "warn" | "off" | 0 | 1 | 2;

/**
 * An ESLint rule entry. Either a bare severity (`"error"`) or a
 * tuple of `[severity, ...options]` where the options are
 * rule-specific.
 */
export type ESLintRuleEntry =
  | ESLintRuleSeverity
  | [ESLintRuleSeverity, ...unknown[]];

/**
 * Structural shape of one entry in an ESLint flat-config array.
 * Kept inline so consumers don't need `@types/eslint` installed for
 * our types to resolve. The default export of
 * `@leadrails/next/lint/eslint` is `ESLintFlatConfigEntry[]` — spread
 * it into your `eslint.config.js`.
 */
export interface ESLintFlatConfigEntry {
  /** Optional human-readable name for the config entry. */
  name?: string;
  /** Glob patterns this entry applies to. Defaults to everything if omitted. */
  files?: string[];
  /** Rule severity / options keyed by rule name. */
  rules?: Record<string, ESLintRuleEntry>;
}

const preset: ESLintFlatConfigEntry[] = [
  {
    name: "@leadrails/next/lint/server-only-sdk",
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@leadrails/sdk",
              message:
                "@leadrails/sdk is server-only. Import it from a Route Handler (app/api/**/route.ts), a *.route.{ts,tsx} file, or a Server Action (actions.{ts,tsx} / actions/** / *.action.{ts,tsx}). For client-side form submission, POST to your own Route Handler that imports the SDK.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "@leadrails/next/lint/server-only-sdk:overrides",
    files: [
      "app/api/**/route.{ts,tsx}",
      "pages/api/**/*.{ts,tsx}",
      "**/*.route.{ts,tsx}",
      "**/actions.{ts,tsx}",
      "**/*.action.{ts,tsx}",
      "**/actions/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default preset;
