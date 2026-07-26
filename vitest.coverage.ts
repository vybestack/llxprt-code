/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for whether Vitest coverage instrumentation is enabled.
 *
 * Before #2708, every package's `vitest.config.ts` hardcoded
 * `coverage.enabled: true`, so CI computed coverage on every test matrix leg
 * even though only the Ubuntu artifact is consumed by `post_coverage_comment`.
 * All 11 package coverage settings now read this flag instead.
 *
 * Defaults to ENABLED when the env var is unset so local runs keep the coverage
 * signal; set `LLXPRT_COVERAGE=false` to disable (e.g. on non-designated CI legs).
 */
export const isCoverageEnabled: boolean =
  process.env['LLXPRT_COVERAGE'] !== 'false';
