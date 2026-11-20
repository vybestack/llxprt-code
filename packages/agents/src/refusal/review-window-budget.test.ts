/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ScratchRootOwner } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { openReviewWindow, ReviewWindowTooLarge } from './reviewWindow.js';

describe('bounded refusal review suffix', () => {
  it('rejects an oversized suffix before reading the whole journal', async () => {
    class CountingHistory extends HistoryService {
      reads = 0;
      override async openDumpSnapshot() {
        const snapshot = await super.openDumpSnapshot();
        const rows = snapshot.callerOwnedRows;
        if (rows === undefined) throw new Error('Missing indexed rows');
        return {
          rows: () => snapshot.rows(),
          chronology: () => snapshot.chronology(),
          close: () => snapshot.close(),
          callerOwnedRows: {
            count: rows.count,
            openReader: (signal?: AbortSignal) => rows.openReader(signal),
            readAt: async (ordinal: number) => {
              this.reads++;
              return rows.readAt(ordinal);
            },
          },
        };
      }
    }
    const roots = new ScratchRootOwner();
    const history = new CountingHistory({ scratchRoots: roots });
    try {
      await history.detachedValues.append(
        (async function* () {
          for (let index = 0; index < 1000; index++)
            yield {
              speaker: 'human',
              blocks: [
                {
                  type: 'text',
                  text: `goal ${index} ${'context '.repeat(100)}`,
                },
              ],
            };
        })(),
      );
      await expect(openReviewWindow(history, [], 2000)).rejects.toBeInstanceOf(
        ReviewWindowTooLarge,
      );
      expect(history.reads).toBeLessThan(100);
    } finally {
      await history.dispose();
    }
  });
});
