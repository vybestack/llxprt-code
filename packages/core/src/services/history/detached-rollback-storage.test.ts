/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import {
  withDetachedFixture,
  detachedRows,
  detachedDigest,
  detachedDurableDigest,
} from './detached-rollback-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';

describe('detached external scratch I/O', () => {
  it.each([
    [512, 'read'],
    [512, 'write'],
    [8192, 'read'],
    [8192, 'write'],
  ])(
    'preserves %s previous values on zero-progress %s',
    async (size: number, kind: string) => {
      await withDetachedFixture(async ({ history, recorder, owners }) => {
        await history.detachedValues.replace(detachedRows(size));
        const expected = await detachedDigest(detachedRows(size));
        const before = fs.readdirSync(tmpdir());
        let restore = (): void => {};
        let result: unknown;
        try {
          result = await rejectedValue(
            history.detachedValues.transform(async (source, sink) => {
              for await (const row of source.streamRows())
                sink.appendValue(row);
              if (kind === 'read') {
                const fault = spyOn(fs, 'readSync').mockImplementation(() => 0);
                restore = () => {
                  fault.mockRestore();
                };
              } else {
                const fault = spyOn(fs, 'writeSync').mockImplementation(
                  () => 0,
                );
                restore = () => {
                  fault.mockRestore();
                };
                sink.appendValue({
                  speaker: 'human',
                  blocks: [{ type: 'text', text: 'candidate fault' }],
                });
              }
            }),
          );
        } finally {
          restore();
        }
        expect(result).toBeInstanceOf(Error);
        if (!(result instanceof Error)) throw new Error('Expected I/O failure');
        expect(result.message).toContain('I/O made no progress');
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          expected,
        );
        expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
        expect(history.getTotalTokens()).toBe(size * 4);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(
          fs
            .readdirSync(tmpdir())
            .filter(
              (name) =>
                name.startsWith('history-detached-') && !before.includes(name),
            ),
        ).toStrictEqual([]);
      });
    },
    180_000,
  );
});
