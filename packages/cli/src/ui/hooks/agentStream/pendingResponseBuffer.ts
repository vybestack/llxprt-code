/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EmojiFilter } from '@vybestack/llxprt-code-core';
import { CommittedSegmentLedger } from './committedSegmentLedger.js';
import { IncrementalSplitScanner } from './incrementalSplitScanner.js';
import { StreamingSanitizer } from './streamingSanitizer.js';

export interface PendingResponsePushResult {
  readonly blocked: boolean;
  readonly feedback?: string;
}

export interface PendingResponseConsumeResult {
  readonly committedText: string;
  readonly retainedText: string;
}

/**
 * Owns the in-progress assistant response for one turn.
 *
 * Before issue #2852 every streamed delta re-sanitised and re-scanned the whole
 * accumulated response, so a single response cost `O(N^2)`. This buffer does
 * constant work per delta while keeping the committed text byte-identical to
 * whole-text sanitisation:
 *
 * - {@link StreamingSanitizer} filters each character once and holds back only
 *   a short unstable tail.
 * - {@link IncrementalSplitScanner} tracks the markdown-safe split point by
 *   advancing over new characters only.
 *
 * `displayText` includes the sanitised unstable tail so the terminal still
 * advances on every delta; only `stableText` is ever committed to history.
 */
export class PendingResponseBuffer {
  private readonly sanitizer: StreamingSanitizer;
  private readonly scanner = new IncrementalSplitScanner();
  private readonly committedSegments = new CommittedSegmentLedger();
  private provisional = '';

  constructor(filter: EmojiFilter | undefined) {
    this.sanitizer = new StreamingSanitizer(filter);
  }

  push(delta: string): PendingResponsePushResult {
    const result = this.sanitizer.push(delta);
    if (result.blocked) {
      return {
        blocked: true,
        ...(result.feedback !== undefined ? { feedback: result.feedback } : {}),
      };
    }
    this.scanner.append(result.stable);
    this.provisional = result.provisional;
    return {
      blocked: false,
      ...(result.feedback !== undefined ? { feedback: result.feedback } : {}),
    };
  }

  /** Text to render for the in-progress response, including the unstable tail. */
  get displayText(): string {
    return this.provisional.length === 0
      ? this.scanner.getText()
      : this.scanner.getText() + this.provisional;
  }

  /** Text that is safe to commit; excludes the unstable tail. */
  get stableText(): string {
    return this.scanner.getText();
  }

  /**
   * Markdown-safe split index within {@link stableText}, identical to
   * `findLastSafeSplitPoint(stableText)`.
   */
  getSplitPoint(): number {
    return this.scanner.getSplitPoint();
  }

  /** Drops the committed prefix `[0, splitPoint)` from the retained text. */
  consume(splitPoint: number): PendingResponseConsumeResult {
    const committedText = this.scanner.getText().slice(0, splitPoint);
    const retainedText = this.scanner.consume(splitPoint);
    return { committedText, retainedText };
  }

  /**
   * Drains the sanitiser's held-back tail and returns the complete text for the
   * turn. Must be called when the stream completes, is cancelled, or errors.
   */
  materialize(): { text: string; blocked: boolean; feedback?: string } {
    const flushed = this.sanitizer.flush();
    this.provisional = '';
    if (flushed.blocked) {
      return { text: '', blocked: true };
    }
    this.scanner.append(flushed.stable);
    return {
      text: this.scanner.getText(),
      blocked: false,
      ...(flushed.feedback !== undefined ? { feedback: flushed.feedback } : {}),
    };
  }

  beginCommittedSegments(): void {
    this.committedSegments.begin();
  }

  recordCommittedSegment(id: number): void {
    this.committedSegments.record(id);
  }

  drainCommittedSegments(): readonly number[] {
    return this.committedSegments.drain();
  }

  /**
   * Ends the committed-segment lifecycle for the assistant message that just
   * completed normally. Its committed prefixes are now permanent history, so
   * the ledger is cleared without retracting them. This bounds the ledger to a
   * single assistant message/stream: a later turn that emits only thinking or
   * tool state before a retry cannot drain an earlier completed message's ids
   * (issue #3048 review finding).
   */
  endCommittedSegments(): void {
    this.committedSegments.end();
  }

  reset(): void {
    this.sanitizer.reset();
    this.scanner.reset();
    this.provisional = '';
  }
}
