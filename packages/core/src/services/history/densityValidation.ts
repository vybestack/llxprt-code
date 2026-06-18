/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { DensityResult } from '../../core/compression/types.js';
import { CompressionStrategyError } from '../../core/compression/types.js';
import type { IContent } from './IContent.js';

/**
 * Validate a DensityResult against the current history bounds.
 * Throws CompressionStrategyError on any validation failure.
 */
export function validateDensityResult(
  result: DensityResult,
  historyLength: number,
): void {
  // V1: Check for duplicates in removals
  const removalSet = new Set(result.removals);
  if (removalSet.size !== result.removals.length) {
    throw new CompressionStrategyError(
      'DensityResult contains duplicate removal indices',
      'DENSITY_INVALID_RESULT',
    );
  }

  // V2: Check no index appears in both removals and replacements
  validateNoConflicts(result.replacements, removalSet);

  // V3: Validate removal indices are within bounds
  validateRemovalBounds(result.removals, historyLength);

  // V4: Validate replacement indices are within bounds
  validateReplacementBounds(result.replacements, historyLength);
}

/** Check no replacement index overlaps with a removal index. */
function validateNoConflicts(
  replacements: ReadonlyMap<number, IContent>,
  removalSet: ReadonlySet<number>,
): void {
  for (const index of replacements.keys()) {
    if (removalSet.has(index)) {
      throw new CompressionStrategyError(
        `DensityResult conflict: index ${index} in both removals and replacements`,
        'DENSITY_CONFLICT',
      );
    }
  }
}

/** Validate removal indices are within bounds. */
function validateRemovalBounds(
  removals: readonly number[],
  historyLength: number,
): void {
  for (const index of removals) {
    if (index < 0 || index >= historyLength) {
      throw new CompressionStrategyError(
        `DensityResult removal index ${index} out of bounds [0, ${historyLength})`,
        'DENSITY_INDEX_OUT_OF_BOUNDS',
      );
    }
  }
}

/** Validate replacement indices are within bounds. */
function validateReplacementBounds(
  replacements: ReadonlyMap<number, IContent>,
  historyLength: number,
): void {
  for (const index of replacements.keys()) {
    if (index < 0 || index >= historyLength) {
      throw new CompressionStrategyError(
        `DensityResult replacement index ${index} out of bounds [0, ${historyLength})`,
        'DENSITY_INDEX_OUT_OF_BOUNDS',
      );
    }
  }
}

/**
 * Apply a validated DensityResult to a mutable history array in place.
 * Replacements are applied first, then removals in descending order.
 */
export function applyDensityMutations(
  history: IContent[],
  result: DensityResult,
): void {
  // M1: Apply replacements first — indices are stable (no length changes)
  for (const [index, replacement] of result.replacements) {
    history[index] = replacement;
  }

  // M2: Sort removals in descending order to preserve earlier indices during splice
  const sortedRemovals = [...result.removals].sort((a, b) => b - a);

  // M3: Apply removals in reverse order
  for (const index of sortedRemovals) {
    history.splice(index, 1);
  }
}
