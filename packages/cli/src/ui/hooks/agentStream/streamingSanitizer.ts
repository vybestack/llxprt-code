/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EmojiFilter } from '@vybestack/llxprt-code-core';

/**
 * Held-back tail length that triggers a forced split, and the residual tail
 * kept after one. The gap between them gives the forced path hysteresis, so its
 * cost amortises to O(1) per character.
 */
const MAX_CARRY_LENGTH = 256;
const RESIDUAL_CARRY_LENGTH = 32;

export interface StreamingSanitizerResult {
  /**
   * Newly stabilised sanitised text. Append-only: callers append this to what
   * they already hold, they never replace with it.
   */
  readonly stable: string;
  /**
   * Sanitised rendering of the not-yet-stable tail. Shown after `stable` but
   * never committed; superseded by the next call. Bounded by
   * {@link MAX_CARRY_LENGTH}, so producing it is constant work.
   */
  readonly provisional: string;
  readonly blocked: boolean;
  readonly feedback?: string;
}

const EMPTY_RESULT: StreamingSanitizerResult = {
  stable: '',
  provisional: '',
  blocked: false,
};

const BLOCKED_RESULT: StreamingSanitizerResult = {
  stable: '',
  provisional: '',
  blocked: true,
};

interface SegmentResult {
  readonly text: string;
  readonly blocked: boolean;
  readonly feedback?: string;
}

interface DeltaScan {
  /** Index just past the last ASCII whitespace in the delta, or -1. */
  readonly whitespaceEnd: number;
  readonly hasNonAscii: boolean;
}

/**
 * Incremental replacement for sanitising the whole accumulated response on
 * every streamed delta (issue #2852).
 *
 * The previous implementation called `EmojiFilter.filterText` on the entire
 * accumulated text once per delta — `O(N)` per delta, `O(N^2)` per response.
 * This class examines each character a constant number of times by holding back
 * only the short tail that could still turn out to be part of an emoji
 * sequence.
 *
 * Safety argument for the split rule: every emoji sequence and every
 * emoji-to-text conversion key is composed of non-ASCII code points, except
 * keycap sequences, whose ASCII base is always followed by U+FE0F. Splitting
 * immediately after ASCII whitespace, or between two ASCII characters,
 * therefore never falls inside a sequence, so
 * `filterText(a) + filterText(b) === filterText(a + b)` holds for such a split.
 *
 * Invariant: the held-back tail never contains ASCII whitespace, so each delta
 * only has to be scanned once — the tail never needs rescanning.
 */
export class StreamingSanitizer {
  private carry = '';
  private carryHasNonAscii = false;
  private feedbackEmitted = false;
  private processed = 0;

  constructor(private readonly filter: EmojiFilter | undefined) {}

  /**
   * Characters examined so far. Used by complexity-guard tests to assert linear
   * scaling without relying on wall-clock timing.
   */
  get charactersProcessed(): number {
    return this.processed;
  }

  push(delta: string): StreamingSanitizerResult {
    if (delta.length === 0) {
      return EMPTY_RESULT;
    }
    if (!this.filter) {
      this.processed += delta.length;
      return { stable: delta, provisional: '', blocked: false };
    }

    this.processed += delta.length;
    const scan = scanDelta(delta);
    const combined = this.carry + delta;
    const boundary = this.resolveBoundary(combined, delta.length, scan);
    const stableSegment = combined.slice(0, boundary);
    this.carry = combined.slice(boundary);
    this.carryHasNonAscii = this.recomputeCarryFlag(scan, boundary, combined);
    return this.sanitizeSegments(stableSegment);
  }

  /**
   * Drains the held-back tail. Must be called when the stream completes, is
   * cancelled, or errors, so trailing text is never lost.
   */
  flush(): StreamingSanitizerResult {
    const remaining = this.carry;
    this.carry = '';
    this.carryHasNonAscii = false;
    if (remaining.length === 0) {
      return EMPTY_RESULT;
    }
    if (!this.filter) {
      return { stable: remaining, provisional: '', blocked: false };
    }
    this.processed += remaining.length;
    return this.sanitizeSegments(remaining);
  }

  reset(): void {
    this.carry = '';
    this.carryHasNonAscii = false;
    this.feedbackEmitted = false;
    this.processed = 0;
  }

  private resolveBoundary(
    combined: string,
    deltaLength: number,
    scan: DeltaScan,
  ): number {
    if (scan.whitespaceEnd >= 0) {
      return combined.length - deltaLength + scan.whitespaceEnd;
    }
    if (combined.length <= MAX_CARRY_LENGTH) {
      return 0;
    }
    return forcedBoundary(combined);
  }

  private recomputeCarryFlag(
    scan: DeltaScan,
    boundary: number,
    combined: string,
  ): boolean {
    if (boundary === 0) {
      return this.carryHasNonAscii || scan.hasNonAscii;
    }
    this.processed += combined.length - boundary;
    return containsNonAscii(combined, boundary);
  }

  private sanitizeSegments(stableSegment: string): StreamingSanitizerResult {
    const stable = this.filterSegment(stableSegment);
    if (stable.blocked) {
      return BLOCKED_RESULT;
    }
    const provisional = this.filterCarry();
    if (provisional.blocked) {
      return BLOCKED_RESULT;
    }
    const feedback = this.takeFeedback(stable.feedback ?? provisional.feedback);
    return {
      stable: stable.text,
      provisional: provisional.text,
      blocked: false,
      ...(feedback !== undefined ? { feedback } : {}),
    };
  }

  /**
   * A pure-ASCII tail cannot contain an emoji or a conversion key, so it needs
   * no filtering. This keeps the common case (prose and code) linear in the
   * delta rather than linear in the retained tail.
   */
  private filterCarry(): SegmentResult {
    if (!this.carryHasNonAscii) {
      return { text: this.carry, blocked: false };
    }
    this.processed += this.carry.length;
    return this.filterSegment(this.carry);
  }

  private filterSegment(segment: string): SegmentResult {
    if (!this.filter || segment.length === 0) {
      return { text: segment, blocked: false };
    }
    const result = this.filter.filterText(segment);
    if (result.blocked) {
      return { text: '', blocked: true };
    }
    return {
      text: typeof result.filtered === 'string' ? result.filtered : '',
      blocked: false,
      ...(result.systemFeedback !== undefined
        ? { feedback: result.systemFeedback }
        : {}),
    };
  }

  /**
   * The whole-text filter repeats the same advisory every time it sees an
   * emoji. Because the old implementation re-filtered the entire response on
   * every delta, that advisory was appended to history once per delta. Emitting
   * it once per turn keeps the advisory visible without the duplicates.
   */
  private takeFeedback(feedback: string | undefined): string | undefined {
    if (feedback === undefined || this.feedbackEmitted) {
      return undefined;
    }
    this.feedbackEmitted = true;
    return feedback;
  }
}

function scanDelta(delta: string): DeltaScan {
  let whitespaceEnd = -1;
  let hasNonAscii = false;
  for (let index = 0; index < delta.length; index += 1) {
    const code = delta.charCodeAt(index);
    if (code >= 0x80) {
      hasNonAscii = true;
    } else if (isAsciiWhitespace(code)) {
      whitespaceEnd = index + 1;
    }
  }
  return { whitespaceEnd, hasNonAscii };
}

function containsNonAscii(text: string, from: number): boolean {
  for (let index = from; index < text.length; index += 1) {
    if (text.charCodeAt(index) >= 0x80) {
      return true;
    }
  }
  return false;
}

/**
 * Splits a whitespace-free tail that has grown past {@link MAX_CARRY_LENGTH},
 * leaving at most {@link RESIDUAL_CARRY_LENGTH} characters held back. Prefers
 * an ASCII/ASCII boundary; otherwise splits on a code-point boundary so
 * surrogate pairs stay intact.
 */
function forcedBoundary(text: string): number {
  const floor = text.length - RESIDUAL_CARRY_LENGTH;
  for (let index = text.length - 1; index > floor; index -= 1) {
    if (text.charCodeAt(index) < 0x80 && text.charCodeAt(index - 1) < 0x80) {
      return index;
    }
  }
  const code = text.charCodeAt(floor);
  const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;
  return isLowSurrogate ? floor + 1 : floor;
}

function isAsciiWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}
