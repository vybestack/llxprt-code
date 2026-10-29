/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';

async function failureOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('Expected native purge failure');
}

describe('native semantic purge cleanup identity', () => {
  it('preserves the primary cause and independent close error while releasing the next attempt', async () => {
    const history = new HistoryService({});
    const primary = new Error('purge persistence failed');
    const cleanup = new Error('purge descriptor close failed');
    try {
      await history.detachedValues.replace([
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'prefix' },
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: 'aQ==',
            },
          ],
        },
      ]);
      const session = new SemanticMediaPurgeSession({
        history,
        mode: () => 'remove',
        persist: async () => {
          throw primary;
        },
      });
      const attempt = await session.begin(false);
      if (attempt === undefined) throw new Error('Missing cleanup attempt');
      const close = JournalDumpSnapshot.prototype.close;
      const fault = spyOn(
        JournalDumpSnapshot.prototype,
        'close',
      ).mockImplementation(async function (this: JournalDumpSnapshot) {
        await close.call(this);
        throw cleanup;
      });
      try {
        const failure = await failureOf(() =>
          attempt.complete({
            status: 'success',
            usage: undefined,
            retryHandoff: false,
          }),
        );
        expect(failure).toBeInstanceOf(AggregateError);
        if (!(failure instanceof AggregateError))
          throw new Error('Missing aggregate');
        expect(failure.cause).toBe(primary);
        expect(failure.errors).toStrictEqual([primary, cleanup]);
      } finally {
        fault.mockRestore();
        await attempt.finalize();
      }
      const next = await session.begin(false);
      expect(next).toBeDefined();
      await next?.finalize();
    } finally {
      await history.dispose();
    }
  });
});

describe('native semantic purge reader retirement', () => {
  for (const explicit of [false, true]) {
    it(`retires a suspended ${explicit ? 'tagged pre-image' : 'candidate'} reader before releasing its version`, async () => {
      const history = new HistoryService({});
      const ownership = new RowOwnership();
      try {
        await history.detachedValues.replace([
          { speaker: 'human', blocks: [{ type: 'text', text: 'prefix' }] },
          {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'image' },
              {
                type: 'media',
                encoding: 'base64',
                mimeType: 'image/png',
                data: 'aQ==',
              },
            ],
          },
        ]);
        const session = new SemanticMediaPurgeSession({
          history,
          ownership,
          mode: () => 'remove',
          persist: async () => undefined,
        });
        const attempt = await session.begin(explicit);
        if (attempt === undefined)
          throw new Error('Missing native reader attempt');
        const reader = attempt.requestHistory.streamRows();
        expect((await reader.next()).done).toBe(false);
        expect(ownership.snapshot().liveRows).toBe(1);
        await attempt.finalize();
        expect(ownership.snapshot().liveRows).toBe(0);
        await expect(reader.next()).rejects.toThrow('closed');
      } finally {
        await history.dispose();
      }
    });
  }
});
