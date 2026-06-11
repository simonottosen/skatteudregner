import { defineConfig, configDefaults } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
    // Ignore the harness's git worktree copies under .claude so stale
    // duplicates don't pollute the test run.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
})
