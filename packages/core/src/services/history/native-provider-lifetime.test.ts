/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';

describe('native normalized request lifetime', () => {
  it('releases the canceled reader without invalidating another reader or pin', async () => {
    const history = new HistoryService({});
    history.setTokenizerFactory(exactTokenizer());
    const ownership = new RowOwnership();
    try {
      await history.replaceAll(
        Array.from(
          { length: 65 },
          (_, index): IContent => ({
            speaker: 'human',
            blocks: [{ type: 'text', text: `row ${index}` }],
          }),
        ),
      );
      const snapshot = await history.prepareCuratedForProviderSnapshot([], {
        ownership,
      });
      const controller = new AbortController();
      const left = snapshot.openReader(controller.signal);
      const right = snapshot.openReader();
      try {
        await left.next();
        await right.next();
        expect(ownership.snapshot().liveRows).toBe(2);
        const reason = new Error('reader abort identity');
        controller.abort(reason);
        await expect(left.next()).rejects.toBe(reason);
        expect(ownership.snapshot().liveRows).toBe(1);
        expect((await right.next()).done).toBe(false);
        await history.dispose();
        expect((await snapshot.readAt(64)).blocks).toStrictEqual([
          { type: 'text', text: 'row 64' },
        ]);
      } finally {
        await snapshot.close();
      }
      expect(ownership.snapshot().liveRows).toBe(0);
      await expect(right.next()).rejects.toThrow('snapshot is closed');
    } finally {
      await history.dispose();
    }
  });
});
