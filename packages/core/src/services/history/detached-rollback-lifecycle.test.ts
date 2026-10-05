/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import type { IContent } from './IContent.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRows,
  detachedRow,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';

describe('detached cleanup error ordering', () => {
  it('reports primary failure before scratch close failure while releasing all owners', async () => {
    await withDetachedFixture(async ({ history, owners }) => {
      const failure = new Error('transform failure');
      const cleanupFailure = new Error('scratch close failure');
      const close = fs.closeSync;
      let armed = false;
      const closing = spyOn(fs, 'closeSync').mockImplementation((fd): void => {
        close(fd);
        if (armed) {
          armed = false;
          throw cleanupFailure;
        }
      });
      let result: unknown;
      try {
        result = await rejectedValue(
          history.detachedValues.transform(async (_source, sink) => {
            sink.appendValue(detachedRow(0));
            armed = true;
            throw failure;
          }),
        );
      } finally {
        closing.mockRestore();
      }
      expect(result).toBeInstanceOf(AggregateError);
      if (!(result instanceof AggregateError))
        throw new Error('Expected aggregate');
      expect(result.errors[0]).toBe(failure);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});

describe('detached resource lifecycle', () => {
  for (const file of ['rows', 'index', 'markers']) {
    it(`cleans up failed ${file} acquisition and releases submitted array owners`, async () => {
      await withDetachedFixture(async ({ history, owners }) => {
        const before = fs.readdirSync(tmpdir());
        const failure = new Error('acquisition');
        const open = fs.openSync;
        const fault = spyOn(fs, 'openSync').mockImplementation(
          (path, flags, mode) => {
            if (
              String(path).includes('history-detached-') &&
              String(path).endsWith('/' + file)
            )
              throw failure;
            return open(path, flags, mode);
          },
        );
        let result: unknown;
        try {
          result = await rejectedValue(
            history.detachedValues.replace([detachedRow(0)]),
          );
        } finally {
          fault.mockRestore();
        }
        expect(result).toBe(failure);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(
          fs
            .readdirSync(tmpdir())
            .filter(
              (name) =>
                name.startsWith('history-detached-') && !before.includes(name),
            ),
        ).toStrictEqual([]);
        expect(history.getContextRange().totalEntries).toBe(0);
      });
    });
  }
});

describe('detached cursor lifecycle', () => {
  it('closes a source cursor that escapes its transform before acknowledgement', async () => {
    await withDetachedFixture(async ({ history, owners }) => {
      await history.detachedValues.replace(detachedRows(8));
      let cursor: AsyncIterator<IContent> | undefined;
      let ackOwners = -1;
      await history.detachedValues.transform(
        async (source, sink) => {
          cursor = source.streamRows()[Symbol.asyncIterator]();
          const first = await cursor.next();
          if (first.done === true) throw new Error('Missing first row');
          sink.appendValue(first.value);
        },
        undefined,
        {
          onAcknowledged: () => {
            ackOwners = owners.snapshot().liveRows;
          },
        },
      );
      expect(ackOwners).toBeLessThanOrEqual(1);
      expect(await cursor?.next()).toStrictEqual({
        value: undefined,
        done: true,
      });
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('returns a cancelled submitted iterator without altering previous history', async () => {
    await withDetachedFixture(async ({ history, recorder, owners }) => {
      await history.detachedValues.replace(detachedRows(3));
      const controller = new AbortController();
      const failure = new Error('cancel capture');
      let returned = false;
      const submitted = async function* (): AsyncGenerator<
        IContent,
        void,
        unknown
      > {
        try {
          yield detachedRow(8);
          controller.abort(failure);
          yield detachedRow(9);
        } finally {
          returned = true;
        }
      };
      expect(
        await rejectedValue(
          history.detachedValues.replace(submitted(), undefined, {
            signal: controller.signal,
          }),
        ),
      ).toBe(failure);
      expect(returned).toBe(true);
      const expected = await detachedDigest(detachedRows(3));
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});
