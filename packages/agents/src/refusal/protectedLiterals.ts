/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Facts a reviewer must carry over unchanged when it rewords a message
 * (issue #4036). They are found by pattern in the original text and must then
 * appear verbatim in the replacement. The patterns favour literals that a
 * paraphrase would plausibly mangle: quoted code, locations, figures and
 * identifiers.
 */
const LITERAL_PATTERNS: readonly RegExp[] = [
  // Fenced code blocks and inline code spans.
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  // URLs.
  /\bhttps?:\/\/[^\s)>\]"'`]+/g,
  // Windows paths, then POSIX-style paths with at least one separator.
  /\b[A-Za-z]:\\(?:[\w .-]+\\)*[\w.-]+/g,
  /(?:~|\.{1,2})?(?:\/[\w.@+-]+)+\/?/g,
  /\b[\w.@+-]+(?:\/[\w.@+-]+)+/g,
  // Hex hashes: seven or more hex digits that include a digit, so words such
  // as "defaced" are not mistaken for one.
  /\b(?=[0-9a-f]*\d)[0-9a-f]{7,64}\b/gi,
  // Numbers with sign, decimals, a percent sign or an attached unit.
  /[+-]?\d[\d_,]*(?:\.\d+)?(?:%|[A-Za-z]{1,4}\b)?/g,
  // SCREAMING_CASE tokens.
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
  // dotted.identifiers whose first segment is a real name (not "e.g").
  /\b[A-Za-z_]\w+(?:\.[A-Za-z_]\w*)+/g,
];

function trimTrailingPunctuation(literal: string): string {
  let end = literal.length;
  while (end > 0 && '.,;:!?'.includes(literal[end - 1])) end -= 1;
  return literal.slice(0, end);
}

/** Every protected literal in `text`, once each, in order of first appearance. */
export function extractProtectedLiterals(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of LITERAL_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const literal = trimTrailingPunctuation(match[0]);
      if (literal !== '') found.add(literal);
    }
  }
  return [...found];
}

/**
 * The protected literals of `original` that `replacement` does not contain.
 * A dropped literal that is only part of another dropped one (the `/core/a.ts`
 * inside `src/core/a.ts`) is not reported separately.
 */
export function findDroppedLiterals(
  original: string,
  replacement: string,
): string[] {
  const dropped = extractProtectedLiterals(original).filter(
    (literal) => !replacement.includes(literal),
  );
  return dropped.filter(
    (literal) =>
      !dropped.some((other) => other !== literal && other.includes(literal)),
  );
}
