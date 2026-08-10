/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stream provenance tag for combined stdout/stderr collectors.
 */
export type StreamSource = 'stdout' | 'stderr';

/**
 * Immutable, validated byte budget for output acquisition.
 *
 * This is a nominal brand — only values produced by {@link createByteBudget}
 * are assignable, preventing raw numbers from bypassing validation.
 */
export interface ByteBudget {
  readonly bytes: number;
  readonly __brand: unique symbol;
}

/**
 * Truncation metadata surfaced alongside retained output so callers can
 * produce durable omission notices and report partial results explicitly.
 */
export interface TruncationMetadata {
  /** Total bytes observed across all streams, monotonically increasing. */
  readonly observedBytes: number;
  /** Bytes retained in the head+tail window. */
  readonly retainedBytes: number;
  /** Bytes discarded between head and tail. */
  readonly omittedBytes: number;
  /**
   * Whether omittedBytes is the complete loss count. False means acquisition
   * stopped before all producer output could be observed, so additional loss
   * is known to exist but cannot be quantified.
   */
  readonly omittedBytesExact?: boolean;
  /** Whether any truncation occurred. */
  readonly truncated: boolean;
  /** The configured budget that was enforced. */
  readonly budgetBytes: number;
}

/**
 * Result of bounded output acquisition.
 */
export interface AcquisitionResult {
  /** Decoded text: head content + omission notice + tail content. */
  readonly text: string;
  /** Head text only (decoded, without notice or tail). */
  readonly headText: string;
  /** Tail text only (decoded). */
  readonly tailText: string;
  /** Accounting and truncation metadata. */
  readonly metadata: TruncationMetadata;
  /** Pre-formatted notice string, or null if no truncation. */
  readonly omissionNotice: string | null;
}

/**
 * Result for a combined stream (stdout + stderr with provenance).
 */
export interface CombinedAcquisitionResult extends AcquisitionResult {
  /** stdout-only decoded text. */
  readonly stdoutText: string;
  /** stderr-only decoded text. */
  readonly stderrText: string;
}
