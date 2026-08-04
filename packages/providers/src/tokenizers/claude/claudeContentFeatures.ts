/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Content signals for the calibrated Claude 5 prompt estimators.
 *
 * All signals are extensive (additive over concatenation) counts of Unicode
 * code points, so a calibration fitted on incremental corpus observations
 * applies unchanged to a whole finalized projection.
 *
 * They are derived in exactly one left-to-right scan. Nothing here selects a
 * tokenizer: the base counter is fixed for the family regardless of content.
 */
export interface ClaudeContentFeatures {
  /** Unicode code points. Astral characters count once, not twice. */
  readonly codePoints: number;
  /** Code points outside US-ASCII: CJK, other scripts, emoji, combining marks. */
  readonly nonAsciiCodePoints: number;
  /** ASCII punctuation that dominates code, JSON and tool-call payloads. */
  readonly structuralCodePoints: number;
  /** ASCII space, tab, carriage return and line feed. */
  readonly whitespaceCodePoints: number;
}

export const CLAUDE_CONTENT_FEATURE_NAMES = Object.freeze([
  'codePoints',
  'nonAsciiCodePoints',
  'structuralCodePoints',
  'whitespaceCodePoints',
] as const);

export type ClaudeContentFeatureName =
  (typeof CLAUDE_CONTENT_FEATURE_NAMES)[number];

const SPACE = 0x20;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const ASCII_MAX = 0x7f;
const BMP_MAX = 0xffff;
const HIGH_SURROGATE_START = 0xd800;
const LOW_SURROGATE_END = 0xdfff;

/**
 * ASCII code points treated as structural punctuation, as a bitmap over the
 * 0x20-0x7f range so the scan needs no set lookup or allocation.
 */
const STRUCTURAL_ASCII = '{}[]()<>:;=,."\'`/\\|*+-_#@$%^&~!?';

function buildStructuralTable(): Uint8Array {
  const table = new Uint8Array(ASCII_MAX + 1);
  for (let i = 0; i < STRUCTURAL_ASCII.length; i++) {
    table[STRUCTURAL_ASCII.charCodeAt(i)] = 1;
  }
  return table;
}

const STRUCTURAL_TABLE = buildStructuralTable();

function isWhitespace(codePoint: number): boolean {
  return (
    codePoint === SPACE ||
    codePoint === LINE_FEED ||
    codePoint === TAB ||
    codePoint === CARRIAGE_RETURN
  );
}

/**
 * Number of UTF-16 units consumed by the code point starting at `index`.
 *
 * A high surrogate is only paired with a following low surrogate. An unpaired
 * surrogate is consumed as a single code point, which keeps the counts exactly
 * additive across any split of the input — including a split that lands
 * between the halves of a surrogate pair.
 */
function unitsAt(text: string, index: number): number {
  const unit = text.charCodeAt(index);
  if (unit < HIGH_SURROGATE_START || unit > LOW_SURROGATE_END) return 1;
  return text.codePointAt(index)! > BMP_MAX ? 2 : 1;
}

/**
 * Derive every content signal in a single pass.
 *
 * Allocation is one result object per call: the scan itself uses only numeric
 * accumulators and never builds substrings, arrays or regex match objects.
 */
export function extractClaudeContentFeatures(
  text: string,
): ClaudeContentFeatures {
  let codePoints = 0;
  let nonAsciiCodePoints = 0;
  let structuralCodePoints = 0;
  let whitespaceCodePoints = 0;

  for (let index = 0; index < text.length; ) {
    const units = unitsAt(text, index);
    const codePoint =
      units === 2 ? text.codePointAt(index)! : text.charCodeAt(index);
    index += units;
    codePoints++;
    if (codePoint > ASCII_MAX) {
      nonAsciiCodePoints++;
    } else if (isWhitespace(codePoint)) {
      whitespaceCodePoints++;
    } else if (STRUCTURAL_TABLE[codePoint] === 1) {
      structuralCodePoints++;
    }
  }

  return Object.freeze({
    codePoints,
    nonAsciiCodePoints,
    structuralCodePoints,
    whitespaceCodePoints,
  });
}
