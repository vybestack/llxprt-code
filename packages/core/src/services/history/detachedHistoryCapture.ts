/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryStorePort } from './historyStorePort.js';
import { setImmediate } from 'node:timers/promises';
import {
  foldPendingRows,
  type PendingRowFold,
} from '../../recording/pendingRowFold.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import { HistoryRowOrigins } from './historyRowOrigins.js';

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
  previous.settle();
  signal?.throwIfAborted();
}

export async function captureDetachedHistory(
  journal: HistoryStorePort,
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
      // The fold names each row's origin itself, so they are read from the
      // rows it already holds. A cursor over the journal would fold every
      // byte of it again for each mutation.
      previous.adoptOrigins(HistoryRowOrigins.capture(source));
      await copyRows(source, previous, signal);
    } finally {
      await source.close();
    }
    if (previous.origins.length !== previous.length)
      throw new Error('History changed while its rows were captured');
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
