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

export interface AnalysisResult {
  mode: string;
  symbol?: string;
  truncated: boolean;
  results: unknown;
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
