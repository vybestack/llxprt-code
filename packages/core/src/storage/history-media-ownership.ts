/**
 * @license
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

import type {
  HistoryMediaOwner,
  HistoryOwnedMediaReservation,
  PreparedHistoryBatchEffect,
} from '../services/history/HistoryService.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { collectMediaReferences } from './media-reference-lifecycle.js';
import { historyOwnerIdFor } from './media-admission-service.js';
import type { LocalMediaStore } from './local-media-store.js';
import { HistoryMediaIndex } from './history-media-index.js';
import type { RowOwnership } from '../recording/rowOwnership.js';

interface TrackedMediaReservation {
  readonly contentId: string;
  readonly ownerId: string;
  readonly reference: MediaReferenceBlock;
}

function* reservationsOf(
  contents: Iterable<IContent>,
): Iterable<TrackedMediaReservation> {
  for (const content of contents) {
    for (const reference of collectMediaReferences([content]))
      yield {
        contentId: reference.contentId,
        ownerId: historyOwnerIdFor(reference.contentId),
        reference,
      };
  }
}

function throwOwnershipFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'History media ownership failed');
  }
}

export class HistoryMediaOwnership implements HistoryMediaOwner {
  private owned = new HistoryMediaIndex();
  private readonly reserved = new HistoryMediaIndex();
  private pending: HistoryMediaIndex | undefined;
  private retired: HistoryMediaIndex | undefined;
  private ownership: RowOwnership | undefined;

  constructor(private readonly store: LocalMediaStore) {}

  prepareReplacement(input: {
    readonly previous: Iterable<IContent> & { readonly length: number };
    readonly next: Iterable<IContent> & { readonly length: number };
    readonly adopted: readonly HistoryOwnedMediaReservation[];
    readonly ownership?: RowOwnership;
  }): PreparedHistoryBatchEffect {
    const ownership = input.ownership;
    const next = this.captureTarget(input.next, ownership);
    const previous = input.previous;
    const adopted = input.adopted;
    let publicationAttempted = false;
    return {
      publish: async () => {
        publicationAttempted = true;
        await this.transitionTarget(next, false, ownership);
      },
      rollback: async () => {
        try {
          if (publicationAttempted)
            await this.transition(previous, false, ownership);
          else await this.releaseUnpublishedAdoptions(adopted, previous);
        } finally {
          next.close();
        }
      },
      finalize: () => next.close(),
    };
  }

  prepareReferenceReplacement(
    references:
      | AsyncIterable<MediaReferenceBlock>
      | Iterable<MediaReferenceBlock>,
    ownership?: RowOwnership,
  ): PreparedHistoryBatchEffect {
    if (this.pending || this.retired)
      throw new Error('Unsettled media replacement');
    this.ownership = ownership;
    const previous = this.owned;
    const next = new HistoryMediaIndex();
    this.pending = next;
    return {
      publish: async () => {
        for await (const reference of references) {
          ownership?.retain(reference);
          try {
            next.set(reference);
            await this.store.reserve(
              reference,
              historyOwnerIdFor(reference.contentId),
            );
          } finally {
            ownership?.release(reference);
          }
        }
      },
      rollback: async () => {
        await this.releaseDifference(next, previous, ownership);
        next.close();
        this.pending = undefined;
      },
      finalize: async () => {
        this.owned = next;
        this.pending = undefined;
        this.retired = previous;
        this.reserved.close();
        await this.releaseDifference(previous, next, ownership);
        previous.close();
        this.retired = undefined;
      },
    };
  }

  private async releaseDifference(
    from: HistoryMediaIndex,
    keep: HistoryMediaIndex,
    ownership?: RowOwnership,
  ): Promise<void> {
    for (const reference of from.values(ownership ?? this.ownership)) {
      if (!keep.has(reference.contentId))
        await this.store.release(
          reference.contentId,
          historyOwnerIdFor(reference.contentId),
        );
    }
  }

  reconcile(
    _previous: Iterable<IContent>,
    getNext: () => Iterable<IContent>,
  ): Promise<void> {
    return this.transition(getNext());
  }

  async releaseAll(): Promise<void> {
    const empty = new HistoryMediaIndex();
    for (const index of [this.pending, this.retired]) {
      if (index === undefined) continue;
      await this.releaseDifference(index, empty);
      index.close();
    }
    this.pending = undefined;
    this.retired = undefined;
    await this.transition([], true);
  }

  adopt(contents: Iterable<IContent>): void {
    for (const reservation of reservationsOf(contents)) {
      this.track(reservation);
    }
  }

  private track(reservation: TrackedMediaReservation): void {
    this.owned.set(reservation.reference);
  }

  private async releaseUnpublishedAdoptions(
    adopted: readonly HistoryOwnedMediaReservation[],
    previous: Iterable<IContent>,
  ): Promise<void> {
    const failures: unknown[] = [];
    const previousIds = new HistoryMediaIndex();
    for (const { reference } of reservationsOf(previous))
      previousIds.set(reference);
    for (const reservation of adopted) {
      if (previousIds.has(reservation.contentId)) continue;
      try {
        await this.store.release(reservation.contentId, reservation.ownerId);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    previousIds.close();
    throwOwnershipFailures(failures);
  }

  private captureTarget(
    next: Iterable<IContent>,
    ownership?: RowOwnership,
  ): HistoryMediaIndex {
    const target = new HistoryMediaIndex();
    try {
      for (const { reference } of reservationsOf(next)) {
        ownership?.retain(reference);
        try {
          target.set(reference);
        } finally {
          ownership?.release(reference);
        }
      }
      return target;
    } catch (error) {
      target.close();
      throw error;
    }
  }

  private async transition(
    next: Iterable<IContent>,
    releaseEverything = false,
    ownership = this.ownership,
  ): Promise<void> {
    const target = this.captureTarget(next, ownership);
    try {
      await this.transitionTarget(target, releaseEverything, ownership);
    } finally {
      target.close();
    }
  }

  private async transitionTarget(
    target: HistoryMediaIndex,
    releaseEverything = false,
    ownership = this.ownership,
  ): Promise<void> {
    const failures: unknown[] = [];

    for (const { contentId } of this.owned.values(ownership)) {
      if (!releaseEverything && target.has(contentId)) continue;
      try {
        await this.store.release(contentId, historyOwnerIdFor(contentId));
        this.owned.delete(contentId);
        this.reserved.delete(contentId);
      } catch (error: unknown) {
        failures.push(error);
      }
    }

    if (!releaseEverything) {
      for (const reference of target.values(ownership)) {
        const failure = await this.adoptTarget({
          reference,
          contentId: reference.contentId,
          ownerId: historyOwnerIdFor(reference.contentId),
        });
        if (failure !== undefined) failures.push(failure);
      }
    }

    if (releaseEverything && failures.length === 0) {
      this.owned.close();
      this.reserved.close();
    }
    throwOwnershipFailures(failures);
  }

  private async adoptTarget(
    reservation: TrackedMediaReservation,
  ): Promise<unknown | undefined> {
    if (this.reserved.has(reservation.contentId)) {
      this.owned.set(reservation.reference);
      return undefined;
    }
    try {
      await this.store.reserve(reservation.reference, reservation.ownerId);
    } catch (error: unknown) {
      return error;
    }
    this.reserved.set(reservation.reference);
    this.track(reservation);
    return undefined;
  }
}
