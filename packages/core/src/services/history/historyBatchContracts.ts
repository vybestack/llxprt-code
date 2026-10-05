/**
 * Copyright 2026 Vybestack LLC
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

/**
 * Batch-commit and media-ownership contracts shared by the history service
 * core and the durable media owner.
 */

import type {
  IContent,
  MediaReferenceBlock,
  ChronologyMarker,
} from './IContent.js';

import type { HistoryDensityRows } from './historyDensityRows.js';
import {
  emitHistoryBatchValues,
  type HistoryBatchRows,
} from './history-batch-values.js';
import type { DiskDensityResult } from './historyDiskDensity.js';
import type { DensitySpanRows } from './densitySpanRows.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';

export interface HistoryServiceJournalOptions {
  readonly recording?: SessionRecordingService;
  readonly attachmentCounters?: JournalReadCounters;
  readonly mutationOwnership?: RowOwnership;
}
import type { DensityResult } from '../../core/compression/types.js';
import type {
  RemovedInteriorSpan,
  HistoryServiceEventEmitter,
} from './historyEventTypes.js';

export function publishMutationTokens(
  history: HistoryServiceEventEmitter & { getTotalTokens(): number },
  input: HistoryMutationInput,
  addedTokens: number,
): void {
  if (input.publishedBatch !== undefined) {
    emitHistoryBatchValues(history, input.publishedBatch);
  }
  if (input.publishedRowStart !== undefined) {
    let index = 0;
    for (const row of input.nextHistory) {
      if (index >= input.publishedRowStart) history.emit('contentAdded', row);
      index++;
    }
  }
  history.emit('tokensUpdated', {
    totalTokens: history.getTotalTokens(),
    addedTokens,
    contentId: null,
  });
}

export interface PreparedHistoryBatchEffect {
  publish(): void | Promise<void>;
  rollback(): void | Promise<void>;
  finalize?(): void | Promise<void>;
}

export interface HistoryOwnedMediaReservation {
  readonly contentId: string;
  readonly ownerId: string;
  readonly reference?: MediaReferenceBlock;
}

/**
 * Explicit owner participant that reconciles durable local-media ownership with live
 * history on every mutation that adds, replaces, removes, or clears history.
 * Registered via {@link HistoryService.registerMediaOwner}.
 */
export interface HistoryMediaOwner {
  prepareReferenceReplacement?(
    references:
      | AsyncIterable<MediaReferenceBlock>
      | Iterable<MediaReferenceBlock>,
    ownership?: RowOwnership,
  ): PreparedHistoryBatchEffect | Promise<PreparedHistoryBatchEffect>;
  /** Transactional ownership transition for a queued history mutation. */
  prepareReplacement(input: {
    readonly previous: Iterable<IContent> & { readonly length: number };
    readonly next: Iterable<IContent> & { readonly length: number };
    readonly adopted: readonly HistoryOwnedMediaReservation[];
    readonly ownership?: RowOwnership;
  }): PreparedHistoryBatchEffect | Promise<PreparedHistoryBatchEffect>;

  /** Reconcile ownership from `previous` to current history for synchronous
   * mutations that cannot await (clears, pops, settlement). */
  reconcile(
    previous: Iterable<IContent>,
    getNext: () => Iterable<IContent>,
  ): Promise<void>;

  /** Release every reservation the history still owns (disposal). */
  releaseAll(): Promise<void>;

  /** Adopt reservations for content that becomes resident without a removal diff. */
  adopt(contents: Iterable<IContent>): void;
}

export interface HistoryBatchOptions {
  /** Whole-source replacement uses rewind/content, rather than per-row density deltas. */
  readonly replaceAll?: boolean;
  /** Backpressure between admissions; awaitDurableCommit also waits for the final ack. */
  readonly streamPublication?: boolean;
  readonly awaitDurableCommit?: boolean;
  readonly afterPublication?: () => void | Promise<void>;
  readonly adoptedOwners?: readonly HistoryOwnedMediaReservation[];
}

export interface HistoryMutationInput {
  readonly nextHistory: HistoryDensityRows;
  readonly nextHistoryTokens?: number;
  readonly publishedBatch?: HistoryBatchRows;
  readonly publishedRowStart?: number;
  readonly extraRemovedInterior?: readonly RemovedInteriorSpan[];
  readonly densityResult?: DensityResult;
  readonly diskDensityResult?: DiskDensityResult;
  readonly diskDensitySpans?: DensitySpanRows;
  readonly streamPublication?: boolean;
  readonly signal?: AbortSignal;
  readonly options: HistoryBatchOptions;
}

export function validateHistoryEntry(content: IContent, index: number): void {
  const validSpeaker = ['human', 'ai', 'tool'].includes(content.speaker);
  const validBlocks =
    Array.isArray(content.blocks) && content.blocks.length > 0;
  if (!validSpeaker || !validBlocks) {
    throw new Error(
      `History batch entry ${index} is invalid: ${validSpeaker ? 'content has no blocks' : 'speaker is invalid'}`,
    );
  }
}

export function validateHistoryBatch(contents: readonly IContent[]): void {
  for (const [index, content] of contents.entries())
    validateHistoryEntry(content, index);
}

export type QueuedHistoryMutation =
  | { kind: 'synchronous'; execute: () => void }
  | {
      kind: 'asynchronous';
      execute: () => Promise<void>;
      resolve: () => void;
      reject: (error: unknown) => void;
    };

export interface ChronologyRollbackEntry {
  readonly content: IContent;
  readonly hadMetadata: boolean;
  readonly chronology: ChronologyMarker | undefined;
}
