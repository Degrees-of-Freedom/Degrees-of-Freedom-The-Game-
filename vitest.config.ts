import { defineConfig } from "vitest/config";

// Explicit roots keep other contributors' local worktrees out of this build's results.
export default defineConfig({ test: { include: ["apps/*/src/**/*.test.ts", "apps/*/src/**/*.test.tsx", "packages/*/src/**/*.test.ts"] } });
