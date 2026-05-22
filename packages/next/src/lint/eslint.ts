// ESLint flat-config preset for @leadrails/next consumers.
//
// Usage in your eslint.config.js:
//
//   import leadrailsNext from "@leadrails/next/lint/eslint";
//
//   export default [
//     ...leadrailsNext,
//     // your other configs
//   ];
//
// Same rule shape as the oxlint preset — bans @leadrails/sdk
// imports outside server-side file conventions. Acts as an
// editor-level guardrail before the build-time `server-only`
// marker and the package.json `browser` exports stub.

// Structural shape of an ESLint flat-config entry. Kept inline so
// consumers don't need @types/eslint installed for our types to
// resolve.
export type ESLintRuleSeverity = "error" | "warn" | "off" | 0 | 1 | 2;
export type ESLintRuleEntry =
  | ESLintRuleSeverity
  | [ESLintRuleSeverity, ...unknown[]];

export interface ESLintFlatConfigEntry {
  name?: string;
  files?: string[];
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
