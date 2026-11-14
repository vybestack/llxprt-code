/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { MediaReferenceBlock } from './IContent.js';

export async function publishArrivalMedia(
  owner: HistoryMediaOwner | undefined,
  references: AsyncIterable<MediaReferenceBlock>,
  observe: () => void,
): Promise<void> {
  if (owner !== undefined && owner.prepareReferenceAddition === undefined)
    throw new Error('History media owner does not support journal addition');
  const effect = await owner?.prepareReferenceAddition?.(references);
  try {
    await effect?.publish();
    observe();
    await effect?.finalize?.();
  } catch (error) {
    try {
      await effect?.rollback();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Arrival media rollback failed',
      );
    }
    throw error;
  }
}
