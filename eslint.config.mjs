import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // scripts/ are standalone CommonJS ops/debug scripts run directly via
    // `node scripts/foo.js` (see their #!/usr/bin/env node shebangs) -- not
    // part of the Next.js app bundle, so the TS-project-oriented
    // no-require-imports rule doesn't apply to them.
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // The codebase already signals "intentionally unused" with a leading
    // underscore (e.g. a mock parameter kept only to match a real function's
    // signature). Recognize that convention instead of flagging it.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
    },
  },
]);

export default eslintConfig;
