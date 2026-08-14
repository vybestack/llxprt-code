/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bounded acquisition budget contracts for structural-analysis modes.
 *
 * Reuses the validated finite-budget/truncation-accounting pattern established
 * by #3200 (acquisition/byteBudget) — but for record/file counts rather than
 * bytes, and without routing record aggregation through the head/tail stream
 * collector (per #3205 scope boundaries).
 *
 * @plan PLAN-20260810-ISSUE3205
 */

import type { PartialReason, ParseOmissionReason } from './types.js';

/** Effective finite caps applied to a single analysis traversal. */
export interface AnalysisBudget {
  /** Maximum number of files whose discovery/parse is attempted. */
  readonly fileBudget: number;
  /** Maximum number of records retained in the result aggregate. */
  readonly recordBudget: number;
}

/** Default record budget when no `tool-output-max-items` setting is present. */
export const DEFAULT_STRUCTURE_RECORD_BUDGET = 500;

/** Absolute ceiling for the record budget regardless of configuration. */
export const MAX_STRUCTURE_RECORD_BUDGET = 5000;

/** File budget is a multiple of the record budget so file discovery stays
 * finite even when the record budget is large. */
export const FILE_BUDGET_MULTIPLIER = 4;

/** Absolute ceiling for the file budget regardless of configuration. */
export const MAX_STRUCTURE_FILE_BUDGET = 5000;

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min) return min;
  return Math.min(Math.floor(value), max);
}

/**
 * Resolve the effective file/record budgets from the validated
 * `tool-output-max-items` ephemeral setting (or a sensible default).
 *
 * No new setting/schema/public tool parameter is introduced; the existing
 * validated setting is the only input. Both budgets are clamped to finite
 * ceilings so traversal is always bounded regardless of user configuration.
 */
export function resolveAnalysisBudget(
  maxItemsSetting: number | undefined,
): AnalysisBudget {
  const base =
    typeof maxItemsSetting === 'number' && maxItemsSetting > 0
      ? maxItemsSetting
      : DEFAULT_STRUCTURE_RECORD_BUDGET;
  const recordBudget = clampFinite(base, 1, MAX_STRUCTURE_RECORD_BUDGET);
  const fileBudget = clampFinite(
    base * FILE_BUDGET_MULTIPLIER,
    1,
    MAX_STRUCTURE_FILE_BUDGET,
  );
  return { fileBudget, recordBudget };
}

/**
 * Mutable tracker for a single bounded traversal. Owns the file/record
 * accounting and the one-sentinel observation that distinguishes an exact
 * record-budget exhaustion (complete) from a one-over (partial).
 */
export class BudgetTracker {
  filesVisited = 0;
  recordsRetained = 0;
  /**
   * Total records observed during traversal (retained + the one-over sentinel,
   * when present). For an exact exhausted traversal this equals recordsRetained;
   * for a sentinel overflow it is at least retained+1, i.e. a lower bound.
   */
  recordsObserved = 0;
  truncated = false;
  partialReason: PartialReason | undefined;

  /**
   * Node-candidate observation counter for callers/callees (direct/member/callee
   * insertions). Bounded by the effective max-nodes limit; the first one-over
   * candidate is observed as a sentinel (proving partiality) but not retained.
   */
  nodesObserved = 0;
  /** Node candidates actually retained into the callers/callees result. */
  nodesRetained = 0;

  /** Files skipped for exceeding the pre-read size gate (inexact count). */
  oversizedFiles = 0;
  /** Files that could not be read or parsed (inexact count). */
  unparseableFiles = 0;

  private nodeSentinelObserved = false;

  constructor(
    private readonly budget: AnalysisBudget,
    readonly signal: AbortSignal,
  ) {}

  /**
   * Whether traversal should continue visiting more files. Returns false when
   * the signal has aborted, ANY truncation reason has fired (abort, max-nodes,
   * max-files, or record-budget — all folded into {@link truncated}), or the
   * file budget is exhausted.
   */
  shouldVisitMoreFiles(): boolean {
    if (this.signal.aborted) {
      this.markTruncated('aborted');
      return false;
    }
    if (this.truncated) {
      return false;
    }
    if (this.filesVisited >= this.budget.fileBudget) {
      this.markTruncated('file-budget');
      return false;
    }
    return true;
  }

  /**
   * Attempt to retain one more record. Returns true when the record fits within
   * the budget (caller retains it). Returns false when the record budget is
   * exhausted: the FIRST such call observes the one-over sentinel (setting
   * truncated/partialReason) and the record must NOT be retained.
   *
   * Also returns false without incrementing any counter when the signal has
   * already aborted. An abort can be observed between the file-level check
   * ({@link shouldVisitMoreFiles}) and record retention (after an async file
   * parse), so the record loop must not inflate observed/retained counts once
   * the authoritative signal is aborted.
   */
  tryRetainRecord(): boolean {
    if (this.signal.aborted) {
      this.markTruncated('aborted');
      return false;
    }
    this.recordsObserved++;
    if (this.recordsRetained < this.budget.recordBudget) {
      this.recordsRetained++;
      return true;
    }
    // markTruncated is idempotent (partialReason ??=), so calling it on
    // every post-budget record is harmless and avoids a separate guard.
    this.markTruncated('record-budget');
    return false;
  }

  /**
   * Attempt to accept one more node candidate (direct/member/callee insertion)
   * into a callers/callees result, bounded by the effective max-nodes limit.
   *
   * Returns true when the node fits (caller retains it). Returns false when the
   * limit is exhausted: the FIRST such call observes the one-over sentinel
   * (setting truncated/partialReason='max-nodes') and the node must NOT be
   * retained. Also returns false without incrementing when the signal aborted.
   *
   * `exact-limit stays complete`: when exactly `maxNodes` candidates are
   * observed and no extra candidate arrives, no sentinel fires, so the result
   * remains exact/complete.
   */
  tryAcceptNode(maxNodes: number): boolean {
    if (this.signal.aborted) {
      this.markTruncated('aborted');
      return false;
    }
    this.nodesObserved++;
    if (this.nodesRetained < maxNodes) {
      this.nodesRetained++;
      return true;
    }
    if (!this.nodeSentinelObserved) {
      this.nodeSentinelObserved = true;
      this.markTruncated('max-nodes');
    }
    return false;
  }

  /**
   * Record a single file that could not be parsed (oversized / read-error /
   * parse-error). Each omission makes the result count a lower bound, so it
   * flips {@link countInexact} on (without forcing the traversal to stop).
   */
  recordFileOmission(reason: ParseOmissionReason): void {
    if (reason === 'oversized') {
      this.oversizedFiles++;
    } else {
      this.unparseableFiles++;
    }
  }

  /**
   * Mark the traversal aborted by the caller's signal. Respects the
   * authoritative signal this tracker was constructed with: a no-op when the
   * signal is not actually aborted, so a stray call cannot fabricate partial
   * metadata.
   */
  markAborted(): void {
    if (this.signal.aborted) {
      this.markTruncated('aborted');
    }
  }

  /** Whether counts are lower bounds rather than exhaustive totals. */
  get countInexact(): boolean {
    return (
      this.truncated || this.oversizedFiles > 0 || this.unparseableFiles > 0
    );
  }

  private markTruncated(reason: PartialReason): void {
    this.truncated = true;
    this.partialReason ??= reason;
  }
}
