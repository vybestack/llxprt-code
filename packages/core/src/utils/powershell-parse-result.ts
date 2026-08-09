/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from 'web-tree-sitter';
import type { CommandParseResult } from './shell-parser.js';
import {
  collectPwshCommandDetailsFromTree,
  findFirstErrorNode,
  type ParsePayloadFn,
} from './powershell-ast.js';

export function buildPwshCommandParseResult(
  tree: Tree | null,
  command: string,
  parsePayload: ParsePayloadFn,
): CommandParseResult {
  if (tree === null) {
    return {
      details: [],
      hasError: true,
      errorReason:
        'PowerShell command rejected because the parser timed out or produced no tree',
    };
  }

  if (tree.rootNode.hasError) {
    const errorNode = findFirstErrorNode(tree.rootNode);
    const position =
      errorNode === null
        ? ''
        : ` at ${errorNode.startPosition.row + 1}:${errorNode.startPosition.column + 1}`;
    return {
      details: [],
      hasError: true,
      errorReason: `PowerShell command rejected because tree-sitter-pwsh reported a syntax error${position}`,
    };
  }

  return {
    details: collectPwshCommandDetailsFromTree(tree, command, parsePayload),
    hasError: false,
  };
}
