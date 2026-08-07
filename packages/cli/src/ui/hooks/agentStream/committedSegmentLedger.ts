/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-stream ledger of static history item ids committed for the assistant
 * message currently being streamed.
 *
 * The content event processor commits stable prefixes of an in-flight assistant
 * message to the CLI's static history list (issue #2852) as soon as a
 * markdown-safe paragraph break arrives. Issue #3048's discard-and-restart
 * needs to retract exactly those ids when the attempt is abandoned, without
 * touching earlier completed messages.
 *
 * The ledger starts tracking at the boundary of a NEW assistant message
 * ({@link begin}) so ids from a previous, completed message are never retracted
 * by a later turn's retry. A discard drains the ledger (take + clear) so a
 * second retry cannot attempt to re-remove already-retracted ids.
 *
 * Owned per stream — same lifetime as {@link PendingResponseBuffer}.
 *
 * @plan PLAN-20260806-ISSUE3048.P10
 * @requirement REQ-3048-009
 */
export class CommittedSegmentLedger {
  private recorded: number[] = [];

  /**
   * Marks the start of a new assistant message. Drops any ids recorded for a
   * previous message so a subsequent retry retracts only the current message's
   * committed prefixes.
   */
  begin(): void {
    this.recorded = [];
  }

  /**
   * Records a static history item id committed for the current message.
   */
  record(id: number): void {
    this.recorded.push(id);
  }

  /**
   * Returns the ids recorded for the current message and clears them. Used by
   * the discard handler so the retracted ids are consumed exactly once.
   */
  drain(): readonly number[] {
    const taken = [...this.recorded];
    this.recorded = [];
    return taken;
  }

  /**
   * Ends the ledger for an assistant message that completed normally. Its
   * committed prefixes are now permanent, so the ids are cleared without being
   * retracted. Bounds the ledger to a single message lifecycle (issue #3048
   * review finding).
   */
  end(): void {
    this.recorded = [];
  }

  /**
   * Read-only view of the ids recorded so far.
   */
  get ids(): readonly number[] {
    return [...this.recorded];
  }
}
