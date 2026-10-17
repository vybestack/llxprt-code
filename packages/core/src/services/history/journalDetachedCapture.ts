/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import type { IContent } from './IContent.js';
import { decodeStoredRow } from './journalRowCodec.js';

/** The rows of `snapshot` in order, one decoded row at a time from the file. */
export async function* snapshotRows(
  snapshot: VersionSnapshot,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  for await (const entry of snapshot.entries()) {
    signal?.throwIfAborted();
    yield sanitizeProviderContentForSerialization(
      decodeStoredRow(await snapshot.readRow(entry)),
    );
  }
}
