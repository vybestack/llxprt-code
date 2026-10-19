/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import {
  detachedDigest,
  detachedRows,
} from './detached-rollback-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import { getScratchRoot } from '../../storage/scratch-root.js';

const cases: ReadonlyArray<{ size: number; kind: 'read' | 'write' }> = [
  { size: 512, kind: 'read' },
  { size: 512, kind: 'write' },
  { size: 8192, kind: 'read' },
  { size: 8192, kind: 'write' },
];

describe('native detached positional I/O', () => {
  it.each([...cases])(
    'preserves all $size previous values on zero-progress $kind',
    async ({ size, kind }) => {
      await withNativeDetachedFixture(
        async ({ history, io, owners, durable }) => {
          await history.detachedValues.replace(detachedRows(size));
          const expected = await detachedDigest(detachedRows(size));
          await history.waitForCommit();
          const before = readdirSync(getScratchRoot());
          const result = await rejectedValue(
            history.detachedValues.transform(async (source, sink) => {
              io.zeroNext(kind);
              for await (const row of source.streamRows())
                await sink.appendValue({
                  ...row,
                  metadata: { ...row.metadata, turnId: 'candidate fault' },
                });
            }),
          );
          expect(result).toBeInstanceOf(Error);
          if (!(result instanceof Error))
            throw new Error('Expected I/O failure');
          expect(result.message).toContain(
            kind === 'read'
              ? 'Unexpected end of file reading'
              : 'made no progress',
          );
          expect(kind === 'read' ? io.reads : io.writes).toBe(1);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(await durable()).toStrictEqual(expected);
          expect(history.getTotalTokens()).toBe(size * 4);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(
            readdirSync(getScratchRoot()).filter(
              (name) =>
                name.startsWith('history-detached-') && !before.includes(name),
            ),
          ).toStrictEqual([]);
        },
      );
    },
    180_000,
  );
});
