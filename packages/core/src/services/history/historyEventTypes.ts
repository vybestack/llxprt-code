/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { IContent } from './IContent.js';
import type { TokensUpdatedEvent } from './HistoryEvents.js';

/**
 * Why an interior span of chronology seqs left the curated context while the
 * surrounding entries stayed.
 *
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 */
export type RemovedInteriorReason =
  | 'compressed'
  | 'density-replaced'
  | 'density-removed'
  | 'rewound'
  | 'cleared';

/**
 * An inclusive span of chronology seqs removed from the interior of the
 * curated context. Spans are produced sorted by start and strictly disjoint;
 * adjacent same-reason spans are coalesced, different-reason spans stay
 * separate.
 *
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 */
export interface RemovedInteriorSpan {
  /** Lowest chronology seq of the removed span (inclusive). */
  start: number;
  /** Highest chronology seq of the removed span (inclusive). */
  end: number;
  /** Which mutation removed the span. */
  reason: RemovedInteriorReason;
}

/**
 * Snapshot of the curated in-memory context boundary: the chronology seqs of
 * the first and last entries of the exact history array the model sees, plus
 * the membership projection of everything removed from its interior.
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-004
 */
export interface ContextRange {
  /** Chronology seq of the first entry of the curated history. */
  firstSeq: number;
  /** Chronology seq of the last entry of the curated history. */
  lastSeq: number;
  /** Number of entries in the curated history. */
  totalEntries: number;
  /**
   * Inclusive spans of chronology seqs removed from the context interior,
   * cumulative across mutations: spans derived by earlier mutations persist
   * in later snapshots (compressed spans are re-derived from summary
   * metadata; density/rewound/cleared spans accumulate in the service).
   *
   * @plan PLAN-20260917-ISSUE854.P03
   */
  removedInterior: RemovedInteriorSpan[];
  /**
   * True when membership cannot be stated exactly because some entries lack
   * chronology markers (unmarked legacy history); `removedInterior` is then
   * empty.
   *
   * @plan PLAN-20260917-ISSUE854.P03
   */
  approximate: boolean;
}

/**
 * One compression summary projection: the summary entry's own chronology seq
 * plus the span of destroyed entries it replaced.
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-004
 */
export interface ContextSummaryInfo {
  /** The summary entry's own chronology seq. */
  seq: number;
  /** First destroyed entry's chronology seq (from chronologyReplaced). */
  replacedFromSeq: number;
  /** Last destroyed entry's chronology seq (from chronologyReplaced). */
  replacedToSeq: number;
  /** Number of entries the summary replaced. */
  itemCount: number;
  /** Summary text (joined text blocks). */
  text: string;
}

/**
 * Typed EventEmitter interface for HistoryService events.
 */
export interface HistoryServiceEventEmitter {
  on(
    event: 'tokensUpdated',
    listener: (eventData: TokensUpdatedEvent) => void,
  ): this;
  on(event: 'contentAdded', listener: (content: IContent) => void): this;
  on(
    event: 'contextRangeChanged',
    listener: (range: ContextRange) => void,
  ): this;
  on(
    event: 'contentBatchAdded',
    listener: (contents: readonly IContent[]) => void,
  ): this;
  on(event: 'compressionStarted', listener: () => void): this;
  on(event: 'compressionLockReleased', listener: () => void): this;
  on(
    event: 'compressionEnded',
    listener: (summary: IContent, itemsCompressed: number) => void,
  ): this;
  emit(event: 'tokensUpdated', eventData: TokensUpdatedEvent): boolean;
  emit(event: 'contentAdded', content: IContent): boolean;
  emit(event: 'contextRangeChanged', range: ContextRange): boolean;
  emit(event: 'contentBatchAdded', contents: readonly IContent[]): boolean;
  emit(event: 'compressionStarted'): boolean;
  emit(event: 'compressionLockReleased'): boolean;
  emit(
    event: 'compressionEnded',
    summary: IContent,
    itemsCompressed: number,
  ): boolean;
  off(
    event: 'tokensUpdated',
    listener: (eventData: TokensUpdatedEvent) => void,
  ): this;
  off(event: 'contentAdded', listener: (content: IContent) => void): this;
  off(
    event: 'contextRangeChanged',
    listener: (range: ContextRange) => void,
  ): this;
  off(
    event: 'contentBatchAdded',
    listener: (contents: readonly IContent[]) => void,
  ): this;
  off(event: 'compressionStarted', listener: () => void): this;
  off(event: 'compressionLockReleased', listener: () => void): this;
  off(
    event: 'compressionEnded',
    listener: (summary: IContent, itemsCompressed: number) => void,
  ): this;
}

/**
 * Configuration for compression behavior
 */
export interface CompressionConfig {
  orphanTimeoutMs: number; // Time before considering a call orphaned
  orphanMessageDistance: number; // Messages before considering orphaned
  pendingGracePeriodMs: number; // Grace period for pending calls
  minMessagesForCompression: number; // Minimum messages before compression
}
