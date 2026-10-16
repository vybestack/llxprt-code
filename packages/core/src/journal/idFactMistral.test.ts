/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import {
  createInMemoryToolIdStore,
  getToolIdStrategy,
} from '@vybestack/llxprt-code-tools';
import { describe, expect, it } from 'bun:test';
import { ID_NS, OCCURRENCE_KIND } from './idKeys.js';
import { ROW_SPEAKER, decodeIdPiece, encodeIdPiece } from './rowRecord.js';
import type { IdOccurrence } from './idFactUpdate.js';
import { FactFixture } from './__tests__/support/idFactFixture.js';
import { hex } from './__tests__/support/idTrieHarness.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const SLOT = 0;
const MAPPED_ID_LENGTH = 9;

/** A history reduced to what the Mistral mapper looks at: calls in AI rows and responses in tool rows. */
interface MistralRow {
  readonly speaker: 'ai' | 'tool';
  readonly id: string;
}

const pair = (id: string): MistralRow[] => [
  { speaker: 'ai', id },
  { speaker: 'tool', id },
];

/** The real mapper of the tools package: observe every row, then resolve in conversion order. */
function realMapping(rows: readonly MistralRow[]): Map<string, string> {
  const store = createInMemoryToolIdStore();
  const mapper = getToolIdStrategy('mistral').createStreamingMapper(store);
  for (const row of rows) {
    mapper.observe({
      blocks:
        row.speaker === 'ai'
          ? [{ type: 'tool_call', id: row.id, name: 'n' }]
          : [{ type: 'tool_response', callId: row.id, toolName: 'n' }],
    });
  }
  const mapped = new Map<string, string>();
  for (const row of rows) {
    mapped.set(
      row.id,
      row.speaker === 'ai'
        ? mapper.resolveToolCallId({
            type: 'tool_call',
            id: row.id,
            name: 'n',
            parameters: {},
          })
        : mapper.resolveToolResponseId({ callId: row.id, toolName: 'n' }),
    );
  }
  return mapped;
}

/** What a rebuild has: the raw id strings of the surviving rows, through the row id piece. */
function idsFromIdPiece(rows: readonly MistralRow[]): MistralRow[] {
  const piece = encodeIdPiece(rows.map((row) => row.id));
  const ids = decodeIdPiece(piece, rows.length);
  return rows.map((row, at) => ({ speaker: row.speaker, id: ids[at] }));
}

function occurrencesFor(rows: readonly MistralRow[]): IdOccurrence[] {
  return rows.map((row, at) => {
    const label = BigInt(at + 1) * 1000n;
    const speaker = row.speaker === 'ai' ? ROW_SPEAKER.ai : ROW_SPEAKER.tool;
    return {
      rawId: row.id,
      kind:
        row.speaker === 'ai' ? OCCURRENCE_KIND.call : OCCURRENCE_KIND.response,
      at: { label, part: 0, block: 0 },
      partSpeaker: speaker,
      unit: {
        position: { label, part: 0, unit: 0 },
        speaker,
        leadingTool: false,
      },
      score: 1,
      nameLen: 1,
      reconstructed: false,
    };
  });
}

/** Rebuilds the index of the rows from their raw ids and stores the mapper's answers in it. */
async function rebuildIndex(
  fixture: FactFixture,
  rows: readonly MistralRow[],
): Promise<Map<string, string>> {
  const rawRows = idsFromIdPiece(rows);
  const mapping = realMapping(rawRows);
  let valueOffset = 4096;
  await fixture.append(occurrencesFor(rawRows), async (batch) => {
    for (const [rawId, mapped] of mapping) {
      batch.markMistralUsed(SLOT, mapped, rawId);
      await batch.setMappedRef(rawId, valueOffset);
      valueOffset += 64;
    }
  });
  return mapping;
}

function rawHash(fixture: FactFixture, rawId: string): string {
  return hex(fixture.deps.hasher(ID_NS.fact, new TextEncoder().encode(rawId)));
}

const HOLDER_SOURCE = 'toolu_alpha-1';

describe('Mistral mapped ids and the raw ids that rebuild them', () => {
  const tempDir = useTempDir('id-facts-mistral-');

  it('rebuilds the used set from the raw ids after the first holder of a salt is removed, where the stored mapping is stale', async () => {
    const free = realMapping(pair(HOLDER_SOURCE)).get(HOLDER_SOURCE) ?? '';
    const holder = free;
    expect(holder).toHaveLength(MAPPED_ID_LENGTH);
    const full = [...pair(holder), ...pair(HOLDER_SOURCE)];
    const survivors = pair(HOLDER_SOURCE);
    const fullMap = realMapping(full);
    const survivorMap = realMapping(survivors);
    const stale = fullMap.get(HOLDER_SOURCE) ?? '';
    const correct = survivorMap.get(HOLDER_SOURCE) ?? '';
    expect(correct).toBe(holder);
    expect(stale).not.toBe(correct);
    expect(stale).toHaveLength(MAPPED_ID_LENGTH);

    const before = await FactFixture.create(
      path.join(tempDir(), 'before.llxj'),
    );
    await rebuildIndex(before, full);
    const beforeQueries = before.queries();
    expect(
      hex((await beforeQueries.mistralUsedBy(SLOT, stale)) ?? new Uint8Array()),
    ).toBe(rawHash(before, HOLDER_SOURCE));

    const rebuilt = await FactFixture.create(
      path.join(tempDir(), 'after.llxj'),
    );
    const mapping = await rebuildIndex(rebuilt, survivors);
    expect(mapping).toStrictEqual(survivorMap);
    const queries = rebuilt.queries();
    const usedBy = await queries.mistralUsedBy(SLOT, correct);
    expect(usedBy && hex(usedBy)).toBe(rawHash(rebuilt, HOLDER_SOURCE));
    expect(await queries.mistralUsedBy(SLOT, stale)).toBeUndefined();
    const fact = await queries.fact(HOLDER_SOURCE);
    expect(fact?.mappedRef).toBe(4096);
    await before.close();
    await rebuilt.close();
  });

  it('control: ids rebuilt from hashes and not from the raw strings give other bytes on the wire', () => {
    const survivors = pair(HOLDER_SOURCE);
    const hashed = survivors.map((row) => ({
      speaker: row.speaker,
      id: createHash('sha256').update(row.id).digest('hex').slice(0, 32),
    }));
    expect(realMapping(hashed).get(hashed[0].id)).not.toBe(
      realMapping(survivors).get(HOLDER_SOURCE),
    );
  });

  it('equals the real mapper after any removal, over collision-heavy histories, and the stale mapping does not', async () => {
    const pool = [
      'toolu_a1',
      'call_b2',
      'hist_tool_c3',
      'weird id',
      'x',
      'abcdefghi',
      'ABC123xyz',
    ];
    const holders = pool.flatMap((id) => {
      const first = realMapping(pair(id)).get(id) ?? '';
      const second = realMapping([...pair(first), ...pair(id)]).get(id) ?? '';
      return [first, second];
    });
    let rebuildEqual = 0;
    let staleWrong = 0;
    let cases = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const random = new SeededRandom(seed);
      const rows: MistralRow[] = [];
      for (let at = 0; at < 3 + random.int(9); at++) {
        const id =
          random.int(3) === 0
            ? holders[random.int(holders.length)]
            : pool[random.int(pool.length)];
        rows.push(...pair(id));
      }
      const kept = rows.filter((_, at) => at % 2 === 1 || random.int(10) < 6);
      const fullMap = realMapping(rows);
      const keptMap = realMapping(kept);
      const fixture = await FactFixture.create(
        path.join(tempDir(), `m-${seed}.llxj`),
      );
      const rebuilt = await rebuildIndex(fixture, kept);
      const queries = fixture.queries();
      let usedOk = true;
      for (const mapped of new Set(keptMap.values())) {
        // A nine-character id passes through unchanged even when it is the mapped id of another raw id, so two raw ids can share one.
        const owners = new Set(
          [...keptMap]
            .filter(([, value]) => value === mapped)
            .map(([id]) => rawHash(fixture, id)),
        );
        const usedBy = await queries.mistralUsedBy(SLOT, mapped);
        usedOk = usedOk && usedBy !== undefined && owners.has(hex(usedBy));
      }
      if (
        usedOk &&
        [...keptMap].every(([id, mapped]) => rebuilt.get(id) === mapped)
      )
        rebuildEqual += 1;
      if ([...keptMap].some(([id, mapped]) => fullMap.get(id) !== mapped))
        staleWrong += 1;
      cases += 1;
      await fixture.close();
    }
    expect(rebuildEqual).toBe(cases);
    expect(staleWrong).toBeGreaterThan(0);
  });

  it('keeps one used-set entry per format slot', async () => {
    const fixture = await FactFixture.create(
      path.join(tempDir(), 'slots.llxj'),
    );
    await fixture.append([], async (batch) => {
      batch.markMistralUsed(0, 'abcdefghi', 'one');
      batch.markMistralUsed(1, 'abcdefghi', 'two');
    });
    const queries = fixture.queries();
    expect(
      hex((await queries.mistralUsedBy(0, 'abcdefghi')) ?? new Uint8Array()),
    ).toBe(rawHash(fixture, 'one'));
    expect(
      hex((await queries.mistralUsedBy(1, 'abcdefghi')) ?? new Uint8Array()),
    ).toBe(rawHash(fixture, 'two'));
    expect(await queries.mistralUsedBy(2, 'abcdefghi')).toBeUndefined();
    await fixture.close();
  });

  it('refuses a mapped reference for an id with no fact', async () => {
    const fixture = await FactFixture.create(
      path.join(tempDir(), 'noref.llxj'),
    );
    await expect(
      fixture.append([], (batch) => batch.setMappedRef('ghost', 99)),
    ).rejects.toThrow('no fact');
    await fixture.close();
  });
});

describe('relocation entries (namespace 6)', () => {
  const tempDir = useTempDir('id-facts-reloc-');

  it('maps old record offsets to new ones, and an unmapped offset to nothing', async () => {
    const fixture = await FactFixture.create(
      path.join(tempDir(), 'reloc.llxj'),
    );
    await fixture.append([], async (batch) => {
      for (let at = 0; at < 50; at++)
        batch.recordRelocation(1000 + at * 7, 90_000 + at * 3);
    });
    const queries = fixture.queries();
    for (let at = 0; at < 50; at++) {
      expect(await queries.relocation(1000 + at * 7)).toBe(90_000 + at * 3);
    }
    expect(await queries.relocation(999)).toBeUndefined();
    await fixture.close();
  });
});
