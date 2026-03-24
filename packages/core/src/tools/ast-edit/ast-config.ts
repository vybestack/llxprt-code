/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';

/**
 * Internal configuration for AST analysis tools.
 * Contains constants and feature flags for context collection, performance optimization, and language support.
 */
export class ASTConfig {
  static readonly CONTEXT_DEPTH = 5;
  static readonly MAX_SNIPPETS = 10;
  static readonly ENABLE_AST_PARSING = true;
  static readonly DEFAULT_DRY_RUN = true;
  static readonly MAX_SNIPPET_CHARS = 1000; // Increased budget
  static readonly CHUNK_SIZE = 500;
  static readonly SNIPPET_TRUNCATE_LENGTH = 200;

  // Section: Performance Optimization Constants
  /**
   * Whether to build a full in-memory symbol index.
   * [CCR] Reason: Disabled by default to prevent memory leaks and CLI crashes in large repos.
   * Can be overridden via environment variable: LLXPRT_ENABLE_SYMBOL_INDEXING=true
   */
  static get ENABLE_SYMBOL_INDEXING(): boolean {
    return process.env.LLXPRT_ENABLE_SYMBOL_INDEXING === 'true';
  }
  /**
   * Maximum symbols to query across the workspace per file.
   */
  static readonly MAX_RELATED_SYMBOLS = 5;
  /**
   * Maximum results to return per symbol query.
   */
  static readonly MAX_RESULTS_PER_SYMBOL = 10;
  /**
   * Timeout for a single symbol relationship lookup.
   */
  static readonly FIND_RELATED_TIMEOUT_MS = 3000;
  /**
   * Minimum length for a symbol to be considered for cross-file lookup.
   */
  static readonly MIN_SYMBOL_LENGTH = 3;
  /**
   * Maximum workspace files to scan. Abort if exceeded to prevent OOM.
   * [CCR] Reason: Safeguard against memory exhaustion in very large monorepos.
   */
  static readonly MAX_WORKSPACE_FILES = 10000;
  /**
   * Maximum display results for related symbols in output.
   */
  static readonly MAX_DISPLAY_RESULTS = 5;

  static readonly SUPPORTED_LANGUAGES = {
    ts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    html: 'html',
    css: 'css',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
  };
}
