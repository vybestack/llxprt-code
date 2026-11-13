/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One kind of fact a reviewer must carry over unchanged when it rewords a
 * message (issue #4036). `key` maps a match to the token it is compared as.
 */
interface LiteralPattern {
  readonly pattern: RegExp;
  readonly key?: (match: string) => string;
}

/** Units that may follow a number after a space ("5 ms"). */
const SPACED_UNITS =
  'ms|s|sec|secs|min|mins|h|hr|hrs|kb|mb|gb|tb|kib|mib|gib|b|px|x|fps|hz|khz|mhz|ghz|bytes|byte';

/** "5 ms" and "5ms" are the same literal. */
function withoutSpaces(match: string): string {
  return match.replace(/[ \t]+/g, '');
}

/**
 * Facts are found by pattern in both the original and the replacement and
 * compared as whole tokens. Every pattern starts and ends on a token boundary,
 * so "42" is not found inside "142", "src/core/a.ts" is not found inside
 * "src/core/a.ts.bak" or "vendor/src/core/a.ts", and a hash is not a prefix of
 * a longer one. The patterns favour literals that a paraphrase would plausibly
 * mangle: quoted code, locations, figures and identifiers.
 */
const LITERAL_PATTERNS: readonly LiteralPattern[] = [
  // Fenced code blocks and inline code spans.
  { pattern: /```[\s\S]*?```/g },
  { pattern: /`[^`\n]+`/g },
  // URLs.
  { pattern: /\bhttps?:\/\/[^\s)>\]"'`]+/g },
  // Windows paths, then POSIX-style paths. A path never starts inside a
  // longer one, so the tail of "vendor/src/a.ts" is not a path of its own.
  { pattern: /\b[A-Za-z]:\\(?:[\w .-]+\\)*[\w.-]+/g },
  { pattern: /(?<![\w.@+/-])(?:~|\.{1,2})?(?:\/[\w.@+-]+)+\/?/g },
  { pattern: /(?<![\w.@+/-])[\w.@+-]+(?:\/[\w.@+-]+)+\/?/g },
  // Hex hashes: seven or more hex digits that include a digit, so words such
  // as "defaced" are not mistaken for one.
  { pattern: /\b(?=[0-9a-f]*\d)[0-9a-f]{7,64}\b/gi },
  // Versions with a leading "v".
  { pattern: /\bv\d+(?:\.\d+)+\b/gi },
  // Numbers, dotted versions, a percent sign or an attached unit. A sign
  // belongs to the number only when it starts a token ("-5", not "3-5").
  {
    pattern: new RegExp(
      String.raw`(?<![\w.])[+-]?\d[\d_,]*(?:\.\d+)*(?:%|[ \t]?(?:${SPACED_UNITS})\b|[A-Za-z]{1,4}\b)?(?!\w)`,
      'gi',
    ),
    key: withoutSpaces,
  },
  // SCREAMING_CASE tokens.
  { pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g },
  // dotted.identifiers whose first segment is a real name (not "e.g").
  { pattern: /\b[A-Za-z_]\w+(?:\.[A-Za-z_]\w*)+/g },
];

function trimTrailingPunctuation(literal: string): string {
  let end = literal.length;
  while (end > 0 && '.,;:!?'.includes(literal[end - 1])) end -= 1;
  return literal.slice(0, end);
}

/** Protected literals of `text`: compared token, shown text, once per token. */
function literalTokens(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const { pattern, key } of LITERAL_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const literal = trimTrailingPunctuation(match[0]);
      if (literal === '') continue;
      const token = key === undefined ? literal : key(literal);
      if (!found.has(token)) found.set(token, literal);
    }
  }
  return found;
}

/** Every protected literal in `text`, once each, in order of first appearance. */
export function extractProtectedLiterals(text: string): string[] {
  return [...literalTokens(text).values()];
}

/**
 * The protected literals of `original` that `replacement` does not carry as a
 * whole literal of its own. Both texts are tokenized the same way, so a
 * literal that survives only as part of a longer one ("42" in "142") is
 * dropped. A dropped literal that is only part of another dropped one is not
 * reported separately.
 */
export function findDroppedLiterals(
  original: string,
  replacement: string,
): string[] {
  const kept = literalTokens(replacement);
  const dropped = [...literalTokens(original)]
    .filter(([token]) => !kept.has(token))
    .map(([, shown]) => shown);
  return dropped.filter(
    (literal) =>
      !dropped.some((other) => other !== literal && other.includes(literal)),
  );
}
