/**
 * Shared types and constants for the structural-analysis tool sub-modules.
 *
 * @plan PLAN-20260211-ASTGREP.P07
 */

import type { Lang } from '../../utils/ast-grep-utils.js';
import type { SgNode } from '@ast-grep/napi';

export const VALID_MODES = [
  'callers',
  'callees',
  'definitions',
  'hierarchy',
  'references',
  'dependencies',
  'exports',
] as const;
export type Mode = (typeof VALID_MODES)[number];

export const DEFAULT_DEPTH = 1;
export const MAX_DEPTH = 5;
export const DEFAULT_MAX_NODES = 50;

export interface StructuralAnalysisParams {
  mode: string;
  language: string;
  path?: string;
  symbol?: string;
  depth?: number;
  maxNodes?: number;
  target?: string;
  reverse?: boolean;
}

/** Reason a bounded traversal stopped before exhausting the workspace. */
export type PartialReason = 'file-budget' | 'record-budget' | 'aborted';

export interface AnalysisResult {
  mode: string;
  symbol?: string;
  truncated: boolean;
  results: unknown;
  /** True when traversal was stopped by a budget or abort (alias of truncated). */
  partial?: boolean;
  /** Why the traversal stopped early, if applicable. */
  partialReason?: PartialReason;
  /** Effective maximum number of files visited. */
  fileBudget?: number;
  /** Effective maximum number of records retained. */
  recordBudget?: number;
  /** Number of files actually visited (bounded by {@link fileBudget}). */
  filesVisited?: number;
  /** Number of records actually retained (bounded by {@link recordBudget}). */
  recordsRetained?: number;
  /**
   * Total records observed during traversal (retained + one-over sentinel when
   * present). Equals recordsRetained for an exact complete traversal; a lower
   * bound (at least retained+1) when a sentinel proved partiality.
   */
  recordsObserved?: number;
  /** True when retained/visited counts are lower bounds, not exhaustive totals. */
  countInexact?: boolean;
}

/**
 * Traversal context shared across recursive callers/callees analysis.
 */
export interface TraversalContext {
  nodesVisited: number;
  maxNodes: number;
  truncated: boolean;
  signal: AbortSignal;
}

/**
 * Parsed file representation used across all analysis modes.
 */
export interface ParsedFile {
  root: SgNode;
  content: string;
}

/**
 * Shared definition-entry shape.
 */
export interface DefinitionEntry {
  file: string;
  line: number;
  kind: string;
  text: string;
}

/**
 * Shared import-entry shape used by dependencies analysis.
 */
export interface ImportEntry {
  file: string;
  line: number;
  source: string;
  kind: string;
}

export type ResolvedLang = string | Lang;
