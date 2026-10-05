/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { applyCompressionWithAnchor } from './cacheAnchor.js';
import {
  withDetachedFixture,
  detachedRows,
  detachedRow,
  detachedDigest,
  detachedDurableDigest,
  type DetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';

const { gcAndSweep }: { gcAndSweep: () => void } = createRequire(
  import.meta.url,
)('bun:jsc');

function gate(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function collectGarbage(): Promise<void> {
  for (let index = 0; index < 4; index++) {
    await setImmediate();
    gcAndSweep();
  }
}

function submitCandidate(
  fixture: DetachedFixture,
  size: number,
): {
  operation: Promise<unknown>;
  array: WeakRef<readonly IContent[]>;
  rows: ReadonlyArray<WeakRef<IContent>>;
} {
  const input = {
    rows: Array.from({ length: size }, (_, index) => detachedRow(index)),
  };
  const array = new WeakRef(input.rows);
  const rows = input.rows.map((row) => new WeakRef(row));
  const operation = rejectedValue(
    applyCompressionWithAnchor(fixture.history, input.rows, 2, 'test'),
  );
  input.rows = [];
  return { operation, array, rows };
}

for (const size of [512, 8192]) {
  describe(`compression source lifetime at ${size} rows`, () => {
    it(`releases consumed compression source shells while real publication remains suspended at ${size} rows`, async () => {
      await withDetachedFixture(async (fixture) => {
        const { history, recorder, owners } = fixture;
        await history.detachedValues.replace(detachedRows(3));
        history.setCacheAnchorSeq(1);
        const baseline = await detachedDigest(detachedRows(3));
        const ready = gate();
        const release = gate();
        const failure = new Error('compression finalizer failed');
        let fail = true;
        history.registerMediaOwner(
          mediaParticipant(() => ({
            publish: (): void => {},
            finalize: async (): Promise<void> => {
              if (fail) {
                ready.resolve();
                await release.promise;
                throw failure;
              }
            },
            rollback: (): void => {},
          })),
        );
        const active = submitCandidate(fixture, size);
        await ready.promise;
        try {
          await collectGarbage();
          expect(active.array.deref()).toBeUndefined();
          expect(
            active.rows.filter((ref) => ref.deref() !== undefined),
          ).toHaveLength(0);
          expect(history.getCacheAnchorSeq()).toBe(1);
          expect((await detachedDigest(history.streamRawHistory())).count).toBe(
            size,
          );
        } finally {
          release.resolve();
          await active.operation;
        }
        expect(await active.operation).toBe(failure);
        await history.waitForCommit();
        expect({
          live: await detachedDigest(history.streamRawHistory()),
          durable: await detachedDurableDigest(recorder),
          anchor: history.getCacheAnchorSeq(),
        }).toStrictEqual({ live: baseline, durable: baseline, anchor: 1 });
        fail = false;
        await applyCompressionWithAnchor(
          history,
          Array.from({ length: size }, (_, index) => detachedRow(index)),
          2,
          'test',
        );
        await history.waitForCommit();
        expect({
          anchor: history.getCacheAnchorSeq(),
          count: (await detachedDigest(history.streamRawHistory())).count,
        }).toStrictEqual({ anchor: 2, count: size });
        expect(owners.snapshot().liveRows).toBe(0);
      });
    }, 180_000);
  });
}
