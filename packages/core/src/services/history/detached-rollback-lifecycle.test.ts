/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import { withDetachedContractFixture } from './__tests__/support/detached-contract-fixture.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedRow,
  detachedRows,
} from './detached-rollback-test-helpers.js';
describe('detached cursor lifecycle on journal', () => {
  const backend = 'journal';
  it('closes a source cursor that escapes its transform before acknowledgement', async () => {
    await withDetachedContractFixture(backend, async ({ history, owners }) => {
      await history.detachedValues.replace(detachedRows(8));
      let cursor: AsyncIterator<IContent> | undefined;
      let ackOwners = -1;
      await history.detachedValues.transform(
        async (source, sink) => {
          cursor = source.streamRows()[Symbol.asyncIterator]();
          const first = await cursor.next();
          if (first.done === true) throw new Error('Missing first row');
          await sink.appendValue(first.value);
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
    await withDetachedContractFixture(
      backend,
      async ({ history, durable, owners }) => {
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
        expect(await durable()).toStrictEqual(expected);
        expect(owners.snapshot().liveRows).toBe(0);
      },
    );
  });
});
