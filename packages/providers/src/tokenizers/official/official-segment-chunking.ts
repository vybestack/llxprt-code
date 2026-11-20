/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Exact piecewise counting for the official tokenizers (GLM 5.2, MiniMax M3,
 * Kimi K3).
 *
 * All three split text with a pre-tokenizer regex and run BPE inside each
 * piece, so a count over text cut at a piece boundary is the sum of the
 * counts of the parts. MiniMax additionally normalizes to NFC before
 * splitting, so a cut must also be a place where NFC(A + B) = NFC(A) + NFC(B).
 *
 * The cut rules below are deliberately narrow. Each is a pair (x, y) of the
 * code points on either side of the cut, valid for all three patterns:
 *
 *  - Letter | non-letter. A letter piece ends at its last letter; the only
 *    things that continue it are another letter, a mark (Kimi/MiniMax letter
 *    classes include \p{M}) and the ASCII apostrophe that starts a contraction
 *    suffix. A y that is none of those starts a new piece, or is whitespace.
 *    Without this restriction a preceding punctuation or space would be a
 *    piece prefix (`[^\r\n\p{L}\p{N}]?`), so only the letter side is cut.
 *  - Number | non-number. `\p{N}{1,3}` runs end at the first non-number.
 *  - Newline | non-space. Every alternative that can contain a "\n" ends at
 *    the end of the newline run (`[\r\n]*`, MiniMax `[\r\n/]*`) or at the last
 *    newline in the whitespace run (`\s*[\r\n]+`), so a following character that
 *    is neither whitespace nor "/" cannot be absorbed. "\s" differs between JS
 *    (adds U+FEFF) and the Rust regex used by tiktoken (adds U+0085), so both
 *    are excluded.
 *
 * In every rule y must be a stable NFC starter: not a mark and not a Hangul
 * Jamo vowel/final (the only characters with NFC_Quick_Check=Maybe are marks
 * and Jamo; every other character has ccc=0 and never composes backwards).
 */

const LETTER = /^\p{L}$/u;
const NUMBER = /^\p{N}$/u;
const MARK = /^\p{M}$/u;
const JAMO = /^[\u1100-\u11ff\ud7b0-\ud7ff]$/u;
const SPACE_LIKE = /^[\s\u0085\ufeff]$/u;

function isStableStarter(y: string): boolean {
  return !MARK.test(y) && !JAMO.test(y);
}

function isSafeCut(x: string, y: string): boolean {
  if (!isStableStarter(y)) return false;
  if (LETTER.test(x)) return !LETTER.test(y) && y !== "'";
  if (NUMBER.test(x)) return !NUMBER.test(y);
  if (x === '\n') return !SPACE_LIKE.test(y) && y !== '/';
  return false;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function codePointBefore(text: string, index: number): string {
  if (
    index >= 2 &&
    isLowSurrogate(text.charCodeAt(index - 1)) &&
    isHighSurrogate(text.charCodeAt(index - 2))
  )
    return text.slice(index - 2, index);
  return text.charAt(index - 1);
}

function isCutPoint(text: string, i: number): boolean {
  const code = text.charCodeAt(i);
  // Mid-pair, or a trailing high surrogate whose pair may still be arriving.
  if (isLowSurrogate(code) && isHighSurrogate(text.charCodeAt(i - 1)))
    return false;
  if (isHighSurrogate(code) && i === text.length - 1) return false;
  const y = String.fromCodePoint(text.codePointAt(i) ?? code);
  return isSafeCut(codePointBefore(text, i), y);
}

/**
 * The largest index `i` in `[from, text.length)` such that cutting `text`
 * between `i - 1` and `i` is exact, or -1. `from` lets a caller skip positions
 * it has already rejected.
 */
export function lastSafeCut(text: string, from = 1): number {
  let i = text.length - 1;
  while (i >= Math.max(1, from) && !isCutPoint(text, i)) i--;
  return i >= Math.max(1, from) ? i : -1;
}

export interface SegmentChunkTuning {
  /** Pending text at which a chunk is cut and counted. */
  readonly chunkChars: number;
  /**
   * Longest stretch with no safe cut that is counted whole. Such a run is a
   * single request-scoped allocation of its own length; a longer one fails.
   */
  readonly maxUnsplittableChars: number;
}

export const DEFAULT_SEGMENT_CHUNK_TUNING: SegmentChunkTuning = Object.freeze({
  chunkChars: 64 * 1024,
  maxUnsplittableChars: 4 * 1024 * 1024,
});

/**
 * Sum of `countChunk` over `pieces` cut only at the safe boundaries above, so
 * that it equals `countChunk` of the whole concatenation. Memory is one chunk
 * plus the unfinished tail, except for a single run with no safe boundary.
 */
export async function countAtSafeBoundaries(
  pieces: AsyncIterable<string>,
  countChunk: (text: string) => number | Promise<number>,
  tuning: SegmentChunkTuning = DEFAULT_SEGMENT_CHUNK_TUNING,
): Promise<number> {
  let total = 0;
  let pending = '';
  // Positions below `scanned` are already known to hold no safe cut.
  let scanned = 0;
  for await (const piece of pieces) {
    pending += piece;
    if (pending.length < tuning.chunkChars) continue;
    const cut = lastSafeCut(pending, scanned);
    if (cut !== -1) {
      total += await countChunk(pending.slice(0, cut));
      pending = pending.slice(cut);
    } else if (pending.length > tuning.maxUnsplittableChars) {
      throw new RangeError(
        `Official tokenizer input has a ${pending.length}-character run with no exact split point (limit ${tuning.maxUnsplittableChars})`,
      );
    }
    scanned = pending.length;
  }
  return pending === '' ? total : total + (await countChunk(pending));
}
