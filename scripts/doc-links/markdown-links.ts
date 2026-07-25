/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extract Markdown links from file content using the `marked` lexer AST.
 *
 * This module is the ONLY place that parses arbitrary external Markdown.
 * By delegating to `marked` (which correctly handles CommonMark fence
 * rules, indented code, code spans, titled destinations, angle-bracket
 * destinations, balanced parentheses, etc.) we eliminate the entire class
 * of bugs that the hand-rolled scanner had.
 */

import { Lexer, type Token, type Tokens } from 'marked';

export interface DocLink {
  readonly target: string;
  readonly fragment: string | undefined;
  readonly isExternal: boolean;
}

/**
 * Parse a raw link destination into its components. Returns undefined for
 * empty targets.
 */
export function parseTarget(raw: string): DocLink | undefined {
  let target = raw.trim();
  if (target === '') return undefined;
  const lower = target.toLowerCase();
  const isExternal =
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:');
  let fragment: string | undefined;
  const hashIdx = target.indexOf('#');
  if (hashIdx !== -1) {
    fragment = target.slice(hashIdx + 1);
    target = target.slice(0, hashIdx);
  }
  return { target, fragment: fragment || undefined, isExternal };
}

/**
 * Recursively walk a token tree, collecting link destinations from
 * Link and Def tokens. Code blocks and code spans are inherently excluded
 * because marked never emits link tokens inside them.
 */
function collectLinksFromTokens(
  tokens: readonly Token[],
  links: DocLink[],
): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'link':
      case 'image': {
        const linkToken = token as Tokens.Link | Tokens.Image;
        const parsed = parseTarget(linkToken.href);
        if (parsed) {
          links.push(parsed);
        }
        // Inline links can contain nested links (e.g. images inside link text)
        if ('tokens' in linkToken && linkToken.tokens) {
          collectLinksFromTokens(linkToken.tokens, links);
        }
        break;
      }
      case 'def': {
        const defToken = token as Tokens.Def;
        const parsed = parseTarget(defToken.href);
        if (parsed) {
          links.push(parsed);
        }
        break;
      }
      default: {
        // Tokens that contain nested token arrays (blockquote, list,
        // paragraph, heading, table, strong, em, del, list_item, etc.)
        if ('tokens' in token && Array.isArray(token.tokens)) {
          collectLinksFromTokens(token.tokens as Token[], links);
        }
        if ('items' in token && Array.isArray(token.items)) {
          collectLinksFromTokens(token.items as Token[], links);
        }
        break;
      }
    }
  }
}

/**
 * Extract all checkable links from Markdown content, skipping fenced
 * code blocks and inline code spans (marked handles this natively).
 *
 * External links (http/https/mailto) are returned but flagged isExternal
 * so the caller can apply .lycheeignore filtering.
 */
export function extractLinks(content: string): DocLink[] {
  const links: DocLink[] = [];
  // marked.lex tokenizes block-level Markdown into a proper AST.
  // Fenced code blocks become Tokens.Code, indented code becomes
  // Tokens.Code with codeBlockStyle: 'indented', and inline code
  // becomes Tokens.Codespan — none of these emit nested link tokens.
  const tokens = Lexer.lex(content);
  collectLinksFromTokens(tokens, links);
  return links;
}

/**
 * Remove fenced code blocks from content, returning the lines that are
 * NOT inside any fence. Delegates to marked's tokenizer so fence
 * matching (length, character, indentation) is correct per CommonMark.
 *
 * Kept for backward compatibility with check-doc-placement.ts and
 * heading-slugger.ts.
 */
export function stripFencedBlocks(lines: readonly string[]): string[] {
  const tokens = Lexer.lex(lines.join('\n'));
  const result: string[] = [];
  walkNonCodeTokens(tokens, result);
  return result;
}

/**
 * Token types that should be excluded from line extraction (code blocks,
 * code spans, and raw HTML).
 */
const CODE_TOKEN_TYPES = new Set(['code', 'codespan', 'html']);

/**
 * Recursively extract raw text from non-code tokens, producing a list
 * of lines that excludes all fenced and indented code blocks.
 */
function walkNonCodeTokens(tokens: readonly Token[], result: string[]): void {
  for (const token of tokens) {
    if (CODE_TOKEN_TYPES.has(token.type)) {
      continue;
    }
    extractTokenLines(token, result);
  }
}

function extractTokenLines(token: Token, result: string[]): void {
  if ('raw' in token && typeof token.raw === 'string' && token.raw !== '') {
    const lines = token.raw.split('\n').filter((l) => l !== '');
    result.push(...lines);
  } else if ('tokens' in token && Array.isArray(token.tokens)) {
    walkNonCodeTokens(token.tokens as Token[], result);
  }
  if ('items' in token && Array.isArray(token.items)) {
    walkNonCodeTokens(token.items as Token[], result);
  }
}
