/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Verbatim extraction from shell-parser.ts for the parser-lifetime refactor
// (no behavior change). All helpers in this module fall under
// @plan PLAN-20260825-SHELLMEM.P02 / @requirement REQ-3329-08 tree-lifetime
// ownership; the exported entry points carry the explicit markers.

import type { Node } from 'web-tree-sitter';

type SourceRange = {
  startIndex: number;
  endIndex: number;
};

function findNamedChild(node: Node, type: string): Node | null {
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child?.type === type) {
      return child;
    }
  }
  return null;
}

function collectHeredocRedirects(root: Node): Node[] {
  const redirects: Node[] = [];
  const stack: Node[] = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (current.type === 'heredoc_redirect') {
      redirects.push(current);
    }

    for (let index = current.namedChildCount - 1; index >= 0; index -= 1) {
      const child = current.namedChild(index);
      if (child) {
        stack.push(child);
      }
    }
  }

  return redirects;
}

function isQuotedHeredocStart(node: Node, source: string): boolean {
  const delimiter = source.slice(node.startIndex, node.endIndex);
  return (
    delimiter.includes("'") ||
    delimiter.includes('"') ||
    delimiter.includes('\\')
  );
}

function collectLiteralHeredocBodyRanges(
  root: Node,
  source: string,
): SourceRange[] {
  const ranges: SourceRange[] = [];

  for (const redirect of collectHeredocRedirects(root)) {
    const start = findNamedChild(redirect, 'heredoc_start');
    const body = findNamedChild(redirect, 'heredoc_body');
    if (start && body && isQuotedHeredocStart(start, source)) {
      ranges.push({
        startIndex: body.startIndex,
        endIndex: body.endIndex,
      });
    }
  }

  return ranges;
}

function getLiteralRange(
  ranges: SourceRange[],
  index: number,
): SourceRange | null {
  if (index < 0 || index >= ranges.length) {
    return null;
  }
  return ranges[index];
}

/**
 * @plan PLAN-20260825-SHELLMEM.P02
 * @requirement REQ-3329-08
 */
export function hasShellSubstitutionSyntax(
  command: string,
  root: Node,
): boolean {
  const literalRanges = collectLiteralHeredocBodyRanges(root, command);
  let literalRangeIndex = 0;
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let skipCurrent = false;

  for (let i = 0; i < command.length; i += 1) {
    const literalRange = getLiteralRange(literalRanges, literalRangeIndex);
    if (literalRange !== null && i >= literalRange.endIndex) {
      literalRangeIndex += 1;
    } else if (literalRange !== null && i >= literalRange.startIndex) {
      i = literalRange.endIndex - 1;
      continue;
    }

    const char = command[i];
    if (skipCurrent) {
      skipCurrent = false;
    } else if (char === '\\' && !inSingleQuotes) {
      skipCurrent = true;
    } else if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
    } else if (
      !inSingleQuotes &&
      isShellSubstitutionStart(command, i, inDoubleQuotes)
    ) {
      return true;
    }
  }
  return false;
}

function isShellSubstitutionStart(
  command: string,
  index: number,
  inDoubleQuotes: boolean,
): boolean {
  return (
    isCommandSubstitutionStart(command, index) ||
    isProcessSubstitutionStart(command, index, inDoubleQuotes) ||
    command[index] === '`'
  );
}

function isCommandSubstitutionStart(command: string, index: number): boolean {
  if (command[index] !== '$') {
    return false;
  }
  if (command[index + 1] !== '(') {
    return false;
  }
  // Exclude arithmetic expansion $(( )) which is not command substitution
  if (index + 2 < command.length && command[index + 2] === '(') {
    return false;
  }
  return true;
}

function isProcessSubstitutionStart(
  command: string,
  index: number,
  inDoubleQuotes: boolean,
): boolean {
  if (inDoubleQuotes) {
    return false;
  }
  return (
    isProcessSubstitutionOperator(command[index]) &&
    index + 1 < command.length &&
    command[index + 1] === '('
  );
}

function isProcessSubstitutionOperator(char: string | undefined): boolean {
  return char === '<' || char === '>';
}

function containsUnescapedBacktick(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
    } else if (text[index] === '`') {
      return true;
    }
  }
  return false;
}

/**
 * @plan PLAN-20260825-SHELLMEM.P02
 * @requirement REQ-3329-08
 */
export function hasUnrepresentedHeredocBacktickSubstitution(
  root: Node,
  source: string,
): boolean {
  for (const redirect of collectHeredocRedirects(root)) {
    const start = findNamedChild(redirect, 'heredoc_start');
    const body = findNamedChild(redirect, 'heredoc_body');
    if (
      start &&
      body &&
      !isQuotedHeredocStart(start, source) &&
      containsUnescapedBacktick(body.text)
    ) {
      return true;
    }
  }

  return false;
}
