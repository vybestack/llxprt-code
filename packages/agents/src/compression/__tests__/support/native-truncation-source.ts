/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import {
  checkpointRows,
  type HistoryCheckpoint,
  type HistoryCheckpointRows,
} from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  executeTruncation,
  truncationValues,
} from '../truncation-value-helpers.js';
import { compressionValueDigest } from '../compression-value-fixture.js';
import { checkpointScratch } from '../checkpoint-source-fault-helpers.js';
import { withNativeFallbackFixture } from './native-fallback-fixture.js';

function failingCheckpoint(
  checkpoint: HistoryCheckpoint,
  failure: Error,
  onClose: () => void,
): HistoryCheckpointRows {
  if (
    !('compressionInput' in checkpoint) ||
    checkpoint.compressionInput === undefined
  )
    throw new Error('Expected the native checkpoint compression view');
  const input = checkpoint.compressionInput;
  let count = 0;
  const readRow = async (index: number): Promise<IContent> => {
    if (++count === 21) throw failure;
    return input.rows.readRow(index);
  };
  return {
    length: checkpoint.length,
    [Symbol.asyncIterator]: () => checkpointRows(checkpoint),
    compressionInput: {
      previous: input.previous,
      rows: {
        length: input.rows.length,
        readRow,
        sourceOrdinalAt: (index) => input.rows.sourceOrdinalAt(index),
        chronologySelection: input.rows.chronologySelection?.bind(input.rows),
        async *[Symbol.asyncIterator]() {
          try {
            for (let index = 0; index < input.rows.length; index++)
              yield await readRow(index);
          } finally {
            onClose();
          }
        },
      },
    },
  };
}

export async function nativeTruncationSourceFailure(
  size: number,
): Promise<number> {
  await withNativeFallbackFixture(async ({ history, owners, durable }) => {
    await history.detachedValues.replace(truncationValues(size, 0, 64));
    const before = await compressionValueDigest(truncationValues(size, 0, 64));
    const scratch = checkpointScratch();
    const failure = new Error('injected native curated producer failure');
    const capture = history.detachedValues.withCheckpoint.bind(
      history.detachedValues,
    );
    let closed = false;
    let escaped: AsyncGenerator<IContent, void, unknown> | undefined;
    history.detachedValues.withCheckpoint = <T>(
      execute: (checkpoint: HistoryCheckpoint) => Promise<T>,
      signal?: AbortSignal,
    ): Promise<T> =>
      capture(async (checkpoint) => {
        escaped = checkpointRows(checkpoint);
        return execute(
          failingCheckpoint(checkpoint, failure, () => {
            closed = true;
          }),
        );
      }, signal);
    expect(
      await rejectedValue(executeTruncation(history, size).then(() => {})),
    ).toBe(failure);
    expect(closed).toBe(true);
    if (escaped === undefined) throw new Error('Checkpoint was not acquired');
    await expect(escaped.next()).rejects.toThrow(
      'A journal read was used after its pin was released',
    );
    expect(checkpointScratch()).toStrictEqual(scratch);
    expect(
      await compressionValueDigest(history.streamRawHistory()),
    ).toStrictEqual(before);
    expect(await durable()).toStrictEqual(before);
    expect(history.getTotalTokens()).toBe(size);
    expect(owners.snapshot().liveRows).toBe(0);
    history.detachedValues.withCheckpoint = capture;
    expect((await executeTruncation(history, size)).outcome).toBe('applied');
    const expected = await compressionValueDigest(
      truncationValues(size, 11, 64, true),
    );
    expect(
      await compressionValueDigest(history.streamRawHistory()),
    ).toStrictEqual(expected);
    expect(await durable()).toStrictEqual(expected);
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
      true,
    );
    expect(checkpointScratch()).toStrictEqual(scratch);
  });
  return size;
}
