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
 * Parse a raw link destination into its components.
 *
 * Returns undefined only for a target that is entirely empty/whitespace
 * with no fragment. A pure-fragment link such as `#section` yields
 * `{ target: '', fragment: 'section', isExternal: false }` — the empty
 * `target` signals "same-file fragment link" so the caller can validate
 * the anchor against the current file.
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
 * so the caller can skip them (the guard does not perform network checks).
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
 * Remove fenced code blocks AND inline code spans from content, returning
 * the lines that are NOT inside any fence or codespan. Delegates to marked's
 * tokenizer so fence matching (length, character, indentation) and code-span
 * detection are correct per CommonMark.
 *
 * Both fenced code blocks (Tokens.Code) and inline code spans
 * (Tokens.Codespan) are excluded — inline code is stripped too because it
 * can carry link-shaped text or bookkeeping markers that must not be
 * mistaken for real content.
 */
export function stripCodeTokens(lines: readonly string[]): string[] {
  const tokens = Lexer.lex(lines.join('\n'));
  const result: string[] = [];
  walkNonCodeTokens(tokens, result);
  return result;
}

/**
 * Token types that should be excluded from line extraction (code blocks
 * and code spans). Raw HTML blocks and HTML comments are NOT excluded —
 * markers hidden in HTML comments (e.g. `<!-- @plan: ... -->`) are the
 * primary case the placement guard must catch, and raw HTML in docs/ is
 * prose-equivalent content that can still carry bookkeeping metadata.
 */
const CODE_TOKEN_TYPES = new Set(['code', 'codespan']);

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

/**
 * Extract lines from a single token. Container tokens (paragraph,
 * blockquote, list, list_item) carry a non-empty `.raw` containing the
 * verbatim source — but that raw text may include nested fenced code
 * blocks. Recursing into `.tokens`/`.items` FIRST lets walkNonCodeTokens
 * skip nested code tokens; only leaf tokens (heading, hr, etc.) fall
 * back to `.raw`.
 */
function extractTokenLines(token: Token, result: string[]): void {
  if ('tokens' in token && Array.isArray(token.tokens)) {
    walkNonCodeTokens(token.tokens as Token[], result);
    return;
  }
  if ('items' in token && Array.isArray(token.items)) {
    walkNonCodeTokens(token.items as Token[], result);
    return;
  }
  if ('raw' in token && typeof token.raw === 'string' && token.raw !== '') {
    const lines = token.raw.split('\n').filter((l) => l !== '');
    result.push(...lines);
  }
}
