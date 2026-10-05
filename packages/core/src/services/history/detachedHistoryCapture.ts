/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { setImmediate } from 'node:timers/promises';
import {
  foldPendingRows,
  type PendingRowFold,
} from '../../recording/pendingRowFold.js';
import type { HistoryJournalStore } from './historyJournalStore.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';

async function waitForCaptureAcknowledgement(
  operation: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (signal === undefined) {
    await operation();
    return;
  }
  let abort = (): void => {};
  const cancelled = new Promise<void>((_resolve, reject) => {
    abort = (): void => {
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    await Promise.race([operation(), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function copyRows(
  source: PendingRowFold,
  previous: DetachedHistoryJournal,
  signal?: AbortSignal,
): Promise<void> {
  for (let index = 0; index < source.length; index++) {
    signal?.throwIfAborted();
    previous.append(
      sanitizeProviderContentForSerialization(await source.readRow(index)),
    );
    if (index % 128 === 0) await setImmediate();
  }
  signal?.throwIfAborted();
}

export async function captureDetachedHistory(
  journal: HistoryJournalStore,
  previous: DetachedHistoryJournal,
  _ownership?: RowOwnership,
  signal?: AbortSignal,
  settleTokens?: () => Promise<void>,
): Promise<void> {
  signal?.throwIfAborted();
  let captured: PendingFoldSnapshot | undefined = journal.capturePendingFold();
  let releaseOwners = (): void => {};
  let folding = false;
  try {
    folding = true;
    const source = await foldPendingRows(captured);
    try {
      await copyRows(source, previous, signal);
    } finally {
      await source.close();
    }
    journal.adoptMutationBoundary(captured.durableTail);
    if (settleTokens !== undefined)
      await waitForCaptureAcknowledgement(settleTokens, signal);
    await waitForCaptureAcknowledgement(() => journal.waitForDurable(), signal);
    signal?.throwIfAborted();
  } finally {
    try {
      releaseOwners();
      if (!folding) captured.release();
    } finally {
      captured = undefined;
      releaseOwners = (): void => {};
    }
  }
}
