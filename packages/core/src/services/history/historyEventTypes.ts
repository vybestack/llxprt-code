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
 * Snapshot of the curated in-memory context boundary: the chronology seqs of
 * the first and last entries of the exact history array the model sees.
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
