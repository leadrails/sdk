/**
 * @module
 *
 * oxlint config preset for `@leadrails/next` consumers. The default
 * export ({@link OxlintPreset}) bans `@leadrails/sdk` imports from
 * any file that isn't a conventional server-side location (Route
 * Handlers, Server Actions, `*.route.{ts,tsx}`, `actions/**`).
 *
 * Catches accidental client-component imports of the SDK at
 * lint-time — earlier than the build-time `server-only` marker or
 * the `browser` exports stub.
 *
 * @example
 * ```ts
 * import preset from "@leadrails/next/lint/oxlint";
 * // ...merge preset.rules + preset.overrides into your .oxlintrc.json
 * ```
 */

/**
 * Severity level for an oxlint rule. Matches the `"error" | "warn" | "off"`
 * convention shared by ESLint and oxlint.
 */
export type OxlintRuleSeverity = "error" | "warn" | "off";

/**
 * An oxlint rule entry. Either a bare severity (`"error"`) or a tuple
 * of `[severity, ...options]` where the options are rule-specific.
 */
export type OxlintRuleEntry =
  | OxlintRuleSeverity
  | [OxlintRuleSeverity, ...unknown[]];

/**
 * Structural shape of an oxlint preset. oxlint doesn't ship official
 * TypeScript types, so we declare what consumers need inline. Spread
 * the default export of `@leadrails/next/lint/oxlint` into your
 * `.oxlintrc.json` to inherit the bans.
 */
export interface OxlintPreset {
  /** Top-level rules — apply everywhere unless overridden. */
  rules: Record<string, OxlintRuleEntry>;
  /** Per-glob overrides — typically used to re-enable the SDK in server-only files. */
  overrides: Array<{
    files: string[];
    rules: Record<string, OxlintRuleEntry>;
  }>;
}

const preset: OxlintPreset = {
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
  overrides: [
    {
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
  ],
};

export default preset;
