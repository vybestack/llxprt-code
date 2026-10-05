/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { appendFileSync } from 'node:fs';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import { ownerFixtureRow } from './chronology-rollback-owner-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

function positiveBounds(census: ReturnType<RowOwnership['snapshot']>): void {
  expect(census.liveRows).toBeLessThanOrEqual(440);
  expect(census.liveSerializedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
}

function retainingEvidence(
  census: ReturnType<RowOwnership['snapshot']>,
  size: number,
): void {
  expect(census.liveRows).toBeGreaterThan(440);
  expect(census.liveSerializedBytes).toBeGreaterThan(
    size === 8192 ? 8 * 1024 * 1024 : 0,
  );
}

async function identityControl(size: number, mode: string): Promise<number> {
  const owners = new RowOwnership();
  await withSuffixFixture(
    size,
    async (history) => {
      history.setTokenizerFactory(exactTokenizer());
      let traversed = 0;
      let bytes = 0;
      const failure = new Error('identity control rollback');
      const result = await rejectedValue(
        history.transformAll(
          async (source, sink) => {
            for await (const { row } of source.streamRows()) {
              expect(row).toStrictEqual(ownerFixtureRow(traversed++, 2048));
              bytes += Buffer.byteLength(JSON.stringify(row));
              if (mode === 'borrowed') sink.appendBorrowed(row);
              else sink.appendIdentity(structuredClone(row));
            }
          },
          undefined,
          {
            afterPublication: () => {
              gcAndSweep();
              const census = owners.snapshot();
              const output = process.env.TRANSFORMALL_OWNER_OUTPUT;
              if (output !== undefined)
                appendFileSync(
                  output,
                  `${JSON.stringify({ size, mode, traversed, bytes, census })}\n`,
                );
              expect(traversed).toBe(size);
              expect(census.liveRows).toBe(2 * size);
              expect(bytes).toBeGreaterThan(size * 2048);
              if (process.env.TRANSFORMALL_RETAINING_TRAP === '1')
                positiveBounds(census);
              else retainingEvidence(census, size);
              throw failure;
            },
          },
        ),
      );
      let restored = 0;
      for await (const row of history.streamRawHistory())
        expect(row).toStrictEqual(ownerFixtureRow(restored++, 2048));
      expect(restored).toBe(size);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().liveSerializedBytes).toBe(0);
      if (process.env.TRANSFORMALL_RETAINING_TRAP === '1') throw result;
      expect(result).toBe(failure);
    },
    2048,
    ownerFixtureRow,
    owners,
  );
  return owners.snapshot().liveRows;
}

describe('public transform identity ownership', () => {
  for (const size of [512, 8192]) {
    for (const mode of ['borrowed', 'distinct-copy']) {
      it(`accepts and detects ${mode} retention of all ${size} rows`, async () => {
        expect(await identityControl(size, mode)).toBe(0);
      }, 120_000);
    }
  }
});

describe('public transform large valid rows', () => {
  for (const mode of ['detached', 'borrowed']) {
    it(`preserves a valid nine-MiB ${mode} row without a size ban`, async () => {
      await withSuffixFixture(
        1,
        async (history) => {
          history.setTokenizerFactory(exactTokenizer());
          let bytes = 0;
          await history.transformAll(async (source, sink) => {
            for await (const { row } of source.streamRows()) {
              bytes += Buffer.byteLength(JSON.stringify(row));
              if (mode === 'borrowed') sink.appendBorrowed(row);
              else sink.appendDetached(row);
            }
          });
          expect(bytes).toBeGreaterThan(8 * 1024 * 1024);
          let count = 0;
          for await (const row of history.streamRawHistory()) {
            expect(row).toStrictEqual(ownerFixtureRow(0, 9 * 1024 * 1024));
            count++;
          }
          expect(count).toBe(1);
        },
        9 * 1024 * 1024,
        ownerFixtureRow,
      );
    }, 120_000);
  }
});

describe('public transform strong marker rollback', () => {
  it('restores exact caller markers displaced after stamping, including repeated identities', async () => {
    await withRollbackFixture(async (history) => {
      const marker = { seq: 300, userTurn: 200, step: 9, recordedAt: 0 };
      const caller = { ...rollbackRow(0), metadata: { chronology: marker } };
      const fresh = rollbackRow(1);
      const failure = new Error('marker displacement');
      expect(
        await rejectedValue(
          history.transformAll(
            async (_source, sink) => {
              sink.appendIdentity(caller);
              sink.appendBorrowed(fresh);
              sink.appendBorrowed(fresh);
            },
            undefined,
            {
              afterPublication: () => {
                caller.metadata.chronology = { ...marker, seq: 900 };
                gcAndSweep();
                throw failure;
              },
            },
          ),
        ),
      ).toBe(failure);
      expect(caller.metadata.chronology).toBe(marker);
      expect(fresh.metadata).toBeUndefined();
      expect(await rowsOf(history)).toStrictEqual([]);
      await history.transformAll(async (_source, sink) =>
        sink.appendIdentity(fresh),
      );
      expect(fresh.metadata?.chronology?.seq).toBe(1);
    });
  });
});
