/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Memory trend module barrel (P10, issue #3167).
 *
 * Exports for downstream P11 (reader/consumer + `/perf` live view) and P12
 * (integration wiring). Uses existing package conventions.
 */

export { MemoryRing, MEMORY_RING_CAPACITY } from './memoryRing.js';
export type { MemoryRingSample } from './memoryRing.js';
export { MemoryTelemetryController } from './memoryTelemetry.js';
export type {
  MemoryColumns,
  OperationMemorySampler,
  MemoryTelemetryControllerOptions,
} from './memoryTelemetry.js';
export {
  derivePerOperationMemorySlope,
  derivePerMinuteMemorySlope,
} from './memorySlope.js';
export type {
  PerOperationMemorySlope,
  PerMinuteMemorySlope,
} from './memorySlope.js';
