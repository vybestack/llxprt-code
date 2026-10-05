/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { setImmediate } from 'node:timers/promises';
import { appendFileSync } from 'node:fs';
import type { IContent, ChronologyMarker } from './IContent.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';
import { rejectedValue, rowsOf } from './chronology-rollback-test-helpers.js';

function submission(size: number): {
  rows: IContent[];
  readonly rowsWeak: ReadonlyArray<WeakRef<IContent>>;
  readonly markersWeak: ReadonlyArray<WeakRef<ChronologyMarker>>;
} {
  const rows = Array.from({ length: size }, (_, index) =>
    detachedRow(index + 3),
  );
  return {
    rows,
    rowsWeak: rows.map((row) => new WeakRef(row)),
    markersWeak: rows.map((row) => {
      const marker = row.metadata?.chronology;
      if (marker === undefined) throw new Error('Missing marker');
      return new WeakRef(marker);
    }),
  };
}

async function collect(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await setImmediate();
    gcAndSweep();
  }
  await setImmediate();
}

function roots(input: ReturnType<typeof submission>): object {
  return {
    rows: input.rowsWeak.filter((row) => row.deref() !== undefined).length,
    markers: input.markersWeak.filter((marker) => marker.deref() !== undefined)
      .length,
  };
}

async function* expectedRows(
  size: number,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield detachedRow(index);
}

function record(value: object): void {
  const path = process.env.ADDBATCH_VALUE_OUTPUT;
  if (path !== undefined) appendFileSync(path, JSON.stringify(value) + '\n');
}

function retainingRows(rows: readonly IContent[]): readonly IContent[] {
  if (process.env.ADDBATCH_VALUE_TRAP === 'borrowed') return rows;
  if (process.env.ADDBATCH_VALUE_TRAP === 'copy')
    return rows.map((row) => structuredClone(row));
  return [];
}

async function runOwnershipCase(size: number, fail: boolean): Promise<number> {
  return withDetachedFixture(async ({ history, recorder, owners }) => {
    await history.replaceBatch([
      detachedRow(0),
      detachedRow(1),
      detachedRow(2),
    ]);
    const baseline = await detachedDigest(expectedRows(3));
    const candidate = await detachedDigest(expectedRows(size + 3));
    const input = submission(size);
    let retained = retainingRows(input.rows);
    for (const row of retained) owners.retain(row);
    const failure = new Error('acknowledged append failure');
    const operation = history.addBatch(input.rows, undefined, {
      streamPublication: true,
      awaitDurableCommit: true,
      afterPublication: async () => {
        await history.waitForTokenUpdates();
        await collect();
        const census = owners.snapshot();
        record({ size, fail, census, roots: roots(input) });
        expect(census.liveRows).toBeLessThanOrEqual(440);
        expect(census.liveSerializedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
        expect(roots(input)).toStrictEqual({ rows: 0, markers: 0 });
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          candidate,
        );
        expect(await detachedDurableDigest(recorder)).toStrictEqual(candidate);
        expect(history.getTotalTokens()).toBe(4 * (size + 3));
        if (fail) throw failure;
      },
    });
    input.rows = [];
    const result = await rejectedValue(operation);
    for (const row of retained) owners.release(row);
    retained = [];
    expect(result).toBe(fail ? failure : undefined);
    await collect();
    expect(roots(input)).toStrictEqual({ rows: 0, markers: 0 });
    expect(owners.snapshot().liveRows).toBe(0);
    const expected = fail ? baseline : candidate;
    expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
      expected,
    );
    expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
    expect(history.getTotalTokens()).toBe(fail ? 12 : 4 * (size + 3));
    await history.addBatch([detachedRow(fail ? 3 : size + 3)]);
    return (await detachedDigest(history.streamRawHistory())).count;
  });
}

describe('addBatch value ownership and real compensation', () => {
  for (const size of [512, 8192]) {
    for (const fail of [false, true]) {
      it(`releases ${size} caller roots at acknowledgment with failure=${fail}`, async () => {
        expect(await runOwnershipCase(size, fail)).toBe(
          (fail ? 3 : size + 3) + 1,
        );
      }, 180_000);
    }
  }

  it('accepts frozen repeated aliases without stamping caller metadata', async () => {
    await withDetachedFixture(async ({ history, recorder }) => {
      const caller = Object.freeze({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'caller alias' }],
        metadata: Object.freeze({ id: 'caller' }),
      } satisfies IContent);
      await history.addBatch([caller, caller]);
      expect(caller.metadata).toStrictEqual({ id: 'caller' });
      const rows = await rowsOf(history);
      expect(rows.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
        1, 2,
      ]);
      expect(rows.map((row) => row.blocks)).toStrictEqual([
        caller.blocks,
        caller.blocks,
      ]);
      expect((await detachedDurableDigest(recorder)).count).toBe(2);
    });
  });

  it('accepts a complete row larger than nine MiB without a blanket row-size ban', async () => {
    await withDetachedFixture(async ({ history, recorder }) => {
      const marker = { seq: 1, userTurn: 1, step: 0, recordedAt: 0 };
      const caller = {
        ...detachedRow(0, 9 * 1024 * 1024 + 1),
        metadata: { id: 'duplicate', chronology: marker },
      };
      await history.addBatch([caller]);
      expect(caller.metadata.chronology).toBe(marker);
      expect((await rowsOf(history))[0]).toStrictEqual(caller);
      expect((await detachedDurableDigest(recorder)).bytes).toBeGreaterThan(
        9 * 1024 * 1024,
      );
    });
  }, 180_000);
});
