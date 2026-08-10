/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createByteBudget,
  completeUtf8PrefixLength,
  completeUtf8SuffixStart,
  type ByteBudget,
} from '@vybestack/llxprt-code-tools/acquisition.js';

/**
 * One segment of the final assembled prompt. Literal segments carry template
 * text verbatim; output segments carry an executed injection's output plus an
 * optional status/error suffix.
 */
export type PromptSegment =
  | { readonly kind: 'literal'; readonly text: string }
  | {
      readonly kind: 'output';
      /** Command stdout/stderr text. */
      readonly output: string;
      /** Status suffix, e.g. `\n[exited with code 42]`, or empty string. */
      readonly statusSuffix: string;
    };

/**
 * Default aggregate byte budget for all injection outputs combined when a
 * caller does not supply a resolved budget. Production callers resolve the
 * budget from the configured shell acquisition setting
 * (`outputRetentionMaxBytes`) via {@link resolveByteBudgetFromSetting}; this
 * constant only provides a finite fallback for the segment-based convenience
 * wrapper.
 */
export const DEFAULT_INJECTION_OUTPUT_BUDGET_BYTES = 4 * 1024 * 1024;

const INJECTION_OMISSION_NOTICE = 'LLXPRT injection output truncated';

function byteLengthUtf8(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

interface OutputRecord {
  /** Status/error suffix, emitted exactly once regardless of truncation. */
  readonly statusSuffix: string;
  /** Retained head portion (may be a partial prefix of the original output). */
  headText: string;
  /** Retained tail portion (may be a partial suffix; '' when fully dropped). */
  tailText: string;
}

/**
 * Streaming aggregate-output builder that bounds the SUM of all command-output
 * bytes across every injection site to a single finite {@link ByteBudget},
 * while preserving literal template placement and emitting each command's
 * status/error suffix exactly once.
 *
 * Design (issue #3200 finding 2):
 * - **Streaming / bounded retention:** each command's full output is fed to
 *   {@link appendOutput} and immediately reduced to a bounded head/tail
 *   portion; the full output text is never retained by the builder. The
 *   builder therefore never holds all command outputs simultaneously, and its
 *   retained output state is bounded by the budget regardless of how many
 *   injections run.
 * - **One global budget:** a head region (first half of the budget) fills
 *   first; once it is full the builder switches to a sliding tail region
 *   (second half) that evicts the oldest retained tail content. Total
 *   retained output bytes never exceed the budget.
 * - **Statuses preserved exactly once:** every command's status suffix is
 *   emitted exactly once in {@link build}, even when the command's output is
 *   entirely dropped into the truncated middle.
 * - **One accurate notice:** a single omission notice carrying the exact
 *   omitted byte count is emitted at the head/tail boundary.
 * - **UTF-8 safety:** head/tail splits and tail eviction trim on complete
 *   UTF-8 character boundaries so multibyte characters are never severed.
 */
export class StreamingInjectionBuilder {
  private readonly headBudget: number;
  private readonly tailBudget: number;
  private readonly literals: string[] = [];
  private readonly outputs: OutputRecord[] = [];
  /** Output indices that currently hold tail content, in arrival order. */
  private tailOrder: number[] = [];
  private tailOrderHead = 0;
  private pendingLiteral = '';
  private headBytesUsed = 0;
  private tailBytesUsed = 0;
  private headClosed = false;
  private totalOutputBytes = 0;

  constructor(budget: ByteBudget) {
    this.headBudget = Math.floor(budget.bytes / 2);
    this.tailBudget = budget.bytes - this.headBudget;
  }

  /** Append literal template text (never bounded). */
  appendLiteral(text: string): void {
    this.pendingLiteral += text;
  }

  /**
   * Append one command's output and status suffix. The full `output` text is
   * reduced to a bounded head/tail portion immediately and is not retained.
   */
  appendOutput(output: string, statusSuffix: string): void {
    this.literals.push(this.pendingLiteral);
    this.pendingLiteral = '';
    const totalBytes = byteLengthUtf8(output);
    this.totalOutputBytes += totalBytes;
    const record: OutputRecord = { statusSuffix, headText: '', tailText: '' };
    this.outputs.push(record);
    this.placeOutput(this.outputs.length - 1, output, totalBytes);
  }

  /** Total output bytes observed across all injections (monotonic). */
  get observedOutputBytes(): number {
    return this.totalOutputBytes;
  }

  /** Output bytes currently retained (head + tail), always ≤ budget. */
  get retainedOutputBytes(): number {
    return this.headBytesUsed + this.tailBytesUsed;
  }

  /** Assemble the final bounded prompt string. */
  build(): string {
    this.literals.push(this.pendingLiteral);
    this.pendingLiteral = '';
    const n = this.outputs.length;
    const omittedBytes = Math.max(
      0,
      this.totalOutputBytes - this.retainedOutputBytes,
    );
    const truncated = omittedBytes > 0;
    const parts: string[] = [];
    let noticeEmitted = false;
    const emitNotice = (): void => {
      if (truncated && !noticeEmitted) {
        parts.push(
          `[${INJECTION_OMISSION_NOTICE}: ${omittedBytes.toLocaleString('en-US')} bytes omitted]`,
        );
        noticeEmitted = true;
      }
    };

    let enteredTail = false;
    for (let i = 0; i < n; i++) {
      const out = this.outputs[i];
      const hasHead = out.headText !== '';
      const hasTail = out.tailText !== '';
      parts.push(this.literals[i]);
      // The first output with no head content marks the transition into the
      // tail/dropped region. Its preceding literal must remain before the
      // notice so template and substitution order are unchanged.
      if (!hasHead && !enteredTail) {
        enteredTail = true;
        emitNotice();
      }
      if (hasHead) {
        parts.push(out.headText);
        if (hasTail) {
          // Boundary output: its remainder survived in the tail. Emit the
          // notice between the retained head and tail of this one output.
          emitNotice();
          parts.push(out.tailText);
        }
        parts.push(out.statusSuffix);
      } else if (hasTail) {
        parts.push(out.tailText);
        parts.push(out.statusSuffix);
      } else {
        // Fully dropped middle output: preserve the status exactly once.
        parts.push(out.statusSuffix);
      }
    }
    parts.push(this.literals[n]);
    return parts.join('');
  }

  private placeOutput(index: number, text: string, totalBytes: number): void {
    if (!this.headClosed) {
      const remaining = this.headBudget - this.headBytesUsed;
      if (totalBytes <= remaining) {
        this.outputs[index].headText = text;
        this.headBytesUsed += totalBytes;
        return;
      }
      // This output straddles the head boundary: keep a head prefix and route
      // the remainder to the sliding tail.
      if (remaining > 0) {
        const buf = Buffer.from(text, 'utf8');
        let headEnd = Math.min(remaining, buf.length);
        headEnd = completeUtf8PrefixLength(buf.subarray(0, headEnd));
        const headPart = buf.subarray(0, headEnd).toString('utf8');
        this.outputs[index].headText = headPart;
        this.headBytesUsed += headEnd;
        this.headClosed = true;
        const remainder = buf.subarray(headEnd).toString('utf8');
        this.addToTail(index, remainder);
        return;
      }
      this.headClosed = true;
      this.addToTail(index, text);
      return;
    }
    this.addToTail(index, text);
  }

  private addToTail(index: number, text: string): void {
    if (text === '') {
      return;
    }
    this.outputs[index].tailText = text;
    this.tailOrder.push(index);
    this.tailBytesUsed += byteLengthUtf8(text);
    this.evictTail();
  }

  /**
   * Evict the oldest retained tail content (whole segments first, then a
   * leading byte trim) until the tail region is back within its budget.
   * Trimmed/dropped outputs keep their status suffix (emitted in build()).
   */
  private evictTail(): void {
    while (
      this.tailBytesUsed > this.tailBudget &&
      this.tailOrderHead < this.tailOrder.length
    ) {
      const firstIndex = this.tailOrder[this.tailOrderHead];
      const firstText = this.outputs[firstIndex].tailText;
      const firstLen = byteLengthUtf8(firstText);
      const excess = this.tailBytesUsed - this.tailBudget;
      const hasNewerTail = this.tailOrderHead + 1 < this.tailOrder.length;
      if (firstLen <= excess && hasNewerTail) {
        // Fully drop the oldest segment; newer content remains in the tail.
        this.outputs[firstIndex].tailText = '';
        this.tailOrderHead += 1;
        this.tailBytesUsed -= firstLen;
        this.compactTailOrder();
      } else {
        // Trim leading bytes of the oldest segment down to the budget. This
        // also handles a single oversized segment (keep its last tailBudget
        // bytes) so one huge output cannot exceed the tail bound.
        const buf = Buffer.from(firstText, 'utf8');
        const dropStart =
          excess + completeUtf8SuffixStart(buf.subarray(excess));
        this.outputs[firstIndex].tailText = buf
          .subarray(dropStart)
          .toString('utf8');
        this.tailBytesUsed -= dropStart;
        return;
      }
    }
  }

  private compactTailOrder(): void {
    if (
      this.tailOrderHead < 4096 ||
      this.tailOrderHead * 2 < this.tailOrder.length
    ) {
      return;
    }
    this.tailOrder = this.tailOrder.slice(this.tailOrderHead);
    this.tailOrderHead = 0;
  }
}

/**
 * Assemble the final prompt string from ordered segments, bounding the
 * aggregate command-output bytes (across all output segments) to `budget`.
 *
 * This convenience wrapper feeds pre-assembled segments into a
 * {@link StreamingInjectionBuilder}. Production callers that execute commands
 * incrementally should use the builder directly so that full command outputs
 * are never retained simultaneously.
 */
export function buildBoundedPrompt(
  segments: readonly PromptSegment[],
  budget: ByteBudget = createByteBudget(DEFAULT_INJECTION_OUTPUT_BUDGET_BYTES),
): string {
  const builder = new StreamingInjectionBuilder(budget);
  for (const segment of segments) {
    if (segment.kind === 'literal') {
      builder.appendLiteral(segment.text);
    } else {
      builder.appendOutput(segment.output, segment.statusSuffix);
    }
  }
  return builder.build();
}
