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
    // Advisory rules must NEVER hardcode dollar limits, rates, or thresholds —
    // everything comes from tax_constants / kb_parameters. Only structural
    // factors (0/±1, 0.5 halves, ×100 percent display, age boundaries used
    // for comparisons that mirror constants) are permitted.
    files: ["lib/advisory/rules/**/*.ts"],
    rules: {
      "no-magic-numbers": ["error", {
        ignore: [0, 1, -1, 0.5, 100],
        ignoreDefaultValues: true,
        ignoreArrayIndexes: true,
      }],
    },
  },
]);

export default eslintConfig;
