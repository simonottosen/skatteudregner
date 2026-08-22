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
    // Harness git worktree copies — stale duplicates that pollute lint.
    ".claude/**",
    // Generated MCPB bundle output (esbuild), not hand-written source.
    "mcpb/server/**",
    "dist/**",
  ]),
]);

export default eslintConfig;
