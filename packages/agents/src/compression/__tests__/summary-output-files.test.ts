/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';
import { join } from 'node:path';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { getScratchRoot } from '../../../../core/src/storage/scratch-root.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { middleoutRow, middleoutSetup } from './middleout-disk-helpers.js';
import { oneshotSetup } from './oneshot-disk-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { curatedDensityRows } from '../curatedCandidate.js';
import { buildCompressionSystemInstruction } from '../compressionSystemPrompt.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { MiddleOutStrategy } from '../MiddleOutStrategy.js';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import {
  streamCompressionOutputRows,
  type CompressionOutputRows,
} from '../summaryOutput.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';

async function assertOutputCopy(
  candidate: CompressionOutputRows,
): Promise<void> {
  const copies: Array<{ readonly row: IContent; readonly ordinal: number }> =
    [];
  let summaries = 0;
  let continuations = 0;
  for await (const { row, sourceOrdinal } of streamCompressionOutputRows(
    candidate,
  )) {
    if (sourceOrdinal !== undefined)
      copies.push({ row, ordinal: sourceOrdinal });
    summaries += Number(row.metadata?.isSummary === true);
    continuations += Number(
      row.metadata?.reason === 'compression-continuation',
    );
  }
  expect(copies.map(({ row }) => row)).toStrictEqual(
    copies.map(({ ordinal }) => middleoutRow(ordinal, 64)),
  );
  expect(copies).toHaveLength(candidate.length - 2);
  expect(copies.length).toBeGreaterThan(0);
  expect(summaries).toBe(1);
  expect(continuations).toBe(1);
}

async function seededSummary(
  strategy: 'middle-out' | 'one-shot',
  action: (
    fixture: Parameters<Parameters<typeof withNativeFallbackFixture>[0]>[0],
    setup: ReturnType<typeof middleoutSetup>,
  ) => Promise<void>,
): Promise<void> {
  await withNativeFallbackFixture(async (fixture) => {
    await fixture.seed(
      (function* () {
        for (let index = 0; index < 512; index++) yield middleoutRow(index, 64);
      })(),
    );
    const setup = strategy === 'middle-out' ? middleoutSetup : oneshotSetup;
    getScratchRoot();
    await buildCompressionSystemInstruction('test-model', {
      provider: 'summary-transport',
      interactionMode: 'non-interactive',
    });
    await action(fixture, setup(fixture.history));
  });
}

describe('summary output candidate allocation', () => {
  const directory = useTempDir('summary-create-control-');

  it('observes real creation outside the process scratch root', async () => {
    const root = join(directory(), 'different-root');
    const receipt = await operationFileCreates(async () => {
      fs.mkdirSync(root);
      const first = fs.mkdtempSync(join(root, 'sync-'));
      fs.writeFileSync(join(first, 'sync-value'), 'value');
      const second = await promises.mkdtemp(join(root, 'async-'));
      await promises.writeFile(join(second, 'async-value'), 'value');
    });
    expect(receipt.directories).toHaveLength(3);
    expect(receipt.files).toHaveLength(2);
    expect(receipt.directories.every((path) => path.startsWith(root))).toBe(
      true,
    );
  });

  for (const strategy of ['middle-out', 'one-shot'] as const) {
    it(`${strategy} preserves the summary failure and the cleanup failure with the primary cause`, async () => {
      await seededSummary(strategy, async ({ history }, setup) => {
        setup.transport.failure = new Error('provider refused summary');
        const cleanup = new Error('curated snapshot close failed');
        const close = JournalDumpSnapshot.prototype.close;
        let injected = false;
        const spy = spyOn(
          JournalDumpSnapshot.prototype,
          'close',
        ).mockImplementation(async function (this: JournalDumpSnapshot) {
          await close.call(this);
          if (!injected) {
            injected = true;
            throw cleanup;
          }
        });
        try {
          const failure: unknown = await setup.handler
            .performCompression('dispose-fault')
            .catch((error: unknown) => error);
          if (!(failure instanceof AggregateError))
            throw new Error('Expected primary and cleanup failures');
          expect(failure.errors).toHaveLength(2);
          expect(failure.errors[0].message).toContain(
            'provider refused summary',
          );
          expect(failure.errors[1]).toBe(cleanup);
          expect(failure.cause).toBe(failure.errors[0]);
          expect(history.getStatistics().totalMessages).toBe(512);
        } finally {
          spy.mockRestore();
        }
      });
    });

    it(`${strategy} creates no curated input files on the public native path`, async () => {
      await seededSummary(
        strategy,
        async ({ history, durable }, { handler }) => {
          const receipt = await operationFileCreates(async () => {
            expect(await handler.performCompression('no-output-file')).toBe(
              PerformCompressionResult.COMPRESSED,
            );
          });
          expect(
            receipt.directories.filter((path) =>
              path.includes('history-density-'),
            ),
          ).toHaveLength(0);
          expect(
            receipt.directories.filter((path) =>
              path.includes('compression-span-'),
            ),
          ).toHaveLength(1);
          expect(
            receipt.directories.filter(
              (path) =>
                !path.includes('history-density-') &&
                !path.includes('compression-span-'),
            ),
          ).toStrictEqual([]);
          expect(
            receipt.files.filter((path) => path.includes('history-density-')),
          ).toHaveLength(0);
          expect(
            receipt.files.filter(
              (path) =>
                !path.includes('history-density-') &&
                !path.includes('compression-span-'),
            ),
          ).toStrictEqual([]);
          expect(await durable()).toStrictEqual(
            await compressionValueDigest(history.streamRawHistory()),
          );
        },
      );
    });

    it(`${strategy} prepares and emits its actual output without any file creation`, async () => {
      await seededSummary(strategy, async ({ history }, setup) => {
        const previous = await history.openDumpSnapshot();
        const source = await curatedDensityRows(previous.rows());
        try {
          const metadata = await buildCompressionMetadata(
            'output-producer',
            setup.runtime,
            history,
            async () => ({
              provider: setup.transport,
              runtime: setup.runtime.providerRuntime,
              invocation: setup.runtime.prepareProviderInvocation(
                setup.transport.name,
              ),
            }),
            async () => 'finish the experiment',
            () => '/fixture/session.jsonl',
            new DebugLogger('test:summary-output'),
          );
          const producer =
            strategy === 'middle-out'
              ? new MiddleOutStrategy()
              : new OneShotStrategy();
          const receipt = await operationFileCreates(async () => {
            const result = await producer.prepareDisk({
              ...metadata,
              history: source,
            });
            if (result.kind !== 'applied')
              throw new Error('Expected applied summary output');
            await assertOutputCopy(result.candidate);
            const controller = new AbortController();
            const failure = new Error('cancel output producer');
            const reader = streamCompressionOutputRows(
              result.candidate,
              0,
              controller.signal,
            );
            expect((await reader.next()).done).toBe(false);
            controller.abort(failure);
            await expect(reader.next()).rejects.toBe(failure);
          });
          expect(receipt).toStrictEqual({ directories: [], files: [] });
          expect(producer.summaryRequestOwnership.snapshot().liveRows).toBe(0);
        } finally {
          source.close();
          await previous.close();
        }
      });
    });
  }
});
