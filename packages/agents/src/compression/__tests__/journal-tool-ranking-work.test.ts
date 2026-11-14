/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withDetachedFixture } from '../../../../core/src/services/history/detached-rollback-test-helpers.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';

describe('journal tool ranking descriptor work', () => {
  for (const size of [512, 8192])
    it(`ranks ${size} responses with bounded per-row descriptor work`, async () => {
      await withDetachedFixture(async ({ history, io, session }) => {
        await history.detachedValues.replace(
          (function* () {
            for (let index = 0; index < size; index++)
              yield toolRankingRow(index);
          })(),
        );
        const reads = io.descriptorReads;
        const writes = io.descriptorWrites;
        const commit = session.store.published?.commitSeq ?? 0;
        const revision = 'descriptor-work';
        const snapshot = await history.openToolResponseRanking({
          revision,
          measure: async (_snapshot, entry) => ({
            score: Number(entry.chronologySeq) % 2 === 1 ? 200 : 100,
            saving: 99,
          }),
        });
        if (snapshot === undefined) throw new Error('Missing ranking snapshot');
        try {
          expect(io.descriptorReads - reads).toBeLessThanOrEqual(size * 24);
          expect(io.descriptorWrites - writes).toBeLessThan(size / 4);
          expect(session.store.published?.commitSeq).toBe(commit + 1);
          const tree = await snapshot.toolRanking(revision);
          const header = await tree.header();
          expect(header.count).toBe(size);
          expect(header.rows).toBe(size);
          expect(header.saving).toBe(size * 99);
          expect(header.lastParent).toBe(size - 2);
          let at = 0;
          for await (const rank of tree.ordered(header.root)) {
            const ordinal =
              at < size / 2
                ? size - 2 - at * 2
                : size - 1 - (at - size / 2) * 2;
            expect(rank.ordinal).toBe(ordinal);
            expect(rank.block).toBe(2);
            expect(rank.score).toBe(at < size / 2 ? 200 : 100);
            expect(rank.saving).toBe(99);
            expect(await tree.position(rank.label, rank.block)).toStrictEqual(
              rank,
            );
            at++;
          }
          expect(at).toBe(size);
        } finally {
          await snapshot.close();
        }
      });
    }, 120_000);
});
