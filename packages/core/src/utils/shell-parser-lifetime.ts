/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scoped tree consumers for the shell parser. Keeping the tree lifetime in
 * one place (consume, then delete) prevents the tree-sitter heap objects
 * from outliving the call that parsed them (Issue #3329 secondary leak #4).
 */

import type { Tree } from 'web-tree-sitter';
import {
  parsePwshCommand,
  parseShellCommand,
  type ParserLanguage,
  PARSE_TIMEOUT_MICROS,
} from './shell-parser.js';

/**
 * Runs a Bash tree consumer and releases the tree before returning.
 * @internal
 * @plan PLAN-20260825-SHELLMEM.P02
 * @requirement REQ-3329-08
 */
export function withParsedTree<TResult>(
  command: string,
  consume: (tree: Tree) => TResult,
  timeoutMicros: number = PARSE_TIMEOUT_MICROS,
): TResult | null {
  const tree = parseShellCommand(command, timeoutMicros);
  if (tree === null) {
    return null;
  }
  try {
    return consume(tree);
  } finally {
    tree.delete();
  }
}

/**
 * Runs a language-specific tree consumer and releases the tree before
 * returning.
 * @internal
 * @plan PLAN-20260825-SHELLMEM.P02
 * @requirement REQ-3329-08
 */
export function withParsedTreeForLanguage<TResult>(
  command: string,
  language: ParserLanguage,
  consume: (tree: Tree) => TResult,
  timeoutMicros: number = PARSE_TIMEOUT_MICROS,
): TResult | null {
  if (language === 'bash') {
    return withParsedTree(command, consume, timeoutMicros);
  }
  const tree = parsePwshCommand(command, timeoutMicros);
  if (tree === null) {
    return null;
  }
  try {
    return consume(tree);
  } finally {
    tree.delete();
  }
}
