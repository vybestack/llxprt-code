/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P10
 * @plan PLAN-20260211-HIGHDENSITY.P17
 * @requirement REQ-CS-001.2, REQ-CS-001.3, REQ-HD-004.2
 * @pseudocode settings-factory.md lines 140-157
 *
 * Factory functions for resolving compression strategies by name.
 */

import type { CompressionStrategy, CompressionStrategyName } from './types.js';
import { COMPRESSION_STRATEGIES, UnknownStrategyError } from './types.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import { TopDownTruncationStrategy } from './TopDownTruncationStrategy.js';
import { OneShotStrategy } from './OneShotStrategy.js';
import { HighDensityStrategy } from './HighDensityStrategy.js';

/**
 * Validates a raw string against the known strategy names.
 * Returns the typed name on success; throws {@link UnknownStrategyError} otherwise.
 */
export function parseCompressionStrategyName(
  name: string,
): CompressionStrategyName {
  if ((COMPRESSION_STRATEGIES as readonly string[]).includes(name)) {
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
    case 'one-shot':
      return new OneShotStrategy();
    case 'high-density':
      return new HighDensityStrategy();
    default: {
      const exhaustive: never = name;
      throw new UnknownStrategyError(exhaustive as string);
    }
  }
}
