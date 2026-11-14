/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRows,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';

describe('detached journal I/O', () => {
  const cases = [512, 8192].flatMap((size) =>
    (['read', 'write'] satisfies Array<'read' | 'write'>).map((kind) => ({
      size,
      kind,
    })),
  );
  for (const { size, kind } of cases) {
    it(`preserves ${size} previous values on zero-progress ${kind} without creating scratch storage`, async () => {
      await withDetachedFixture(
        async ({ history, recorder, owners, io, session }) => {
          await history.detachedValues.replace(detachedRows(size));
          const expected = await detachedDigest(detachedRows(size));
          const directory = dirname(session.path);
          const before = readdirSync(directory).sort();
          const result = await rejectedValue(
            history.detachedValues.transform(async (source, sink) => {
              let index = 0;
              for await (const row of source.streamRows()) {
                if (index++ === 0) io.zeroNext(kind);
                await sink.appendValue({
                  ...row,
                  metadata: { ...row.metadata, turnId: 'changed' },
                });
              }
            }),
          );
          expect(result).toBeInstanceOf(Error);
          if (!(result instanceof Error))
            throw new Error('Expected I/O failure');
          expect(result.message).toMatch(/(no progress|Unexpected end)/i);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
          expect(history.getTotalTokens()).toBe(size * 4);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          expect(readdirSync(directory).sort()).toStrictEqual(before);
        },
      );
    }, 180_000);
  }
});
