/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Public acquisition API for packages/tools.
 *
 * Shared byte-budget collection primitives used by shell execution and other
 * push-stream tool acquisition paths. These primitives are intentionally free
 * of settings, process, terminal, encoding-detection, ANSI, xterm, and MCP
 * concerns — callers receive plain validated {@link ByteBudget} values.
 */

export type {
  ByteBudget,
  StreamSource,
  TruncationMetadata,
  AcquisitionResult,
  CombinedAcquisitionResult,
} from './types.js';

export {
  ACQUISITION_MIN_BYTES,
  ACQUISITION_HARD_MAX_BYTES,
  DEFAULT_ACQUISITION_BUDGET_BYTES,
  DEFAULT_HEAD_FRACTION,
  createByteBudget,
  createDefaultByteBudget,
  resolveByteBudgetFromSetting,
} from './byteBudget.js';

export {
  BoundedStreamCollector,
  DEFAULT_OMISSION_NOTICE,
} from './boundedStreamCollector.js';

export { BoundedCombinedCollector } from './boundedCombinedCollector.js';

export {
  completeUtf8PrefixLength,
  completeUtf8SuffixStart,
  trimIncompleteTrailingUtf8,
  skipIncompleteLeadingUtf8,
} from './utf8Boundaries.js';
