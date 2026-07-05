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
  {
    // R&D ideation layer must NEVER reach execution/broker/sizing/strategy
    // runtime — it cannot be allowed to touch the burn-in. Import boundary.
    files: ["lib/research/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/lib/broker-adapters/*", "**/broker-adapters/*"], message: "research layer must not import broker/execution code" },
          { group: ["@/lib/broker-router", "**/broker-router"], message: "research layer must not import broker/execution code" },
          { group: ["@/lib/risk/*", "**/lib/risk/*"], message: "research layer must not import risk/sizing code" },
          { group: ["@/lib/brokers/*", "**/lib/brokers/*"], message: "research layer must not import broker routing code" },
          { group: ["@/lib/strategies/orchestrator", "**/strategies/orchestrator"], message: "research layer must not import the orchestrator" },
          { group: ["@/lib/strategies/BasePipelineStrategy", "**/BasePipelineStrategy"], message: "research layer must not import strategy runtime" },
        ],
      }],
    },
  },
]);

export default eslintConfig;
