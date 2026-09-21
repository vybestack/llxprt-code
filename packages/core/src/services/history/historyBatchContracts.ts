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
 * core, its participants, and the durable media owner. Extracted from
 * HistoryServiceCore so the service file stays within its size budget while
 * the public surface (re-exported through HistoryServiceCore/HistoryService)
 * is unchanged.
 */

import type {
  IContent,
  MediaReferenceBlock,
  ChronologyMarker,
} from './IContent.js';

export interface PreparedHistoryBatchEffect {
  publish(): void | Promise<void>;
  rollback(): void | Promise<void>;
  finalize?(): void | Promise<void>;
}

export type HistoryBatchParticipant = (
  publication: HistoryBatchPublication,
) => PreparedHistoryBatchEffect | Promise<PreparedHistoryBatchEffect>;

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
  /** Transactional ownership transition for a queued history mutation. */
  prepareReplacement(input: {
    readonly previous: readonly IContent[];
    readonly next: readonly IContent[];
    readonly adopted: readonly HistoryOwnedMediaReservation[];
  }): PreparedHistoryBatchEffect | Promise<PreparedHistoryBatchEffect>;

  /** Reconcile ownership from `previous` to current history for synchronous
   * mutations that cannot await (clears, pops, settlement). */
  reconcile(
    previous: readonly IContent[],
    getNext: () => readonly IContent[],
  ): Promise<void>;

  /** Release every reservation the history still owns (disposal). */
  releaseAll(): Promise<void>;

  /** Adopt reservations for content that becomes resident without a removal diff. */
  adopt(contents: readonly IContent[]): void;
}

export interface HistoryBatchPublication {
  readonly contents: readonly IContent[];
  readonly nextHistory: readonly IContent[];
  readonly addedTokens: number;
  readonly totalTokens: number;
}

export interface HistoryBatchOptions {
  readonly afterPublication?: () => void | Promise<void>;
  readonly adoptedOwners?: readonly HistoryOwnedMediaReservation[];
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
