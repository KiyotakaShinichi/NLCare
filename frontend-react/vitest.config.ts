/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    css: false,
    // jsdom is slow on Windows and v8 coverage instrumentation roughly doubles
    // it, which pushed a few component tests past the 5s default and made the
    // suite flaky under `test:coverage` while passing under `test`. The tests
    // themselves are deterministic; only the wall-clock budget was wrong.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text-summary", "json-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      // Excluded from the denominator on purpose:
      //   - generated-openapi.d.ts and types/*     : declarations, no runtime code
      //   - main.tsx                               : DOM bootstrap, covered by e2e
      //   - assets                                 : non-code
      exclude: [
        "src/types/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/assets/**",
      ],
      /**
       * Regression gate, not a target.
       *
       * Re-measured on 2026-09-16 on vitest 4's metric basis. The numbers below
       * are NOT a relaxation of the previous gate: they are the same gate
       * expressed in a different unit.
       *
       * vitest 3.2.7 -> 4.1.11 was forced by GHSA-82fw-gwwq-j7x9 (path
       * traversal via @vitest/mocker, fixed in 4.1.11, no 3.x backport). v4
       * makes AST-aware remapping the default for the v8 provider and offers no
       * opt-out, so the same 320 tests over the same source are now counted
       * against different denominators:
       *
       *   statements  14459 -> 3752      branches  2014 -> 4688
       *   functions     596 -> 1191      (lines similar)
       *
       * Measured before (vitest 3): 49.79% statements, 67.54% branches,
       * 43.95% functions, 49.79% lines.
       * Measured after  (vitest 4): 50.61% statements, 36.47% branches,
       * 37.95% functions, 52.55% lines.
       *
       * Statements and lines went *up*; branches and functions fell only
       * because v4 counts far more of them (optional chaining, default
       * parameters, and short-circuits each became branches). No test was
       * deleted, weakened, or excluded - the suite is byte-identical across the
       * upgrade and still passes 320/320.
       *
       * Each threshold keeps the previous convention: roughly four points below
       * its measured value, so ordinary churn and v8's run-to-run variance
       * cannot redden CI while a real drop still fails the build.
       *
       * Raise these when coverage genuinely improves. Do not lower one to make
       * a failing build pass; that converts the gate into decoration. Lowering
       * is legitimate only when the metric itself is redefined under you, as
       * here, and only with the measurement recorded alongside it.
       */
      thresholds: {
        statements: 46,
        branches: 32,
        functions: 33,
        lines: 48,
      },
    },
  },
});
