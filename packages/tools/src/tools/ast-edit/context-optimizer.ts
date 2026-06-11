/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Context optimizer for snippet deduplication and context size management.
 */

import type { CodeSnippet } from './types.js';
import { ASTConfig } from './ast-config.js';

/**
 * Handles optimization of code context including snippet management and prompt clipping.
 */
export class ContextOptimizer {
  /**
   * Clip prompt to fit max length limit (corresponds to AST clip_prompt)
   */
  static clipPrompt(prompt: string, maxLength: number): string {
    if (prompt.length <= maxLength) {
      return prompt;
    }

    // Clip from start, preserve newest content (AST strategy)
    let start = prompt.length - maxLength;
    while (!this.isCharBoundary(prompt, start)) {
      start += 1;
    }

    return prompt.substring(start);
  }

  /**
   * Check UTF-16 character boundary
   */
  private static isCharBoundary(str: string, index: number): boolean {
    if (index <= 0) return true;
    if (index >= str.length) return true;

    // Check for low surrogate (0xDC00–0xDFFF)
    const code = str.charCodeAt(index);
    if (code >= 0xdc00 && code <= 0xdfff) {
      // If previous character is high surrogate (0xD800–0xDBFF), this is not a boundary
      const prevCode = str.charCodeAt(index - 1);
      if (prevCode >= 0xd800 && prevCode <= 0xdbff) {
        return false;
      }
    }
    return true;
  }

  /**
   * Manage snippets by priority and budget (corresponds to AST snippet collection)
   */
  static optimizeSnippets(
    snippets: CodeSnippet[],
    maxChars: number = ASTConfig.MAX_SNIPPET_CHARS,
  ): CodeSnippet[] {
    // 1. Sort by priority and relevance
    const sortedSnippets = [...snippets].sort((a, b) => {
      // Higher priority first
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Same priority, sort by relevance
      return b.relevance - a.relevance;
    });

    // 2. Select snippets within budget
    const optimizedSnippets: CodeSnippet[] = [];
    let usedChars = 0;

    for (const snippet of sortedSnippets) {
      const truncatedSnippet = this.truncateSnippet(snippet);

      if (usedChars + truncatedSnippet.charLength > maxChars) {
        break; // Budget exhausted
      }

      optimizedSnippets.push(truncatedSnippet);
      usedChars += truncatedSnippet.charLength;
    }

    return optimizedSnippets;
  }

  /**
   * Truncate overly long snippets
   */
  static truncateSnippet(snippet: CodeSnippet): CodeSnippet {
    if (snippet.text.length <= ASTConfig.SNIPPET_TRUNCATE_LENGTH) {
      return snippet;
    }

    return {
      ...snippet,
      text:
        snippet.text.substring(0, ASTConfig.SNIPPET_TRUNCATE_LENGTH) + '...',
      charLength: ASTConfig.SNIPPET_TRUNCATE_LENGTH + 3,
    };
  }
}
