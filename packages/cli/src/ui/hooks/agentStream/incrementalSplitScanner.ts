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
export class IncrementalSplitScanner {
  private text = '';
  private scanPos = 0;
  private fenceParityOdd = false;
  private lastFencePos = -1;
  private lastOutsideParagraphSplit = -1;
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
   * Index at which the accumulated text may be split without breaking markdown,
   * identical to `findLastSafeSplitPoint(this.getText())`.
   */
  getSplitPoint(): number {
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
    this.text = '';
    this.scanPos = 0;
    this.fenceParityOdd = false;
    this.lastFencePos = -1;
    this.lastOutsideParagraphSplit = -1;
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
      return this.scanFence(index, length);
    }
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
    this.fenceParityOdd = !this.fenceParityOdd;
    this.lastFencePos = index;
    return 3;
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
}
