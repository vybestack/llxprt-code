/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  CompressionContext,
  CompressionStrategy,
  StrategyCompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';

/**
 * A strategy test double that decides its outcome from an in-memory history.
 * Production strategies only run on the disk route; fixtures adapt these
 * doubles onto the disk route so tests can script outcomes as plain arrays.
 */
export interface ArrayStrategyDouble extends CompressionStrategy {
  compress(context: CompressionContext): Promise<StrategyCompressionResult>;
}

export function isArrayStrategyDouble(
  strategy: CompressionStrategy,
): strategy is ArrayStrategyDouble {
  return 'compress' in strategy && typeof strategy.compress === 'function';
}
