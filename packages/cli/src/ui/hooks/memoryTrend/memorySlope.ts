/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read-time memory slope derivation (P10, AC-10) — thin re-export layer.
 *
 * The canonical generic memory slope algorithm and its types are OWNED by the
 * telemetry package (`perfSlopeBridge.ts`), below the CLI layer, so the
 * longitudinal report and this live view share one implementation rather than
 * maintaining parallel copies. This module preserves the historical CLI import
 * path (`memoryTrend/memorySlope.js`) for P10 callers while delegating every
 * computation to telemetry.
 *
 * Slopes are DERIVED at read time, never persisted.
 */

export {
  derivePerOperationMemorySlope,
  derivePerMinuteMemorySlope,
} from '@vybestack/llxprt-code-telemetry/perf/perfSlopeBridge.js';
export type {
  PerOperationMemorySlope,
  PerMinuteMemorySlope,
} from '@vybestack/llxprt-code-telemetry/perf/perfSlopeBridge.js';
