/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import { isMediaReferenceBlock, type IContent } from './IContent.js';

export async function publishArrivalMedia(
  owner: HistoryMediaOwner | undefined,
  content: IContent,
  observe: () => void,
): Promise<void> {
  const effect = await owner?.prepareReferenceAddition?.(
    content.blocks.filter(isMediaReferenceBlock),
  );
  try {
    await effect?.publish();
    observe();
    await effect?.finalize?.();
    owner?.adopt([content]);
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
