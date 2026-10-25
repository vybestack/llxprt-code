/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { HistoryService } from './HistoryService.js';

describe('history-owned runtime media registration', () => {
  it('shares concurrent registration within one history and rejects a different store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-media-owner-'));
    const store = new LocalMediaStore({
      rootDirectory: join(root, 'first'),
      quotaBytes: 1024 * 1024,
    });
    const otherStore = new LocalMediaStore({
      rootDirectory: join(root, 'other'),
      quotaBytes: 1024 * 1024,
    });
    const history = new HistoryService();
    const sibling = new HistoryService();
    try {
      const [first, repeated] = await Promise.all([
        history.registerRuntimeMediaOwner(store),
        history.registerRuntimeMediaOwner(store),
      ]);
      expect(repeated).toBe(first);
      expect(await sibling.registerRuntimeMediaOwner(store)).not.toBe(first);
      await expect(
        history.registerRuntimeMediaOwner(otherStore),
      ).rejects.toThrow('A runtime history cannot use different media stores');
      expect(await history.registerRuntimeMediaOwner(store)).toBe(first);
    } finally {
      await Promise.all([history.dispose(), sibling.dispose()]);
      await Promise.all([store.close(), otherStore.close()]);
      await rm(root, { recursive: true, force: true });
    }
  });
});
