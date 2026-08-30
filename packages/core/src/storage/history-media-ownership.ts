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

interface TrackedMediaReservation {
  readonly contentId: string;
  readonly ownerId: string;
  readonly reference: MediaReferenceBlock;
}

function reservationsOf(
  contents: readonly IContent[],
): readonly TrackedMediaReservation[] {
  return collectMediaReferences(contents).map((reference) => ({
    contentId: reference.contentId,
    ownerId: historyOwnerIdFor(reference.contentId),
    reference,
  }));
}

function reservationMap(
  contents: readonly IContent[],
): ReadonlyMap<string, TrackedMediaReservation> {
  return new Map(
    reservationsOf(contents).map((reservation) => [
      reservation.contentId,
      reservation,
    ]),
  );
}

function throwOwnershipFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'History media ownership failed');
  }
}

export class HistoryMediaOwnership implements HistoryMediaOwner {
  private readonly owned = new Map<string, MediaReferenceBlock>();
  private readonly reserved = new Set<string>();
  private readonly released = new Set<string>();

  constructor(private readonly store: LocalMediaStore) {}

  prepareReplacement(input: {
    readonly previous: readonly IContent[];
    readonly next: readonly IContent[];
    readonly adopted: readonly HistoryOwnedMediaReservation[];
  }): PreparedHistoryBatchEffect {
    const previousIds = new Set(
      reservationsOf(input.previous).map(({ contentId }) => contentId),
    );
    let publicationAttempted = false;
    return {
      publish: async () => {
        publicationAttempted = true;
        await this.transition(input.next);
      },
      rollback: () =>
        publicationAttempted
          ? this.transition(input.previous)
          : this.releaseUnpublishedAdoptions(input.adopted, previousIds),
    };
  }

  reconcile(
    _previous: readonly IContent[],
    getNext: () => readonly IContent[],
  ): Promise<void> {
    return this.transition(getNext());
  }

  releaseAll(): Promise<void> {
    return this.transition([], true);
  }

  adopt(contents: readonly IContent[]): void {
    for (const reservation of reservationsOf(contents)) {
      this.track(reservation);
    }
  }

  private track(reservation: TrackedMediaReservation): void {
    this.released.delete(reservation.contentId);
    this.owned.set(reservation.contentId, reservation.reference);
  }

  private async releaseUnpublishedAdoptions(
    adopted: readonly HistoryOwnedMediaReservation[],
    previousIds: ReadonlySet<string>,
  ): Promise<void> {
    const failures: unknown[] = [];
    const released = new Set<string>();
    for (const reservation of adopted) {
      if (
        previousIds.has(reservation.contentId) ||
        released.has(reservation.contentId)
      ) {
        continue;
      }
      released.add(reservation.contentId);
      try {
        await this.store.release(reservation.contentId, reservation.ownerId);
        this.released.add(reservation.contentId);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    throwOwnershipFailures(failures);
  }

  private async transition(
    next: readonly IContent[],
    releaseEverything = false,
  ): Promise<void> {
    const target = reservationMap(next);
    const failures: unknown[] = [];

    for (const [contentId] of [...this.owned]) {
      if (!releaseEverything && target.has(contentId)) continue;
      try {
        await this.store.release(contentId, historyOwnerIdFor(contentId));
        this.owned.delete(contentId);
        this.reserved.delete(contentId);
        this.released.add(contentId);
      } catch (error: unknown) {
        failures.push(error);
      }
    }

    if (!releaseEverything) {
      for (const reservation of target.values()) {
        const failure = await this.adoptTarget(reservation);
        if (failure !== undefined) failures.push(failure);
      }
    }

    throwOwnershipFailures(failures);
  }

  private async adoptTarget(
    reservation: TrackedMediaReservation,
  ): Promise<unknown | undefined> {
    if (this.reserved.has(reservation.contentId)) {
      this.owned.set(reservation.contentId, reservation.reference);
      return undefined;
    }
    try {
      await this.store.reserve(reservation.reference, reservation.ownerId);
    } catch (error: unknown) {
      return error;
    }
    this.reserved.add(reservation.contentId);
    this.released.delete(reservation.contentId);
    this.track(reservation);
    return undefined;
  }
}
