/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import {
  NoArrayHistory,
  replayClient,
  replayOracle,
} from './zed-history-stream-test-helpers.js';
import { readAgentHistoryForReplay } from './zed-session-loader.js';
import { deliverHistoryUpdates } from './zed-session-replay.js';
import { SessionTitleTracker } from './zed-session-info.js';

for (const size of [512, 8192]) {
  describe(`live ACP replay with ${size} mixed rows`, () => {
    it('delivers identical update bytes without materializing raw history', async () => {
      const expected = replayOracle(size);
      await withSuffixFixture(
        size,
        async (history, reader, counters) => {
          const client = replayClient(history);
          const actual = createHash('sha256');
          let first = true;
          let pausedDecodeCount = 0;
          actual.update('[');
          try {
            await deliverHistoryUpdates(
              readAgentHistoryForReplay(client, 'replay-cursor'),
              new SessionTitleTracker(),
              'replay-cursor',
              async (update) => {
                if (first) {
                  history.clear();
                  await delay(10);
                  pausedDecodeCount = counters.snapshot().rowsDecoded;
                } else actual.update(',');
                first = false;
                actual.update(JSON.stringify(update));
              },
            );
            actual.update(']');
            expect(actual.digest('hex')).toBe(expected);
            expect(pausedDecodeCount).toBe(1);
            expect(
              reader.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
            ).toBe(true);
            expect(reader.snapshot().liveRows).toBe(0);
          } finally {
            await client.dispose();
          }
        },
        2048,
        accountingRow,
        undefined,
        (options) => new NoArrayHistory(options),
      );
    }, 120_000);
  });

  describe(`live ACP failed delivery with ${size} mixed rows`, () => {
    it('pins the original replay across clear and stops reading at a failed delivery', async () => {
      await withSuffixFixture(
        size,
        async (history, reader, counters) => {
          const client = replayClient(history);
          let delivered = 0;
          let pausedDecodeCount = 0;
          try {
            await expect(
              deliverHistoryUpdates(
                readAgentHistoryForReplay(client, 'replay-cursor'),
                new SessionTitleTracker(),
                'replay-cursor',
                async () => {
                  if (delivered++ === 0) {
                    history.clear();
                    await delay(10);
                    pausedDecodeCount = counters.snapshot().rowsDecoded;
                  }
                  if (delivered === 3) throw new Error('delivery failed');
                },
              ),
            ).rejects.toMatchObject({
              code: -32603,
              data: {
                sessionId: 'replay-cursor',
                reason: 'delivery failed',
                phase: 'replay',
              },
            });
            expect(reader.snapshot().liveRows).toBe(0);
            expect(counters.snapshot().rowsDecoded).toBeLessThan(size);
            expect(pausedDecodeCount).toBe(1);
          } finally {
            await client.dispose();
          }
        },
        2048,
        accountingRow,
        undefined,
        (options) => new NoArrayHistory(options),
      );
    }, 120_000);
  });
}
