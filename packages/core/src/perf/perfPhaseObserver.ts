/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrow core re-export of the telemetry-owned perf phase observer seam
 * (P07, issue #3167).
 *
 * Layering: telemetry owns the seam; core re-exports it so that packages
 * (notably providers) which already depend on core — but do NOT declare a
 * dependency on telemetry — can consume it without creating an undeclared
 * dependency edge or a cycle. The CLI registry installs an implementation
 * when perf is enabled; when absent (default-off), the getter returns null.
 *
 * No behaviour lives here — this is a pure re-export boundary.
 */

export {
  setPerfPhaseObserver,
  getPerfPhaseObserver,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';
export type {
  PerfPhaseObserver,
  PerfProviderAttemptStartInfo,
  PerfProviderAttemptEndInfo,
  PerfToolCallCompletedInfo,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';
