/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import type { IContent } from './IContent.js';
import { decodeStoredRow } from './journalRowCodec.js';

export async function waitForDetachedCapture(
  operation: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (signal === undefined) {
    await operation();
    return;
  }
  let abort = (): void => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    await Promise.race([operation(), cancelled]);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** The rows of `snapshot` in order, one decoded row at a time from the file. */
export async function* snapshotRows(
  snapshot: VersionSnapshot,
  signal?: AbortSignal,
  resumeBoundary?: bigint,
): AsyncGenerator<IContent, void, unknown> {
  for await (const entry of snapshot.entries()) {
    signal?.throwIfAborted();
    yield sanitizeProviderContentForSerialization(
      decodeStoredRow(await snapshot.readRow(entry), resumeBoundary),
    );
  }
}
