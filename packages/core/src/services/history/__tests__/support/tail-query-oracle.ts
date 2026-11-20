/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import {
  normalizeToAnthropicToolId,
  normalizeToOpenAIToolId,
} from '@vybestack/llxprt-code-tools';
import type {
  NormalizedFamily,
  OccurrenceKind,
} from '../../../../journal/idKeys.js';
import { DebugLogger } from '../../../../debug/index.js';
import type { IndexedJournalRequestSnapshot } from '../../indexed-journal-request-snapshot.js';
import { buildProviderContent } from '../../historyProviderPipeline.js';
import { isCuratedContent } from '../../historyCuration.js';
import type { ContentBlock, IContent } from '../../IContent.js';

function rawId(block: ContentBlock): string | undefined {
  if (block.type === 'tool_call') return block.id;
  if (block.type === 'tool_response') return block.callId;
  return undefined;
}

function expectedPositions(
  units: readonly IContent[],
  normalize: (id: string) => string,
  kind: OccurrenceKind,
  id: string,
): readonly number[] {
  const speaker = kind === 0 ? 'ai' : 'tool';
  const type = kind === 0 ? 'tool_call' : 'tool_response';
  return units.flatMap((unit, index) =>
    unit.blocks.flatMap((block) => {
      if (unit.speaker !== speaker || block.type !== type) return [];
      const raw = rawId(block);
      return raw !== undefined && normalize(raw) === id ? [index] : [];
    }),
  );
}

async function assertList(
  indexed: IndexedJournalRequestSnapshot,
  units: readonly IContent[],
  family: NormalizedFamily,
  kind: OccurrenceKind,
  id: string,
): Promise<void> {
  const normalize =
    family === 1 ? normalizeToOpenAIToolId : normalizeToAnthropicToolId;
  const positions = expectedPositions(units, normalize, kind, id);
  for (let from = 0; from <= units.length; from++) {
    const expected = positions.filter((position) => position >= from);
    const range = { from, to: units.length };
    expect(await indexed.normalizedCount(family, kind, id, range)).toBe(
      expected.length,
    );
    expect(await indexed.lastAtOrAfter(family, kind, id, from, range)).toBe(
      expected.length > 0,
    );
    expect(await indexed.firstAfter(family, kind, id, from - 1, range)).toBe(
      expected[0],
    );
    expect(await indexed.firstAfter(family, kind, id, from, range)).toBe(
      expected.find((position) => position > from),
    );
    expect(await indexed.lastAtOrAfter(family, kind, id, from + 1, range)).toBe(
      expected.some((position) => position >= from + 1),
    );
    const actual: number[] = [];
    for await (const position of indexed.normalizedRange(
      family,
      kind,
      id,
      range,
    ))
      actual.push(position);
    expect(actual).toStrictEqual(expected);
    for (let ordinal = 1; ordinal <= expected.length + 1; ordinal++)
      expect(
        await indexed.normalizedPosition(family, kind, id, ordinal, range),
      ).toBe(expected[ordinal - 1]);
  }
  for (let to = 0; to <= units.length; to++) {
    const range = { from: 0, to };
    expect(await indexed.normalizedCount(family, kind, id, range)).toBe(
      positions.filter((position) => position < to).length,
    );
    expect(
      await indexed.firstAfter(family, kind, id, to - 1, range),
    ).toBeUndefined();
  }
}

export async function assertTailQueries(
  indexed: IndexedJournalRequestSnapshot,
  units: readonly IContent[],
  rows: readonly IContent[],
): Promise<void> {
  expect(indexed.count).toBe(units.length);
  const families: readonly NormalizedFamily[] = [1, 2];
  const kinds: readonly OccurrenceKind[] = [0, 1];
  const rawIds = rows.flatMap((row) =>
    row.blocks.flatMap((block) => {
      const raw = rawId(block);
      return raw === undefined ? [] : [raw];
    }),
  );
  for (const family of families) {
    const normalize =
      family === 1 ? normalizeToOpenAIToolId : normalizeToAnthropicToolId;
    const ids = new Set(['missing', ...rawIds.map(normalize)]);
    for (const kind of kinds)
      for (const id of ids) await assertList(indexed, units, family, kind, id);
  }
}

export async function oldTailUnits(
  rows: readonly IContent[],
  tail: readonly IContent[],
): Promise<readonly IContent[]> {
  return buildProviderContent(
    rows.filter(isCuratedContent),
    [...tail],
    new DebugLogger('tail-query-oracle'),
  );
}
