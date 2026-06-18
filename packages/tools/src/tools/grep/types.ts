/**
 * Shared types and constants for the grep tool sub-modules.
 */

/**
 * Result object for a single grep match
 */
export interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

/**
 * Result of a search strategy execution.
 */
export interface SearchResults {
  results: GrepMatch[];
  wasLimited?: boolean;
  totalFound?: number;
}

/**
 * Options passed to the core search dispatcher.
 */
export interface SearchOptions {
  pattern: string;
  path: string;
  include?: string;
  signal: AbortSignal;
  maxResults?: number;
  maxFiles?: number;
  maxPerFile?: number;
}

/**
 * Default timeout for grep operations in milliseconds (1 minute)
 */
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Maximum allowed timeout for grep operations in milliseconds (5 minutes)
 */
export const MAX_TIMEOUT_MS = 300_000;

/**
 * Parameters for the GrepTool
 */
export interface GrepToolParams {
  pattern: string;
  dir_path?: string;
  path?: string;
  include?: string;
  max_results?: number;
  max_files?: number;
  max_per_file?: number;
  timeout_ms?: number;
}
