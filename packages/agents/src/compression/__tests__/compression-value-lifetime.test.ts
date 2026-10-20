/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { join } from 'node:path';
import { compressionValueDigest } from './compression-value-fixture.js';
import { withCompressionValueRecorder } from './support/compression-value-recorder-fixture.js';
import { middleoutRow, middleoutSetup } from './middleout-disk-helpers.js';
import {
  ValueCompressionHistory,
  StreamingSummaryTransport,
  valueGate,
} from './compression-value-fixture.js';

const { gcAndSweep }: { gcAndSweep: () => void } = createRequire(
  import.meta.url,
)('bun:jsc');

class ObservedValueHistory extends ValueCompressionHistory {
  readonly sourceRows: Array<WeakRef<IContent>> = [];
  readonly submittedRows: Array<WeakRef<IContent>> = [];
  override async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    const snapshot = await super.openDumpSnapshot();
    const weak = this.sourceRows;
    return {
      chronology: () => snapshot.chronology(),
      close: () => snapshot.close(),
      async *rows(): AsyncGenerator<IContent, void, unknown> {
        for await (const row of snapshot.rows()) {
          weak.push(new WeakRef(row));
          yield row;
        }
      },
    };
  }
}
async function weakAlive(
  weak: ReadonlyArray<WeakRef<IContent>>,
): Promise<number> {
  await setImmediate();
  gcAndSweep();
  await setImmediate();
  gcAndSweep();
  return weak.filter((reference) => reference.deref() !== undefined).length;
}
async function suspendPublication(history: ObservedValueHistory): Promise<{
  readonly ready: ReturnType<typeof valueGate>;
  readonly release: ReturnType<typeof valueGate>;
  readonly failure: Error;
  readonly state: {
    acknowledged: boolean;
    callbacks: number;
    published: number;
  };
  restore(): void;
}> {
  const ready = valueGate();
  const release = valueGate();
  const failure = new Error('production value callback failed');
  const state = { acknowledged: false, callbacks: 0, published: 0 };
  const transform = history.detachedValues.transform;
  history.detachedValues.transform = (candidate, model, options) => {
    const observe = (row: IContent): void => {
      history.submittedRows.push(new WeakRef(row));
    };
    return transform(
      (source, sink) =>
        candidate(source, {
          appendValue: (row) => {
            observe(row);
            return sink.appendValue(row);
          },
          appendDerived: (ordinal, row) => {
            observe(row);
            return sink.appendDerived(ordinal, row);
          },
          appendReplacement: (ordinal, row) => {
            observe(row);
            return sink.appendReplacement(ordinal, row);
          },
          removeValue: (ordinal) => sink.removeValue(ordinal),
        }),
      model,
      {
        ...options,
        onAcknowledged: async () => {
          state.acknowledged = true;
          for await (const _row of history.streamRawHistory())
            state.published++;
        },
        afterPublication: async () => {
          state.callbacks++;
          ready.resolve();
          await release.promise;
          throw failure;
        },
      },
    );
  };
  return {
    ready,
    release,
    failure,
    state,
    restore: () => {
      history.detachedValues.transform = transform;
    },
  };
}
async function exercise(
  history: ObservedValueHistory,
  owners: RowOwnership,
  size: number,
  bytes: number,
): Promise<number> {
  async function* originalRows(): AsyncGenerator<IContent, void, unknown> {
    for (let index = 0; index < size; index++)
      yield middleoutRow(index, index === 0 ? bytes : 2048);
  }
  const baseline = await compressionValueDigest(originalRows());
  const suspension = await suspendPublication(history);
  const { handler } = middleoutSetup(history, new StreamingSummaryTransport());
  history.setCacheAnchorSeq(1);
  const operation = handler.performCompression('value-lifetime').then(
    () => undefined,
    (error: unknown) => error,
  );
  await Promise.race([
    suspension.ready.promise,
    operation.then((error) => {
      throw error;
    }),
  ]);
  try {
    expect(suspension.state.acknowledged && history.compressionLocked).toBe(
      true,
    );
    expect(history.getCacheAnchorSeq()).toBe(1);
    expect(history.sourceRows.length).toBeGreaterThanOrEqual(size);
    expect(await weakAlive(history.sourceRows)).toBeLessThanOrEqual(1);
    expect(await weakAlive(history.submittedRows)).toBeLessThanOrEqual(1);
    expect(suspension.state.published).toBe(history.submittedRows.length);
    const boundedSmallRows =
      bytes !== 2048 ||
      owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 });
    expect(boundedSmallRows).toBe(true);
  } finally {
    suspension.release.resolve();
  }
  expect(await operation).toBe(suspension.failure);
  expect(suspension.state.callbacks).toBe(1);
  await history.waitForCommit();
  expect(
    await compressionValueDigest(history.streamRawHistory()),
  ).toStrictEqual(baseline);
  expect(history.compressionLocked).toBe(false);
  expect(owners.snapshot().liveRows).toBe(0);
  suspension.restore();
  expect(await handler.performCompression('value-retry')).toBe(
    PerformCompressionResult.COMPRESSED,
  );
  let anchor = 0;
  for await (const row of history.streamRawHistory())
    if (row.metadata?.cacheAnchor === true)
      anchor = row.metadata.chronology?.seq ?? 0;
  expect(history.getCacheAnchorSeq()).toBe(anchor);
  return suspension.state.published;
}
function lifetime(size: number, bytes: number): Promise<number> {
  return withCompressionValueRecorder(
    size,
    async ({ history, owners, root }) => {
      if (!(history instanceof ObservedValueHistory))
        throw new Error('Wrong history');
      const media = new LocalMediaStore({
        rootDirectory: join(root, 'media'),
        quotaBytes: 1024,
      });
      try {
        await history.registerMediaOwner(new HistoryMediaOwnership(media));
        return await exercise(history, owners, size, bytes);
      } finally {
        await media.close();
      }
    },
    (index) => middleoutRow(index, index === 0 ? bytes : 2048),
    (options) => new ObservedValueHistory(options),
  );
}

describe('production compression value source and publication lifetime', () => {
  it.each([512, 8192])(
    'releases %i-row upstream source frames and submission shells during real acknowledged publication failure and retries under the real lock',
    async (size) => {
      expect(await lifetime(size, 2048)).toBeGreaterThan(0);
    },
    180_000,
  );
  it('keeps a valid complete nine-MiB row through acknowledged failure, rollback and real caller retry', async () => {
    expect(await lifetime(16, 9 * 1024 * 1024)).toBeGreaterThan(0);
  }, 180_000);
});
