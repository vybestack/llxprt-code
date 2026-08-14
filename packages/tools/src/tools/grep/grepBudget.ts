/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_ACQUISITION_BUDGET_BYTES,
  ACQUISITION_HARD_MAX_BYTES,
} from '../../acquisition/index.js';
import type { GrepMatch } from './types.js';

/**
 * Aggregate semantic budget shared across all roots and strategies for a
 * single invocation. Tracks remaining bytes and objects (matches) that may
 * be retained in bounded semantic storage, plus a finite source-observation
 * byte budget charged against EVERY source chunk read (even when no match is
 * produced) so a huge no-match input cannot be read without bound.
 */
export interface SemanticBudget {
  remainingBytes: number;
  remainingObjects: number;
  /** Finite source-observation byte budget; charged per read chunk. */
  sourceBytes: number;
}

/** Per-match overhead added to the raw line/filePath byte cost. */
export const MATCH_OVERHEAD_BYTES = 256;

/** Hard ceiling on the number of retained matches for one invocation. */
export const HARD_RETAINED_MATCH_CAP = 100_000;

/** Hard ceiling on the per-invocation source-observation byte budget. */
export const SOURCE_BUDGET_HARD_MAX_BYTES = ACQUISITION_HARD_MAX_BYTES;

/**
 * Default finite source-observation budget. Matches the raw collection budget
 * used by the subprocess strategies so the JavaScript fallback and direct-file
 * path stay bounded to the same magnitude.
 */
export const DEFAULT_SOURCE_BUDGET_BYTES = DEFAULT_ACQUISITION_BUDGET_BYTES;

/** Normalize and hard-clamp a source-observation byte budget. */
export function normalizeSourceBudgetBytes(value: number | undefined): number {
  const base =
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : DEFAULT_SOURCE_BUDGET_BYTES;
  return Math.min(base, SOURCE_BUDGET_HARD_MAX_BYTES);
}

/** Create a fresh aggregate semantic budget at the default acquisition size. */
export function createAggregateSemanticBudget(): SemanticBudget {
  return {
    remainingBytes: DEFAULT_ACQUISITION_BUDGET_BYTES,
    remainingObjects: HARD_RETAINED_MATCH_CAP,
    sourceBytes: DEFAULT_SOURCE_BUDGET_BYTES,
  };
}

/** Per-invocation limits applied during match retention. */
export interface GrepLimits {
  readonly maxResults: number;
  readonly maxFiles: number;
  readonly maxPerFile: number;
}

/**
 * Bounded retention state shared by subprocess strategies and the JavaScript
 * fallback. Tracks observed vs. retained matches, per-file counts, and the
 * aggregate semantic budget.
 */
export interface GrepRetainState {
  matches: GrepMatch[];
  perFileCount: Map<string, number>;
  filesSeen: Set<string>;
  observedCount: number;
  usableCount: number;
  semanticBudget: SemanticBudget;
  earlyStopped: boolean;
  capReached: boolean;
  budgetExhausted: boolean;
}

export function createGrepRetainState(
  semanticBudget: SemanticBudget,
): GrepRetainState {
  return {
    matches: [],
    perFileCount: new Map(),
    filesSeen: new Set(),
    observedCount: 0,
    usableCount: 0,
    semanticBudget,
    earlyStopped: false,
    capReached: false,
    budgetExhausted: false,
  };
}

/**
 * Attempt to retain a parsed grep match in bounded semantic storage.
 *
 * Matches beyond {@link GrepLimits.maxPerFile} for a single file are counted
 * (observed) but NOT retained, preventing a dominant file from growing the
 * matches array without bound. Retained matches are also capped by the
 * aggregate semantic byte budget.
 *
 * When the usable match count reaches {@link GrepLimits.maxResults},
 * `capReached` is set but `earlyStopped` is deferred until one additional
 * usable match is observed — preserving exact-cap evidence semantics: merely
 * retaining exactly the requested count does not prove omission.
 *
 * Returns true if acquisition should stop (early stop or budget exhaustion).
 */
export function retainGrepMatch(
  state: GrepRetainState,
  match: GrepMatch,
  limits: GrepLimits,
): boolean {
  state.observedCount++;

  const newFile = !state.filesSeen.has(match.filePath);
  if (newFile && state.filesSeen.size >= limits.maxFiles) {
    state.earlyStopped = true;
    return true;
  }

  state.filesSeen.add(match.filePath);
  const fileCount = (state.perFileCount.get(match.filePath) ?? 0) + 1;
  state.perFileCount.set(match.filePath, fileCount);

  if (fileCount > limits.maxPerFile) {
    return false;
  }

  if (state.capReached) {
    state.earlyStopped = true;
    return true;
  }

  const matchBytes =
    Buffer.byteLength(match.line, 'utf8') +
    Buffer.byteLength(match.filePath, 'utf8') +
    MATCH_OVERHEAD_BYTES;
  if (
    state.semanticBudget.remainingBytes < matchBytes ||
    state.semanticBudget.remainingObjects <= 0
  ) {
    state.budgetExhausted = true;
    state.earlyStopped = true;
    return true;
  }
  state.matches.push(match);
  state.semanticBudget.remainingBytes -= matchBytes;
  state.semanticBudget.remainingObjects--;
  state.usableCount++;

  if (state.usableCount >= limits.maxResults) {
    state.capReached = true;
  }

  return state.earlyStopped;
}
