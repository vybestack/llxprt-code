/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';

describe('compression media journal lifecycle', () => {
  it('settles deferred media releases before closing the history journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'compression-media-disposal-'));
    const store = new LocalMediaStore({
      rootDirectory: root,
      quotaBytes: 1024,
    });
    const history = new HistoryService();
    try {
      const reference = await store.admit({
        bytes: new Uint8Array([1]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      });
      await history.registerMediaOwner(new HistoryMediaOwnership(store));
      await history.detachedValues.replace([
        { speaker: 'human', blocks: [reference] },
      ]);
      const snapshot = await history.openDumpSnapshot();
      await history.clear();
      expect(await store.hasReservations(reference.contentId)).toBe(true);

      await history.dispose();
      await history.waitForOwnershipSettlement();

      expect(await store.hasReservations(reference.contentId)).toBe(false);
      await snapshot.close();
    } finally {
      await history.dispose();
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
