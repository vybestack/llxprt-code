/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Incremental equivalent of `findLastSafeSplitPoint` from
 * `../../utils/markdownUtilities.js`.
 *
 * The batch function rescans the whole accumulated response on every streamed
 * delta (issue #2852), which makes streaming quadratic in the response length.
 * This scanner consumes deltas and advances only over the newly appended
 * characters, so appending `k` characters costs `O(k)`.
 *
 * Equivalence relies on three properties of the batch implementation, all of
 * which hold because the streamed text is append-only:
 *
 * 1. Fence positions are discovered by a greedy left-to-right scan that skips
 *    three characters past each hit, so the fence sequence of a prefix is a
 *    prefix of the fence sequence of the whole text.
 * 2. Whether an index sits inside a fenced block depends only on the number of
 *    fences *before* it, so a position's classification never changes as more
 *    text arrives.
 * 3. When the fence count is odd the batch function returns the position of the
 *    last (unpaired) fence; when it is even it returns the rightmost `\n\n`
 *    boundary that is not inside a fence, or the text length.
 */

// Normal prose and balanced fences use markdown boundaries before reaching this
// limit. Forcing requires more than 512 KiB in one unclosed code block, which is
// above ordinary terminal responses while still bounding per-frame render work.
/**
 * Length of unclosed fenced content that forces a split.
 *
 * 512 KiB is roughly 128k tokens, which is the largest `maxOutputTokens` any
 * model in the catalog declares, so only a maximum-length response consisting
 * entirely of one unbroken code block can reach it. The consequence when that
 * happens is cosmetic: the block renders as two contiguous, identically styled
 * code blocks. That is a deliberate trade against retaining the whole response
 * and re-rendering it on every delta.
 *
 * Exported so tests bind to the real values instead of duplicating literals
 * that could drift away from them.
 */
export const MAX_UNCLOSED_FENCE_LENGTH = 512 * 1024;

/** Tail kept after a forced split, so the continuation still has context. */
export const FORCED_SPLIT_RETAINED_LENGTH = 64 * 1024;
/**
 * Info string following an opening fence.
 *
 * CommonMark allows any run of non-backtick characters, so the language is
 * matched as such rather than as `\w`: `c++`, `objective-c` and `c#` are all
 * legal and all contain punctuation. Getting this wrong is not cosmetic. The
 * continuation fence would fall back to three backticks with no language, and a
 * literal ``` inside the retained tail would then close it early, inverting
 * fence parity for the rest of the stream.
 */
const FENCE_INFO_PATTERN = new RegExp('^[ \\t]*([^`\\n]{0,100}?)[ \\t]*$');

export class IncrementalSplitScanner {
  private text = '';
  private scanPos = 0;
  private fenceParityOdd = false;
  private lastFencePos = -1;
  private lastOutsideParagraphSplit = -1;
  private openFence = '';
  private openFenceLanguage = '';
  private openFenceHeader = '';
  private capturingFenceHeader = false;
  private visited = 0;

  /**
   * Number of character positions examined so far. Used by complexity-guard
   * tests to assert linear scaling without relying on wall-clock timing.
   */
  get charactersScanned(): number {
    return this.visited;
  }

  get length(): number {
    return this.text.length;
  }

  getText(): string {
    return this.text;
  }

  append(delta: string): void {
    if (delta.length === 0) {
      return;
    }
    this.text += delta;
    this.scan();
  }

  /**
   * Index at which the accumulated text may be split without breaking markdown.
   * Oversized unclosed fences are split with a synthetic continuation boundary.
   */
  getSplitPoint(): number {
    if (this.shouldForceSplit()) {
      return this.forcedSplitPoint();
    }
    if (this.fenceParityOdd) {
      return this.lastFencePos;
    }
    return this.lastOutsideParagraphSplit >= 0
      ? this.lastOutsideParagraphSplit
      : this.text.length;
  }

  /**
   * Drops the committed prefix `[0, splitPoint)` and rebases internal state.
   * Returns the remaining tail.
   */
  consume(splitPoint: number): string {
    if (splitPoint <= 0) {
      return this.text;
    }
    if (this.fenceParityOdd && splitPoint > this.lastFencePos) {
      const continuationOpening = `${this.openFence}${this.openFenceLanguage}\n`;
      const retained = this.text.slice(splitPoint);
      const visited = this.visited;
      this.clearMarkdownState();
      this.visited = visited;
      this.text = continuationOpening + retained;
      this.scan();
      return this.text;
    }
    this.text = this.text.slice(splitPoint);
    this.scanPos = Math.max(0, this.scanPos - splitPoint);
    this.lastFencePos =
      this.lastFencePos >= splitPoint ? this.lastFencePos - splitPoint : -1;
    this.lastOutsideParagraphSplit =
      this.lastOutsideParagraphSplit > splitPoint
        ? this.lastOutsideParagraphSplit - splitPoint
        : -1;
    return this.text;
  }

  reset(): void {
    this.clearMarkdownState();
    this.visited = 0;
  }

  private scan(): void {
    const length = this.text.length;
    let index = this.scanPos;
    let deferred = false;
    while (index < length && !deferred) {
      this.visited += 1;
      const step = this.stepAt(index, length);
      deferred = step === 0;
      index += step;
    }
    this.scanPos = index;
  }

  /**
   * Advance distance from `index`, or 0 when the text ends mid-token and the
   * decision has to wait for more text.
   */
  private stepAt(index: number, length: number): number {
    const char = this.text[index];
    if (char === '`') {
      // Header capture deliberately does not run here. scanFence can defer
      // (return 0) when the run is still arriving, leaving scanPos unchanged,
      // and capturing first would then feed the same backtick in again on the
      // next delta and corrupt the header.
      return this.scanFence(index, length);
    }
    this.captureFenceHeaderCharacter(char);
    if (char === '\n') {
      return this.scanParagraphBreak(index, length);
    }
    return 1;
  }

  private scanFence(index: number, length: number): number {
    if (index + 1 >= length) {
      return 0;
    }
    if (this.text[index + 1] !== '`') {
      return 1;
    }
    if (index + 2 >= length) {
      return 0;
    }
    if (this.text[index + 2] !== '`') {
      return 1;
    }
    // Measure the whole backtick run rather than assuming three. A 4+ backtick
    // fence reconstructed as three would be closed early by a literal ``` in
    // the retained tail.
    let runEnd = index + 3;
    while (runEnd < length && this.text[runEnd] === '`') {
      runEnd += 1;
    }
    // The run may still be growing at the end of the text; wait for more rather
    // than recording a truncated fence.
    if (runEnd >= length) {
      return 0;
    }
    if (this.fenceParityOdd) {
      this.fenceParityOdd = false;
      this.clearOpenFence();
    } else {
      this.fenceParityOdd = true;
      this.openFence = this.text.slice(index, runEnd);
      this.openFenceLanguage = '';
      this.openFenceHeader = '';
      this.capturingFenceHeader = true;
    }
    this.lastFencePos = index;
    return runEnd - index;
  }

  private scanParagraphBreak(index: number, length: number): number {
    if (index + 1 >= length) {
      return 0;
    }
    if (this.text[index + 1] !== '\n') {
      return 1;
    }
    if (!this.fenceParityOdd) {
      this.lastOutsideParagraphSplit = index + 2;
    }
    return 1;
  }

  private shouldForceSplit(): boolean {
    return (
      this.fenceParityOdd &&
      this.lastFencePos >= 0 &&
      this.text.length - this.lastFencePos > MAX_UNCLOSED_FENCE_LENGTH
    );
  }

  /**
   * Split offset for a forced split, never landing inside a surrogate pair.
   *
   * Both halves matter. Landing on a low surrogate would strip its leading
   * partner from the retained tail; landing on a high surrogate would leave
   * that half at the end of the committed text with its partner in the tail.
   * Either way the pair is torn and both sides render a replacement character.
   */
  private forcedSplitPoint(): number {
    const candidate = this.text.length - FORCED_SPLIT_RETAINED_LENGTH;
    const code = this.text.charCodeAt(candidate);
    const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;
    if (isLowSurrogate) {
      return candidate + 1;
    }
    const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
    // Retain the whole pair rather than committing a lone high surrogate.
    return isHighSurrogate ? candidate - 1 : candidate;
  }

  private captureFenceHeaderCharacter(char: string): void {
    if (!this.capturingFenceHeader) {
      return;
    }
    if (char === '\n') {
      // openFence was recorded from the actual backtick run, so only the info
      // string is derived here.
      const language = this.openFenceHeader.match(FENCE_INFO_PATTERN)?.[1];
      this.openFenceLanguage = language ?? '';
      this.capturingFenceHeader = false;
      return;
    }
    if (this.openFenceHeader.length < 280) {
      this.openFenceHeader += char;
    } else {
      this.capturingFenceHeader = false;
    }
  }

  private clearOpenFence(): void {
    this.openFence = '';
    this.openFenceLanguage = '';
    this.openFenceHeader = '';
    this.capturingFenceHeader = false;
  }

  private clearMarkdownState(): void {
    this.text = '';
    this.scanPos = 0;
    this.fenceParityOdd = false;
    this.lastFencePos = -1;
    this.lastOutsideParagraphSplit = -1;
    this.clearOpenFence();
  }
}
