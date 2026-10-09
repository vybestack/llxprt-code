import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withSuffixFixture,
  suffixRow,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  curatedFixtureRow,
  fixtureIncluded,
} from '@vybestack/llxprt-code-core/services/history/curated-stream-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  buildRuntimeContext,
  buildMockContentGenerator,
} from './__tests__/chatSession-density-helpers.js';
import { ConversationManager } from './ConversationManager.js';
import { ChatSession } from './chatSession.js';
import { buildErrorReportContext } from './turnErrorReportContext.js';

for (const size of [512, 8192]) {
  describe(`curated error reporting for ${size} journal rows`, () => {
    it('streams through the conversation and chat facades and keeps the last eight curated rows', async () => {
      await withSuffixFixture(
        size,
        async (service, ownership, counters) => {
          const runtime = buildRuntimeContext(service);
          const manager = new ConversationManager(service, runtime);
          const chat = new ChatSession(runtime, buildMockContentGenerator());
          const restoreMaterialization = forbidHistoryMaterializationForTest(
            service,
            'eager curated read',
          );
          try {
            const request = { text: 'failed request' };
            const expected = Array.from({ length: size }, (_, i) => i)
              .filter(fixtureIncluded)
              .map((i) => curatedFixtureRow(i));
            const stream = manager.getHistory(true);
            expect(Symbol.asyncIterator in stream).toBe(true);
            const report = await buildErrorReportContext(
              stream,
              request,
              'https://endpoint.example',
            );
            expect(report).toStrictEqual({
              request,
              recentHistory: expected.slice(-8),
              omittedHistoryCount: expected.length - 8,
              baseUrl: 'https://endpoint.example',
            });
            expect(
              await buildErrorReportContext(chat.getHistory(true), request),
            ).toStrictEqual({
              request,
              recentHistory: expected.slice(-8),
              omittedHistoryCount: expected.length - 8,
            });
            expect(counters.snapshot().peakDecodedRows).toBe(1);
            expect(ownership.snapshot().liveRows).toBe(0);
            restoreMaterialization();
            let rawCount = 0;
            for await (const _row of manager.getHistory(false)) rawCount++;
            expect(rawCount).toBe(size);
          } finally {
            restoreMaterialization();
          }
        },
        0,
        curatedFixtureRow,
      );
    }, 120_000);
  });
}

describe('bounded error history input', () => {
  it('keeps all rows for short synchronous inputs without an endpoint field', async () => {
    expect(
      await buildErrorReportContext([suffixRow(0), suffixRow(1)], 'request'),
    ).toStrictEqual({
      request: 'request',
      recentHistory: [suffixRow(0), suffixRow(1)],
      omittedHistoryCount: 0,
    });
  });

  it('does not swallow errors from history iteration', async () => {
    async function* failing(): AsyncGenerator<IContent> {
      yield suffixRow(0);
      throw new Error('history unavailable');
    }
    await expect(buildErrorReportContext(failing(), 'request')).rejects.toThrow(
      'history unavailable',
    );
  });
});
