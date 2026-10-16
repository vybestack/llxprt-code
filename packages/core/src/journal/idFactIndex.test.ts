/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import type { IdFact } from './idFactCodec.js';
import type { IdFactQueries } from './idFactQueries.js';
import type { IdOccurrence } from './idFactUpdate.js';
import { isKimiException } from './idFactUpdate.js';
import {
  ID_NS,
  OCCURRENCE_KIND,
  type NormalizedFamily,
  type OccurrenceKind,
} from './idKeys.js';
import type { UnitPosition } from './idEntryCodecs.js';
import { ROW_SPEAKER } from './rowRecord.js';
import {
  ID_SHAPES,
  naiveState,
  occurrencesOf,
  listKey,
  randomRows,
  type NaiveIdState,
} from './__tests__/support/idHistoryModel.js';
import {
  FactFixture,
  normalizeFor,
} from './__tests__/support/idFactFixture.js';
import { hex } from './__tests__/support/idTrieHarness.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const HISTORIES = 30;
const ROWS = 28;
const FAMILIES = [ID_NS.openai, ID_NS.anthropic] as const;
const KINDS = [OCCURRENCE_KIND.call, OCCURRENCE_KIND.response] as const;

function unitAt(
  label: number,
  speaker: number,
  options: { part?: number; unit?: number; leadingTool?: boolean } = {},
): IdOccurrence['unit'] {
  return {
    position: {
      label: BigInt(label),
      part: options.part ?? 0,
      unit: options.unit ?? 0,
    },
    speaker,
    leadingTool: options.leadingTool ?? false,
  };
}

function occ(
  rawId: string,
  kind: 'call' | 'response',
  label: number,
  speaker: number,
  extra: Partial<IdOccurrence> = {},
): IdOccurrence {
  return {
    rawId,
    kind: kind === 'call' ? OCCURRENCE_KIND.call : OCCURRENCE_KIND.response,
    at: { label: BigInt(label), part: 0, block: extra.at?.block ?? 0 },
    partSpeaker: speaker,
    unit: unitAt(label, speaker),
    score: 0,
    nameLen: kind === 'call' ? 4 : 0,
    reconstructed: false,
    ...extra,
  };
}

async function requireFact(
  queries: IdFactQueries,
  rawId: string,
): Promise<IdFact> {
  const fact = await queries.fact(rawId);
  if (fact === undefined)
    throw new Error(`no fact for ${JSON.stringify(rawId)}`);
  return fact;
}

async function expectMatchesNaive(
  fixture: FactFixture,
  naive: NaiveIdState,
  extraIds: readonly string[],
): Promise<void> {
  const queries = fixture.queries();
  const ids = new Set([...ID_SHAPES, ...naive.facts.keys(), ...extraIds]);
  for (const rawId of ids) {
    const stored = await queries.fact(rawId);
    expect(stored).toStrictEqual(naive.facts.get(rawId));
    for (const kind of KINDS) {
      const chain = naive.chains.get(`${kind}:${rawId}`) ?? [];
      const total =
        kind === OCCURRENCE_KIND.call ? stored?.callCount : stored?.respCount;
      expect(total ?? 0).toBe(chain.length);
      for (let k = 1; k <= chain.length; k++) {
        expect(await queries.occurrence(rawId, kind, k)).toStrictEqual(
          chain[k - 1],
        );
      }
      expect(
        await queries.occurrence(rawId, kind, chain.length + 1),
      ).toBeUndefined();
    }
  }
  await expectNormalizedMatch(fixture, naive, ids);
  expect(fixture.exceptionCount).toBe(naive.exceptions.length);
  for (const [k, rawId] of naive.exceptions.entries()) {
    const stored = await queries.exceptionHash(k);
    expect(stored === undefined ? undefined : hex(stored)).toBe(
      hex(fixture.deps.hasher(ID_NS.fact, new TextEncoder().encode(rawId))),
    );
  }
  expect(await queries.exceptionHash(naive.exceptions.length)).toBeUndefined();
}

async function expectNormalizedMatch(
  fixture: FactFixture,
  naive: NaiveIdState,
  rawIds: ReadonlySet<string>,
): Promise<void> {
  const queries = fixture.queries();
  for (const family of FAMILIES) {
    const normalizedIds = new Set(
      [...rawIds].map((id) => normalizeFor(family, id)),
    );
    for (const nid of normalizedIds) {
      for (const kind of KINDS) {
        const expected = naive.normalized.get(listKey(family, kind, nid)) ?? [];
        await expectListMatches(queries, [family, kind, nid], expected);
      }
    }
  }
}

async function expectListMatches(
  queries: IdFactQueries,
  [family, kind, nid]: [NormalizedFamily, OccurrenceKind, string],
  expected: readonly UnitPosition[],
): Promise<void> {
  expect(await queries.normalizedCount(family, kind, nid)).toBe(
    expected.length,
  );
  for (let k = 1; k <= expected.length; k++) {
    expect(
      await queries.normalizedPosition(family, kind, nid, k),
    ).toStrictEqual(expected[k - 1]);
  }
}

describe('fact update rule against a naive recomputation over random histories', () => {
  const tempDir = useTempDir('id-facts-');

  it('applied incrementally in random groups, it gives the facts, chains, lists and exception ids of a recomputation', async () => {
    let checked = 0;
    for (let seed = 1; seed <= HISTORIES; seed++) {
      const occurrences = occurrencesOf(randomRows(seed, ROWS));
      const naive = naiveState(occurrences, normalizeFor);
      const fixture = await FactFixture.create(
        path.join(tempDir(), `inc-${seed}.llxj`),
      );
      const random = new SeededRandom(seed);
      for (let at = 0; at < occurrences.length; ) {
        const size = 1 + random.int(9);
        await fixture.append(occurrences.slice(at, at + size));
        at += size;
      }
      await expectMatchesNaive(fixture, naive, ['never-seen']);
      checked += 1;
      await fixture.close();
    }
    expect(checked).toBe(HISTORIES);
  });

  it('applied in one bulk build, it gives the same', async () => {
    let checked = 0;
    for (let seed = 1; seed <= HISTORIES; seed++) {
      const occurrences = occurrencesOf(randomRows(seed, ROWS));
      const naive = naiveState(occurrences, normalizeFor);
      const fixture = await FactFixture.create(
        path.join(tempDir(), `bulk-${seed}.llxj`),
      );
      await fixture.bulk(occurrences);
      await expectMatchesNaive(fixture, naive, ['never-seen']);
      checked += 1;
      await fixture.close();
    }
    expect(checked).toBe(HISTORIES);
  });

  it('gives the same facts, with the same trie shape, by incremental append and by bulk build', async () => {
    for (let seed = 1; seed <= 8; seed++) {
      const occurrences = occurrencesOf(randomRows(seed + 100, ROWS));
      const incremental = await FactFixture.create(
        path.join(tempDir(), `i-${seed}.llxj`),
      );
      const random = new SeededRandom(seed);
      for (let at = 0; at < occurrences.length; ) {
        const size = 1 + random.int(5);
        await incremental.append(occurrences.slice(at, at + size));
        at += size;
      }
      const bulk = await FactFixture.create(
        path.join(tempDir(), `b-${seed}.llxj`),
      );
      await bulk.bulk(occurrences);
      const left: string[] = [];
      for await (const entry of incremental.entries())
        left.push(`${hex(entry.hash)}=${hex(entry.value)}`);
      const right: string[] = [];
      for await (const entry of bulk.entries())
        right.push(`${hex(entry.hash)}=${hex(entry.value)}`);
      expect(left.length).toBeGreaterThan(20);
      expect(left).toStrictEqual(right);
      expect(incremental.exceptionCount).toBe(bulk.exceptionCount);
      await incremental.close();
      await bulk.close();
    }
  });

  it('covers the cases the rules exist for: split ids, reconstructed calls, exception ids, human results, leading tool units', () => {
    const seen = {
      callFirstOnNonAi: 0,
      reconstructed: 0,
      exceptions: 0,
      humanResults: 0,
      leadingTool: 0,
      duplicateCalls: 0,
      unnamedCalls: 0,
    };
    for (let seed = 1; seed <= HISTORIES; seed++) {
      const occurrences = occurrencesOf(randomRows(seed, ROWS));
      const naive = naiveState(occurrences, normalizeFor);
      seen.exceptions += naive.exceptions.length;
      for (const fact of naive.facts.values()) {
        if (
          fact.firstCall &&
          fact.firstAiCall &&
          fact.firstCall.label !== fact.firstAiCall.label
        )
          seen.callFirstOnNonAi += 1;
        if (fact.callCount > 1) seen.duplicateCalls += 1;
        if (fact.unnamed > 0) seen.unnamedCalls += 1;
      }
      for (const o of occurrences) {
        if (o.reconstructed) seen.reconstructed += 1;
        if (
          o.kind === OCCURRENCE_KIND.response &&
          o.unit.speaker === ROW_SPEAKER.human
        )
          seen.humanResults += 1;
        if (o.unit.leadingTool) seen.leadingTool += 1;
      }
    }
    for (const [name, count] of Object.entries(seen)) {
      expect({ name, covered: count > 0 }).toStrictEqual({
        name,
        covered: true,
      });
    }
  });

  it('control: looking an Anthropic result up by its raw id is wrong where the normalized id is right', async () => {
    let rawWrong = 0;
    let normalizedWrong = 0;
    for (let seed = 1; seed <= HISTORIES; seed++) {
      const occurrences = occurrencesOf(randomRows(seed, ROWS));
      const naive = naiveState(occurrences, normalizeFor);
      for (const result of occurrences.filter(
        (o) => o.kind === OCCURRENCE_KIND.response,
      )) {
        const nid = normalizeFor(ID_NS.anthropic, result.rawId);
        const truth =
          (naive.normalized.get(
            listKey(ID_NS.anthropic, OCCURRENCE_KIND.call, nid),
          )?.length ?? 0) > 0;
        const byRaw =
          (naive.chains.get(`${OCCURRENCE_KIND.call}:${result.rawId}`)
            ?.length ?? 0) > 0;
        if (byRaw !== truth) rawWrong += 1;
        const aiCalls = occurrences.filter(
          (o) =>
            o.kind === OCCURRENCE_KIND.call &&
            o.unit.speaker === ROW_SPEAKER.ai &&
            normalizeFor(ID_NS.anthropic, o.rawId) === nid,
        );
        if (aiCalls.length > 0 !== truth) normalizedWrong += 1;
      }
    }
    expect(rawWrong).toBeGreaterThan(0);
    expect(normalizedWrong).toBe(0);
  });
});

describe('what the update rule records', () => {
  const tempDir = useTempDir('id-facts-rules-');
  const AI = ROW_SPEAKER.ai;
  const HUMAN = ROW_SPEAKER.human;
  const TOOL = ROW_SPEAKER.tool;

  it("keys the empty id and 'call_' to the same OpenAI id, and to different Anthropic ids", async () => {
    expect(normalizeFor(ID_NS.openai, '')).toBe(
      normalizeFor(ID_NS.openai, 'call_'),
    );
    expect(normalizeFor(ID_NS.anthropic, '')).not.toBe(
      normalizeFor(ID_NS.anthropic, 'call_'),
    );
    const fixture = await FactFixture.create(
      path.join(tempDir(), 'empty.llxj'),
    );
    await fixture.append([
      occ('', 'call', 10, AI, { at: { label: 10n, part: 0, block: 0 } }),
      occ('call_', 'call', 10, AI, { at: { label: 10n, part: 0, block: 1 } }),
      occ('call_', 'response', 20, TOOL),
    ]);
    const queries = fixture.queries();
    const nid = normalizeFor(ID_NS.openai, '');
    expect(
      await queries.normalizedCount(ID_NS.openai, OCCURRENCE_KIND.call, nid),
    ).toBe(2);
    expect(
      await queries.normalizedCount(
        ID_NS.openai,
        OCCURRENCE_KIND.response,
        nid,
      ),
    ).toBe(1);
    expect((await queries.fact(''))?.callCount).toBe(1);
    expect((await queries.fact('call_'))?.callCount).toBe(1);
    expect((await queries.fact(''))?.respCount).toBe(0);
    expect((await queries.fact('call_'))?.respCount).toBe(1);
    await fixture.close();
  });

  it("makes 'hist_tool_X' and 'toolu_X' one Anthropic key, so a result finds its call", async () => {
    const fixture = await FactFixture.create(path.join(tempDir(), 'anth.llxj'));
    await fixture.append([
      occ('hist_tool_X', 'call', 10, AI),
      occ('toolu_X', 'response', 20, TOOL),
    ]);
    const queries = fixture.queries();
    const nid = normalizeFor(ID_NS.anthropic, 'toolu_X');
    expect(normalizeFor(ID_NS.anthropic, 'hist_tool_X')).toBe(nid);
    expect(
      await queries.normalizedCount(ID_NS.anthropic, OCCURRENCE_KIND.call, nid),
    ).toBe(1);
    expect(
      await queries.normalizedCount(
        ID_NS.anthropic,
        OCCURRENCE_KIND.response,
        nid,
      ),
    ).toBe(1);
    expect((await queries.fact('toolu_X'))?.callCount).toBe(0);
    await fixture.close();
  });

  it('records Ca as the first AI-speaker call even when a human row holds the call first', async () => {
    const fixture = await FactFixture.create(path.join(tempDir(), 'ca.llxj'));
    await fixture.append([
      occ('a', 'call', 10, HUMAN),
      occ('a', 'call', 20, AI),
      occ('a', 'call', 30, AI),
    ]);
    const fact = await fixture.queries().fact('a');
    expect(fact?.firstCall?.label).toBe(10n);
    expect(fact?.firstAiCall?.label).toBe(20n);
    expect(fact?.callCount).toBe(3);
    await fixture.close();
  });

  it('takes R and Rt from the first response, best from the highest score and the earliest on a tie, and ignores an empty response id', async () => {
    const fixture = await FactFixture.create(path.join(tempDir(), 'resp.llxj'));
    await fixture.append([
      occ('r', 'call', 10, AI),
      occ('r', 'response', 20, HUMAN, { score: 1 }),
      occ('r', 'response', 30, TOOL, { score: 3 }),
      occ('r', 'response', 40, TOOL, { score: 3 }),
      occ('r', 'response', 50, TOOL, { score: 2 }),
      occ('', 'response', 60, TOOL, { score: 9 }),
    ]);
    const queries = fixture.queries();
    const fact = await queries.fact('r');
    expect(fact?.firstResponse?.label).toBe(20n);
    expect(fact?.firstToolResponse?.label).toBe(30n);
    expect(fact?.best?.label).toBe(30n);
    expect(fact?.bestScore).toBe(3);
    expect(fact?.respCount).toBe(4);
    const empty = await queries.fact('');
    expect(empty?.respCount).toBe(1);
    expect(empty?.firstResponse).toBeUndefined();
    expect(empty?.best).toBeUndefined();
    await fixture.close();
  });

  it('keeps reconstructed calls out of C and Ca but in the counts, the lists and Ke', async () => {
    const fixture = await FactFixture.create(
      path.join(tempDir(), 'recon.llxj'),
    );
    await fixture.append([
      occ('z', 'call', 20, AI, { reconstructed: true, nameLen: 12 }),
      occ('z', 'response', 20, TOOL),
    ]);
    const queries = fixture.queries();
    const fact = await queries.fact('z');
    expect(fact?.firstCall).toBeUndefined();
    expect(fact?.firstAiCall).toBeUndefined();
    expect(fact?.callCount).toBe(1);
    expect(fact?.lastEligibleCall?.nameLen).toBe(12);
    expect(
      await queries.normalizedCount(
        ID_NS.openai,
        OCCURRENCE_KIND.call,
        'call_z',
      ),
    ).toBe(1);
    await fixture.close();
  });

  it('refuses an occurrence that is not after the first of its kind', async () => {
    const fixture = await FactFixture.create(
      path.join(tempDir(), 'order.llxj'),
    );
    await fixture.append([occ('o', 'call', 20, AI)]);
    await expect(fixture.append([occ('o', 'call', 10, AI)])).rejects.toThrow(
      JournalFormatError,
    );
    await fixture.close();
  });

  it('refuses a leading flag on a unit that is not a tool unit and a reconstructed response', async () => {
    const fixture = await FactFixture.create(path.join(tempDir(), 'bad.llxj'));
    await expect(
      fixture.append([
        occ('p', 'response', 10, AI, {
          unit: unitAt(10, AI, { leadingTool: true }),
        }),
      ]),
    ).rejects.toThrow(JournalFormatError);
    await expect(
      fixture.append([occ('p', 'response', 10, TOOL, { reconstructed: true })]),
    ).rejects.toThrow(JournalFormatError);
    await fixture.close();
  });

  it('admits human-row results to the Anthropic list and not to the OpenAI list; leading tool units to neither Anthropic list entry', async () => {
    const fixture = await FactFixture.create(
      path.join(tempDir(), 'human.llxj'),
    );
    await fixture.append([
      occ('h', 'response', 5, TOOL, {
        unit: unitAt(5, TOOL, { leadingTool: true }),
      }),
      occ('h', 'response', 10, HUMAN),
      occ('h', 'response', 20, TOOL),
    ]);
    const queries = fixture.queries();
    expect(
      await queries.normalizedCount(
        ID_NS.anthropic,
        OCCURRENCE_KIND.response,
        'toolu_h',
      ),
    ).toBe(2);
    expect(
      await queries.normalizedCount(
        ID_NS.openai,
        OCCURRENCE_KIND.response,
        'call_h',
      ),
    ).toBe(2);
    expect(
      (
        await queries.normalizedPosition(
          ID_NS.anthropic,
          OCCURRENCE_KIND.response,
          'toolu_h',
          1,
        )
      )?.label,
    ).toBe(10n);
    await fixture.close();
  });
});

describe('Kimi facts', () => {
  const tempDir = useTempDir('id-facts-kimi-');
  const AI = ROW_SPEAKER.ai;
  const HUMAN = ROW_SPEAKER.human;
  const TOOL = ROW_SPEAKER.tool;

  it('keeps the last eligible occurrence and does not let an unnamed duplicate overwrite it', async () => {
    const fixture = await FactFixture.create(path.join(tempDir(), 'ke.llxj'));
    await fixture.append([
      occ('X', 'call', 10, AI, { nameLen: 3 }),
      occ('X', 'call', 20, AI, { nameLen: 0 }),
      occ('X', 'call', 30, HUMAN, { nameLen: 11 }),
      occ('X', 'call', 40, AI, { nameLen: 0 }),
    ]);
    const fact = await fixture.queries().fact('X');
    expect(fact?.lastEligibleCall).toStrictEqual({
      at: { label: 30n, part: 0, block: 0 },
      nameLen: 11,
    });
    expect(fact?.callCount).toBe(4);
    expect(fact?.aiWire).toBe(3);
    expect(fact?.unnamed).toBe(2);
    expect(fact?.nonAiElig).toBe(1);
    const chain = [];
    for (let k = 1; k <= 4; k++)
      chain.push(
        await fixture.queries().occurrence('X', OCCURRENCE_KIND.call, k),
      );
    expect(chain.map((entry) => entry?.eligible)).toStrictEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(chain.map((entry) => entry?.ai)).toStrictEqual([
      true,
      true,
      false,
      true,
    ]);
    await fixture.close();
  });

  it('writes an id to the exception list once, when it first leaves the clean state', async () => {
    const fixture = await FactFixture.create(path.join(tempDir(), 'exc.llxj'));
    await fixture.append([
      occ('clean', 'call', 10, AI),
      occ('clean', 'response', 11, TOOL),
      occ('dup', 'call', 12, AI),
    ]);
    expect(fixture.exceptionCount).toBe(0);
    await fixture.append([
      occ('dup', 'call', 20, AI),
      occ('', 'call', 21, AI),
      occ('dup', 'call', 22, AI),
    ]);
    expect(fixture.exceptionCount).toBe(2);
    await fixture.append([
      occ('unnamed', 'call', 30, AI, { nameLen: 0 }),
      occ('inhuman', 'call', 31, HUMAN),
    ]);
    expect(fixture.exceptionCount).toBe(4);
    const queries = fixture.queries();
    const first = await queries.exceptionHash(0);
    const hasher = fixture.deps.hasher;
    expect(first && hex(first)).toBe(
      hex(hasher(ID_NS.fact, new TextEncoder().encode('dup'))),
    );
    const third = await queries.exceptionHash(2);
    expect(third && hex(third)).toBe(
      hex(hasher(ID_NS.fact, new TextEncoder().encode('unnamed'))),
    );
    expect(isKimiException('clean', await requireFact(queries, 'clean'))).toBe(
      false,
    );
    expect(isKimiException('dup', await requireFact(queries, 'dup'))).toBe(
      true,
    );
    await fixture.close();
  });

  it('does not count a response-only id as an exception', async () => {
    const fixture = await FactFixture.create(
      path.join(tempDir(), 'respexc.llxj'),
    );
    await fixture.append([occ('only', 'response', 10, TOOL)]);
    expect(fixture.exceptionCount).toBe(0);
    await fixture.close();
  });
});

describe('successor queries over occurrence ordinals', () => {
  const tempDir = useTempDir('id-facts-succ-');

  it('finds the first result after a position by binary search over k, in a logarithmic number of lookups', async () => {
    const fixture = await FactFixture.create(path.join(tempDir(), 'succ.llxj'));
    const results = 300;
    const labels = Array.from({ length: results }, (_, at) => 100 + at * 10);
    await fixture.append(
      labels.map((label) =>
        occ('toolu_S', 'response', label, ROW_SPEAKER.tool),
      ),
    );
    const naive = (after: bigint): bigint | undefined =>
      labels.map(BigInt).find((label) => label > after);
    for (const after of [
      0n,
      99n,
      100n,
      101n,
      1500n,
      3089n,
      3090n,
      3091n,
      9999n,
    ]) {
      const queries = fixture.queries();
      const found = await queries.firstAfter(
        ID_NS.anthropic,
        OCCURRENCE_KIND.response,
        'toolu_S',
        { label: after, part: 0, unit: 0 },
      );
      expect(found?.label).toBe(naive(after));
    }
    const counted = fixture.queries();
    const before = counted.lookups;
    await counted.firstAfter(
      ID_NS.anthropic,
      OCCURRENCE_KIND.response,
      'toolu_S',
      {
        label: 1500n,
        part: 0,
        unit: 0,
      },
    );
    expect(counted.lookups - before).toBeLessThanOrEqual(
      Math.ceil(Math.log2(results + 1)) + 2,
    );
    expect(counted.lookups - before).toBeGreaterThan(1);
    await fixture.close();
  });

  it('compares the unit of one row, and answers an absent id with nothing', async () => {
    const fixture = await FactFixture.create(path.join(tempDir(), 'unit.llxj'));
    await fixture.append([
      occ('u', 'response', 10, ROW_SPEAKER.tool, {
        unit: unitAt(10, ROW_SPEAKER.tool, { unit: 0 }),
      }),
      occ('u', 'response', 10, ROW_SPEAKER.tool, {
        unit: unitAt(10, ROW_SPEAKER.tool, { unit: 2 }),
        at: { label: 10n, part: 0, block: 1 },
      }),
    ]);
    const queries = fixture.queries();
    const after = (unit: number) =>
      queries.firstAfter(ID_NS.anthropic, OCCURRENCE_KIND.response, 'toolu_u', {
        label: 10n,
        part: 0,
        unit,
      });
    expect((await after(0))?.unit).toBe(2);
    expect(await after(2)).toBeUndefined();
    expect(
      await queries.firstAfter(
        ID_NS.anthropic,
        OCCURRENCE_KIND.response,
        'toolu_none',
        { label: 0n, part: 0, unit: 0 },
      ),
    ).toBeUndefined();
    expect(
      await queries.lastAtOrAfter(
        ID_NS.anthropic,
        OCCURRENCE_KIND.response,
        'toolu_u',
        { label: 10n, part: 0, unit: 2 },
      ),
    ).toBe(true);
    expect(
      await queries.lastAtOrAfter(
        ID_NS.anthropic,
        OCCURRENCE_KIND.response,
        'toolu_u',
        { label: 10n, part: 0, unit: 3 },
      ),
    ).toBe(false);
    await fixture.close();
  });
});
