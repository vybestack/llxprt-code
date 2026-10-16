/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { IdOccurrence } from './idFactUpdate.js';
import { FactFixture } from './__tests__/support/idFactFixture.js';
import {
  occurrencesOf,
  randomRows,
} from './__tests__/support/idHistoryModel.js';
import { hex, shapeSignature } from './__tests__/support/idTrieHarness.js';
import {
  idsFromIdPiece,
  occurrencesFor,
  pair,
  realMapping,
  type MistralRow,
} from './__tests__/support/mistralFixtures.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { realDeps } from './__tests__/support/idFactFixture.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const HISTORIES = 12;
const ROWS = 28;
/** Every apply charges more than this, so the batch merges after every block. */
const MERGE_EVERY_BLOCK = 1;
/** A few blocks fit before a merge. */
const MERGE_EVERY_FEW_BLOCKS = 2_000;
const MISTRAL_SLOT = 0;

interface Dump {
  readonly entries: string[];
  readonly exceptionCount: number;
  readonly shape: string;
}

async function dump(fixture: FactFixture): Promise<Dump> {
  const entries: string[] = [];
  for await (const entry of fixture.entries()) {
    entries.push(`${hex(entry.hash)}=${hex(entry.value)}`);
  }
  return {
    entries,
    exceptionCount: fixture.exceptionCount,
    shape: await shapeSignature(fixture.trie.reader(), fixture.root),
  };
}

describe('an id fact batch that merges into the trie in chunks (design 4.6)', () => {
  const tempDir = useTempDir('id-batch-spill-');

  async function create(
    name: string,
    capBytes: number | undefined,
  ): Promise<FactFixture> {
    return FactFixture.create(
      path.join(tempDir(), name),
      realDeps(),
      new BoundedIdNodeCache(),
      capBytes,
    );
  }

  it('gives the facts of a bulk build for every id, with the same trie, whatever the cap, over random histories', async () => {
    for (let seed = 1; seed <= HISTORIES; seed++) {
      const occurrences = occurrencesOf(randomRows(seed + 300, ROWS));
      const whole = await create(`whole-${seed}.llxj`, undefined);
      const wholeStats = await whole.bulk(occurrences);
      const expected = await dump(whole);
      expect(expected.entries.length).toBeGreaterThan(20);
      for (const cap of [MERGE_EVERY_BLOCK, MERGE_EVERY_FEW_BLOCKS]) {
        const chunked = await create(`cap-${cap}-${seed}.llxj`, cap);
        const stats = await chunked.bulk(occurrences);
        expect(await dump(chunked)).toStrictEqual(expected);
        // The chunks were merged: nodes were written more than once.
        expect(stats.bytes).toBeGreaterThan(wholeStats.bytes);
        await chunked.close();
      }
      await whole.close();
    }
  });

  it('gives the same facts when the chunks merge into a trie that earlier groups wrote', async () => {
    for (let seed = 1; seed <= HISTORIES; seed++) {
      const occurrences = occurrencesOf(randomRows(seed + 500, ROWS));
      const plain = await create(`plain-${seed}.llxj`, undefined);
      const chunked = await create(`chunked-${seed}.llxj`, MERGE_EVERY_BLOCK);
      const random = new SeededRandom(seed);
      for (let at = 0; at < occurrences.length; ) {
        const size = 1 + random.int(9);
        const group = occurrences.slice(at, at + size);
        await plain.append(group);
        await chunked.append(group);
        at += size;
      }
      expect(await dump(chunked)).toStrictEqual(await dump(plain));
      await plain.close();
      await chunked.close();
    }
  });

  it('gives the same facts for Kimi exception ids, which leave the clean state in the middle of a chunk', async () => {
    const rows: MistralRow[] = [
      { speaker: 'ai', id: 'dup' },
      { speaker: 'tool', id: 'clean' },
      { speaker: 'ai', id: 'dup' },
      { speaker: 'ai', id: '' },
      { speaker: 'ai', id: 'dup' },
      ...pair('toolu_a-b'),
      ...pair('call_a!b'),
    ];
    const occurrences = occurrencesFor(rows);
    const plain = await create('kimi-plain.llxj', undefined);
    const chunked = await create('kimi-chunked.llxj', MERGE_EVERY_BLOCK);
    const plainStats = await plain.append(occurrences);
    const chunkedStats = await chunked.append(occurrences);
    expect(chunkedStats.bytes).toBeGreaterThan(plainStats.bytes);
    const expected = await dump(plain);
    expect(expected.exceptionCount).toBeGreaterThan(0);
    expect(await dump(chunked)).toStrictEqual(expected);
    await plain.close();
    await chunked.close();
  });

  it('gives the same facts for Mistral mapped ids, whose references are set from facts that sit in an earlier chunk', async () => {
    const rows: MistralRow[] = [
      ...pair('toolu_alpha-1'),
      ...pair('toolu_beta-2'),
      ...pair('call_gamma_3'),
      ...pair('toolu_alpha-1'),
      ...pair('x'),
    ];
    const rawRows = idsFromIdPiece(rows);
    const mapping = realMapping(rawRows);
    const rebuild = async (
      capBytes: number | undefined,
    ): Promise<Dump & { bytes: number }> => {
      const fixture = await create(`mistral-${capBytes}.llxj`, capBytes);
      let valueOffset = 4096;
      const stats = await fixture.append(
        occurrencesFor(rawRows),
        async (batch) => {
          for (const [rawId, mapped] of mapping) {
            batch.markMistralUsed(MISTRAL_SLOT, mapped, rawId);
            await batch.setMappedRef(rawId, valueOffset);
            valueOffset += 64;
          }
        },
      );
      const result = await dump(fixture);
      await fixture.close();
      return { ...result, bytes: stats.bytes };
    };
    const { bytes: plainBytes, ...expected } = await rebuild(undefined);
    expect(expected.entries.length).toBeGreaterThan(10);
    const { bytes: chunkedBytes, ...actual } = await rebuild(MERGE_EVERY_BLOCK);
    expect(actual).toStrictEqual(expected);
    expect(chunkedBytes).toBeGreaterThan(plainBytes);
  });

  it('does not merge before the cap is reached', async () => {
    const occurrences: IdOccurrence[] = occurrencesOf(randomRows(7, ROWS));
    const plain = await create('under-plain.llxj', undefined);
    const roomy = await create('under-roomy.llxj', 1 << 30);
    const plainStats = await plain.bulk(occurrences);
    const roomyStats = await roomy.bulk(occurrences);
    expect(roomyStats.bytes).toBe(plainStats.bytes);
    await plain.close();
    await roomy.close();
  });
});
