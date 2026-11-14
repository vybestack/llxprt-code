/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createScrollbackPagerStore } from './scrollbackPager.js';

describe('scrollback journal opening failures', () => {
  it('reports the original journal opening failure to the resume caller', async () => {
    const failure = new Error('controlled journal opening failure');
    const store = createScrollbackPagerStore({
      filePath: '/unopened.llxj',
      viewport: { visibleKeys: [], viewportLines: 1, rowHeightLines: () => 1 },
      pageRows: 16,
      settings: { marginViewports: 0, byteFloorBytes: 0, purgeDebounceMs: 0 },
      journal: {
        open: async () => {
          throw failure;
        },
      },
    });
    try {
      await expect(store.resumeFromJournal()).rejects.toBe(failure);
      expect(store.getState().error).toBe(failure.message);
    } finally {
      await store.close();
    }
  });
});
