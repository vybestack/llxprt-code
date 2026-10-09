/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { readAgentHistoryForReplay } from './zed-session-loader.js';
import {
  NoArrayHistory,
  replayClient,
} from './zed-history-stream-test-helpers.js';

class FaultHistory extends NoArrayHistory {
  override async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of super.streamRawHistory(signal)) {
      yield row;
      throw new Error('replay source failed');
    }
  }
}

for (const size of [512, 8192]) {
  describe(`ACP raw replay cleanup with ${size} rows`, () => {
    it('classifies a producer failure without retaining the pinned reader', async () => {
      await withSuffixFixture(
        size,
        async (history, reader, counters) => {
          const client = replayClient(history);
          try {
            const cursor = readAgentHistoryForReplay(client, 'replay-cursor');
            await cursor.next();
            await expect(cursor.next()).rejects.toMatchObject({
              code: -32603,
              data: {
                sessionId: 'replay-cursor',
                reason: 'replay source failed',
                phase: 'replay',
              },
            });
            expect({
              decoded: counters.snapshot().rowsDecoded,
              held: reader.snapshot().liveRows,
            }).toStrictEqual({ decoded: 1, held: 0 });
          } finally {
            await client.dispose();
          }
        },
        2048,
        accountingRow,
        undefined,
        (options) => new FaultHistory(options),
      );
    }, 120_000);

    it('forwards mid-stream abort and closes its reader without another decode', async () => {
      await withSuffixFixture(
        size,
        async (history, reader, counters) => {
          const client = replayClient(history);
          const controller = new AbortController();
          const cursor = readAgentHistoryForReplay(
            client,
            'replay-cursor',
            controller.signal,
          );
          try {
            await cursor.next();
            controller.abort(new Error('replay cancelled'));
            await expect(cursor.next()).rejects.toMatchObject({
              code: -32603,
              data: {
                sessionId: 'replay-cursor',
                reason: 'replay cancelled',
                phase: 'replay',
              },
            });
            expect({
              decoded: counters.snapshot().rowsDecoded,
              held: reader.snapshot().liveRows,
            }).toStrictEqual({ decoded: 1, held: 0 });
          } finally {
            await cursor.return();
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
