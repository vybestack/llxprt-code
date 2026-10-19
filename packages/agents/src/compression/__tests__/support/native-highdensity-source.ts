/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import {
  checkpointRows,
  type HistoryCheckpoint,
} from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import { transformFixtureRows } from '@vybestack/llxprt-code-core/services/history/__tests__/support/transform-value-fixtures-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { highdensitySetup } from '../highdensity-disk-helpers.js';
import { compressionValueDigest } from '../compression-value-fixture.js';
import { checkpointScratch } from '../checkpoint-source-fault-helpers.js';
import { withNativeFallbackFixture } from './native-fallback-fixture.js';

function sourceFault(
  history: HistoryService,
  failure: Error,
): {
  readonly visited: number;
  readonly closed: number;
  next(): Promise<IteratorResult<IContent, void>>;
  restore(): void;
} {
  const capture = history.detachedValues.withCheckpoint.bind(
    history.detachedValues,
  );
  let closed = 0;
  let visited = 0;
  let escaped: AsyncGenerator<IContent, void, unknown> | undefined;
  history.detachedValues.withCheckpoint = <T>(
    execute: (checkpoint: HistoryCheckpoint) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> =>
    capture(async (checkpoint) => {
      escaped = checkpointRows(checkpoint);
      return execute({
        length: checkpoint.length,
        async *[Symbol.asyncIterator]() {
          try {
            for await (const row of checkpointRows(checkpoint)) {
              if (++visited === 31) throw failure;
              yield row;
            }
          } finally {
            closed++;
          }
        },
      });
    }, signal);
  return {
    get visited() {
      return visited;
    },
    get closed() {
      return closed;
    },
    next: () => {
      if (escaped === undefined) throw new Error('Checkpoint was not acquired');
      return escaped.next();
    },
    restore: () => {
      history.detachedValues.withCheckpoint = capture;
    },
  };
}

export async function nativeHighdensitySourceFailure(
  size: number,
  mode: string,
): Promise<number> {
  await withNativeFallbackFixture(async ({ history, owners, durable }) => {
    await history.detachedValues.replace(transformFixtureRows(size, true, 64));
    history.setCacheAnchorSeq(1);
    history.setBaseTokenOffset(37);
    const { handler, transport } = highdensitySetup(history);
    const before = await compressionValueDigest(
      transformFixtureRows(size, true, 64),
    );
    expect(before.count).toBe(size);
    expect(await durable()).toStrictEqual(before);
    const range = history.getContextRange();
    const scratch = checkpointScratch();
    const failure =
      mode === 'cancel'
        ? new DOMException('cancelled native source', 'AbortError')
        : new Error('native disk source failed');
    const probe = sourceFault(history, failure);
    expect(
      await rejectedValue(
        handler.performCompression('native-source-fault').then(() => {}),
      ),
    ).toBe(failure);
    expect(probe.visited).toBe(31);
    expect(probe.closed).toBe(1);
    await expect(probe.next()).rejects.toThrow(
      'A journal read was used after its pin was released',
    );
    expect(checkpointScratch()).toStrictEqual(scratch);
    expect(
      await compressionValueDigest(history.streamRawHistory()),
    ).toStrictEqual(before);
    expect(await durable()).toStrictEqual(before);
    expect(history.getTotalTokens()).toBe(size * 3 + 37);
    expect(history.getBaseTokenOffset()).toBe(37);
    expect(history.getCacheAnchorSeq()).toBe(1);
    expect(history.getContextRange()).toStrictEqual(range);
    expect(transport.requests).toHaveLength(0);
    expect(owners.snapshot().liveRows).toBe(0);
    probe.restore();
    expect(await handler.performCompression('native-source-retry')).toBe(
      PerformCompressionResult.COMPRESSED,
    );
    const after = await compressionValueDigest(history.streamRawHistory());
    expect(after.count).toBeGreaterThan(0);
    expect(after.sha256).not.toBe(before.sha256);
    expect(await durable()).toStrictEqual(after);
    expect(history.getCacheAnchorSeq()).toBe(0);
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
      true,
    );
    expect(checkpointScratch()).toStrictEqual(scratch);
  });
  return size;
}
