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

  // Section: ast_edit Preview Safety Policies (issue #3242)
  /**
   * Maximum declarations rendered by an ast_edit preview, selected by
   * proximity to the edit's start line (nearest first, rendered in source
   * order). Internal policy — not a public tool parameter.
   */
  static readonly PREVIEW_MAX_DECLARATIONS = 128;
  /**
   * Maximum relevant snippets reported by an ast_edit preview.
   */
  static readonly PREVIEW_MAX_SNIPPETS = 64;
  /**
   * Hard UTF-8 byte budget for the entire ast_edit preview llmContent,
   * including path, validation, declarations, truncation metadata, timestamp,
   * and next-step instruction.
   */
  static readonly PREVIEW_LLM_MAX_BYTES = 256 * 1024;

  /**
   * Maximum UTF-8 bytes of the AST validation summary label an ast_edit
   * preview embeds verbatim in its mandatory status line. The shared
   * categorizer embeds every diagnostic line number into its labels, so a
   * label above this allowance is replaced by a fixed-width truthful
   * classification. Internal policy — not a public tool parameter.
   */
  static readonly PREVIEW_VALIDATION_SUMMARY_MAX_BYTES = 512;

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
    h: 'c',
    html: 'html',
    css: 'css',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
  };
}
