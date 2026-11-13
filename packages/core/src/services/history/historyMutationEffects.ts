/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HistoryBatchParticipant,
  HistoryBatchPublication,
  HistoryEffectFactory,
  HistoryMediaOwner,
  HistoryOwnedMediaReservation,
  PreparedHistoryBatchEffect,
} from './HistoryServiceCore.js';
import type { IContent } from './IContent.js';

export interface MutationEffectInput {
  readonly mediaOwner: HistoryMediaOwner | undefined;
  readonly participants: ReadonlySet<HistoryBatchParticipant>;
  readonly publication: HistoryBatchPublication | undefined;
  readonly previousHistory: readonly IContent[];
  readonly nextHistory: readonly IContent[];
  readonly adopted: readonly HistoryOwnedMediaReservation[];
  readonly prepareEffect: HistoryEffectFactory | undefined;
  readonly signal: AbortSignal | undefined;
}

/**
 * Prepares the media-ownership, batch-participant and caller-owned effects of
 * one history commit, in that order, appending each to `effects`. A prepared
 * effect is recorded before the signal is checked so that an abort rolls it
 * back instead of leaking what its preparation reserved.
 */
export async function prepareMutationEffects(
  effects: PreparedHistoryBatchEffect[],
  input: MutationEffectInput,
): Promise<void> {
  const { mediaOwner, publication, signal } = input;
  if (mediaOwner !== undefined) {
    effects.push(
      await mediaOwner.prepareReplacement({
        previous: input.previousHistory,
        next: input.nextHistory,
        adopted: input.adopted,
      }),
    );
    signal?.throwIfAborted();
  }
  if (publication !== undefined) {
    for (const participant of input.participants) {
      effects.push(await participant(publication));
      signal?.throwIfAborted();
    }
  }
  const requested = await input.prepareEffect?.(input.nextHistory);
  if (requested !== undefined) effects.push(requested);
  signal?.throwIfAborted();
}
