/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { collectRawHistory } from '../../../../core/src/test-utils/collect-raw-history.js';
import { mediaParticipant } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  withPendingFixture,
  pendingCaller,
  pendingGate,
} from './pending-window-disk-helpers.js';
import { middleoutRow } from './middleout-disk-helpers.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

async function durableParity(size: number): Promise<number> {
  return withPendingFixture(size, async ({ history, setup }) => {
    const logger = new DebugLogger('test:pending-oracle');
    const metadata = await buildCompressionMetadata(
      'oracle',
      setup.runtime,
      history,
      async () => ({
        provider: setup.transport,
        runtime: setup.runtime.providerRuntime,
      }),
      undefined,
      undefined,
      logger,
      { targetTokenCount: 0 },
    );
    const legacy = await new TopDownTruncationStrategy().compress({
      ...metadata,
      history: buildCuratedHistory(
        logger,
        Array.from({ length: size }, (_, index) => middleoutRow(index)),
        false,
      ),
    });
    if (legacy.kind !== 'applied')
      throw new Error('Expected legacy truncation');
    await setup.handler.enforceContextWindow(600, 'pending-durable');
    expect(await collectRawHistory(history)).toStrictEqual([
      ...invalidateResponsesStatefulChain(legacy.newHistory),
    ]);
    expect(history.getCacheAnchorSeq()).toBe(0);
    expect(setup.handler.getLastPromptTokenCount()).toBe(0);
    expect(setup.handler.wasRecentlyCompressed()).toBe(true);
    return (await collectRawHistory(history)).length;
  });
}
async function pendingParity(size: number): Promise<number> {
  return withPendingFixture(
    size,
    async ({
      history,
      recorder,
      owners,
      reads,
      setup,
      pauseWriter,
      releaseWriter,
    }) => {
      pauseWriter();
      const callers = [pendingCaller(0), pendingCaller(1)];
      history.add(callers[0]);
      history.add(callers[1]);
      const markers = callers.map((row) => row.metadata?.chronology);
      history.startCompression();
      const queued = pendingCaller(2);
      history.add(queued);
      const ready = pendingGate();
      const gate = pendingGate();
      history.registerMediaOwner(
        mediaParticipant((input) => ({
          rollback: () => {},
          publish: async () => {
            for (const _row of input.next) {
              ready.resolve();
              await gate.promise;
              break;
            }
          },
        })),
      );
      const operation = setup.handler.enforceContextWindow(
        600,
        'pending-paused',
      );
      await ready.promise;
      try {
        expect(owners.snapshot().liveRows).toBeGreaterThan(0);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        expect(reads.snapshot().peakDecodedRows).toBeLessThanOrEqual(440);
        expect((await collectRawHistory(history)).slice(-2)).toStrictEqual(
          callers,
        );
        expect(queued.metadata?.chronology).toBeUndefined();
      } finally {
        gate.resolve();
      }
      await operation;
      const installed = await collectRawHistory(history);
      expect(installed).toHaveLength(2);
      for (let index = 0; index < callers.length; index++) {
        expect(installed[index]).toBe(callers[index]);
        expect(installed[index].metadata?.chronology).toBe(markers[index]);
      }
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      history.endCompression();
      const queuedRows = await collectRawHistory(history);
      expect(queuedRows[queuedRows.length - 1]).toBe(queued);
      releaseWriter();
      await recorder.flush();
      expect(owners.snapshot().liveRows).toBe(0);
      expect(await collectRawHistory(history)).toStrictEqual([
        ...callers,
        queued,
      ]);
      return queuedRows.length;
    },
  );
}
describe('actual pending-window disk route', () => {
  it.each([512, 8192])(
    'matches independent legacy selection for %i durable mixed rows',
    async (size) => {
      expect(await durableParity(size)).toBeGreaterThan(0);
    },
    180000,
  );
  it.each([512, 8192])(
    'publishes %i rows without awaiting its paused caller writer and preserves queued identities',
    async (size) => {
      expect(await pendingParity(size)).toBeGreaterThan(0);
    },
    180000,
  );
  it('supports a valid surviving record larger than eight MiB', async () => {
    await withPendingFixture(
      3,
      async ({ history, setup }) => {
        await history.transformRows(async (_source, sink) => {
          for (let index = 0; index < 3; index++)
            sink.appendDetached(pendingCaller(index));
          sink.appendDetached({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'x'.repeat(9 * 1024 * 1024) }],
          });
        });
        setup.handler.setLastPromptTokenCount(
          history.getTotalTokens() + 20000000,
        );
        await setup.handler.enforceContextWindow(600, 'pending-large');
        const rows = await collectRawHistory(history);
        expect(rows).toHaveLength(2);
        expect(JSON.stringify(rows[rows.length - 1]).length).toBeGreaterThan(
          8 * 1024 * 1024,
        );
      },
      2048,
      10000000,
    );
  }, 180000);
});
