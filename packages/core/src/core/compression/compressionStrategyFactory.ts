/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P10
 * @requirement REQ-CS-001.2, REQ-CS-001.3
 *
 * Factory functions for resolving compression strategies by name.
 */

import type {
  CompressionStrategy,
  CompressionStrategyName,
} from './types.js';
import {
  COMPRESSION_STRATEGIES,
  UnknownStrategyError,
} from './types.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import { TopDownTruncationStrategy } from './TopDownTruncationStrategy.js';

/**
 * Validates a raw string against the known strategy names.
 * Returns the typed name on success; throws {@link UnknownStrategyError} otherwise.
 */
export function parseCompressionStrategyName(
  name: string,
): CompressionStrategyName {
  if (
    (COMPRESSION_STRATEGIES as readonly string[]).includes(name)
  ) {
    return name as CompressionStrategyName;
  }
  throw new UnknownStrategyError(name);
}

/**
 * Returns a fresh {@link CompressionStrategy} instance for the given name.
 */
export function getCompressionStrategy(
  name: CompressionStrategyName,
): CompressionStrategy {
  switch (name) {
    case 'middle-out':
      return new MiddleOutStrategy();
    case 'top-down-truncation':
      return new TopDownTruncationStrategy();
  }
}
