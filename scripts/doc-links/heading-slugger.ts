/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GitHub-compatible heading slug generator and heading extractor.
 *
 * GitHub's slug rules (see github-slugger):
 *  - lowercase
 *  - remove punctuation EXCEPT hyphens and spaces
 *  - spaces -> hyphens
 *  - consecutive hyphens are PRESERVED (GitHub does not collapse them)
 *  - leading/trailing hyphens trimmed
 *  - duplicate headings get suffixes: #repeat, #repeat-1, #repeat-2
 */

import { Lexer, type Token, type Tokens } from 'marked';

const HASH_PREFIX = '#';

// GitHub keeps any Unicode letter or digit (CJK, Cyrillic, accented Latin, ...)
// and strips only punctuation/symbols. An ASCII-only test would wrongly drop
// non-Latin headings, breaking otherwise-valid anchors such as README_CN.md's.
// Underscore is included deliberately: GitHub preserves it rather than
// stripping it, so a heading such as "## write_file Tool" anchors as
// #write_file-tool. Dropping underscores here would break those anchors.
const UNICODE_WORD = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string): boolean {
  return UNICODE_WORD.test(ch);
}

/**
 * Slugify text using GitHub-compatible rules.
 * Unlike the previous version, this does NOT collapse consecutive hyphens
 * (GitHub preserves them). It keeps the Unicode-letter/number handling.
 */
function slugify(text: string): string {
  const chars: string[] = [];
  for (const ch of text.toLowerCase()) {
    if (isWordChar(ch) || ch === ' ' || ch === '-') {
      chars.push(ch);
    }
  }
  const joined = chars.join('').trim();
  const hyphenated = joined.split(' ').join('-');
  return trimHyphens(hyphenated);
}

/**
 * Remove leading and trailing hyphens without using regex.
 */
function trimHyphens(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === '-') start++;
  while (end > start && s[end - 1] === '-') end--;
  return s.substring(start, end);
}

/**
 * Safely decode a percent-encoded URI component, returning undefined
 * on malformed input instead of throwing URIError.
 */
function safeDecodeURIComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/**
 * Walk the marked token AST, extracting text from all heading tokens
 * (both ATX and setext headings).
 */
function extractHeadingTexts(tokens: readonly Token[]): string[] {
  const headings: string[] = [];
  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading;
      const text = tokenText(heading.tokens);
      if (text !== '') {
        headings.push(text);
      }
    } else if ('tokens' in token && Array.isArray(token.tokens)) {
      headings.push(...extractHeadingTexts(token.tokens as Token[]));
    }
    if ('items' in token && Array.isArray(token.items)) {
      headings.push(...extractHeadingTexts(token.items as Token[]));
    }
  }
  return headings;
}

/**
 * Recursively extract plain text from inline tokens.
 */
function tokenText(tokens: readonly Token[] | undefined): string {
  if (!tokens) return '';
  const parts: string[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape':
        parts.push((token as Tokens.Text).text);
        break;
      case 'codespan':
        parts.push((token as Tokens.Codespan).text);
        break;
      case 'br':
        parts.push(' ');
        break;
      default:
        if ('text' in token && typeof token.text === 'string') {
          parts.push(token.text);
        }
        if ('tokens' in token && Array.isArray(token.tokens)) {
          parts.push(tokenText(token.tokens as Token[]));
        }
        break;
    }
  }
  return parts.join('');
}

/**
 * Build the set of GitHub-compatible heading slugs for the given content,
 * applying duplicate-heading suffixes (#repeat, #repeat-1, #repeat-2).
 */
function buildSlugSet(headingTexts: readonly string[]): Set<string> {
  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  for (const text of headingTexts) {
    const base = slugify(text);
    if (base === '') continue;
    const count = seen.get(base) ?? 0;
    const slug = count === 0 ? base : `${base}-${count}`;
    seen.set(base, count + 1);
    slugs.add(slug);
  }
  return slugs;
}

/**
 * Extract all heading slugs from Markdown content, skipping code blocks
 * (marked handles this natively). Supports both ATX (# Heading) and
 * setext (Heading\n=====) headings, with GitHub duplicate-heading suffixes.
 */
export function extractHeadingSlugs(content: string): Set<string> {
  const tokens = Lexer.lex(content);
  const headingTexts = extractHeadingTexts(tokens);
  return buildSlugSet(headingTexts);
}

/**
 * Normalize a fragment for comparison: strip a leading #, decode
 * percent-encoding safely, and slugify so the comparison is consistent
 * with how heading slugs are generated.
 */
function normalizeFragment(fragment: string): string | undefined {
  let frag = fragment;
  // Strip a leading '#' if present (URL fragments commonly include it)
  if (frag.startsWith(HASH_PREFIX)) {
    frag = frag.slice(HASH_PREFIX.length);
  }
  const decoded = safeDecodeURIComponent(frag);
  if (decoded === undefined) return undefined;
  return slugify(decoded);
}

/**
 * Check whether a fragment matches any slug in a pre-built heading slug set.
 * The fragment is slugified the same way headings are, and a leading '#'
 * is stripped if present. Malformed percent-encoding yields a non-match
 * instead of throwing.
 *
 * Use this (with extractHeadingSlugs) when checking multiple fragments
 * against the same document, so the document is lexed only once.
 */
export function fragmentMatchesSlugs(
  slugs: ReadonlySet<string>,
  fragment: string,
): boolean {
  const normalized = normalizeFragment(fragment);
  if (normalized === undefined) return false;
  return slugs.has(normalized);
}

/**
 * Check whether a fragment matches any heading slug in the content.
 * Convenience wrapper that lexes the content on every call — prefer
 * extractHeadingSlugs + fragmentMatchesSlugs when checking many fragments
 * against the same document.
 */
export function fragmentMatches(content: string, fragment: string): boolean {
  return fragmentMatchesSlugs(extractHeadingSlugs(content), fragment);
}
