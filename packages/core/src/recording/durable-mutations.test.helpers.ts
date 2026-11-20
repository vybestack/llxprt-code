/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../services/history/IContent.js';
import type {
  DensityResult,
  DensityResultMetadata,
} from '../core/compression/types.js';

export function makeDensityMetadata(): DensityResultMetadata {
  return {
    readWritePairsPruned: 0,
    fileDeduplicationsPruned: 0,
    recencyPruned: 0,
  };
}

export function makeDensityResult(
  removals: readonly number[],
  replacements: ReadonlyMap<number, IContent> = new Map(),
): DensityResult {
  return { removals, replacements, metadata: makeDensityMetadata() };
}
