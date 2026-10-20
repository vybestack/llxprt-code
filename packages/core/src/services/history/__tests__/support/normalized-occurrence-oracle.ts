/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import {
  normalizeToAnthropicToolId,
  normalizeToOpenAIToolId,
} from '@vybestack/llxprt-code-tools';
import type { VersionSnapshot } from '../../../../journal/versionSnapshot.js';
import type { UnitPosition } from '../../../../journal/idEntryCodecs.js';
import { ROW_BLOCK_TYPE, ROW_SPEAKER } from '../../../../journal/rowRecord.js';
import type { ContentBlock, IContent } from '../../IContent.js';
import type {
  NormalizedFamily,
  OccurrenceKind,
} from '../../../../journal/idKeys.js';

const families: readonly NormalizedFamily[] = [1, 2];
const kinds: readonly OccurrenceKind[] = [0, 1];

function sourceId(block: ContentBlock): string | undefined {
  if (block.type === 'tool_call') return block.id;
  if (block.type === 'tool_response') return block.callId;
  return undefined;
}

function emittedId(
  unit: IContent,
  block: ContentBlock,
  kind: OccurrenceKind,
): string | undefined {
  if (kind === 0) {
    return unit.speaker === 'ai' && block.type === 'tool_call'
      ? block.id
      : undefined;
  }
  return unit.speaker === 'tool' && block.type === 'tool_response'
    ? block.callId
    : undefined;
}

async function unitPositions(
  snapshot: VersionSnapshot,
  count: number,
): Promise<UnitPosition[]> {
  const positions: UnitPosition[] = [];
  for (let index = 0; index < count; index++) {
    const selected = await snapshot.unitAt(index);
    const ids = await snapshot.readIds(selected.entry);
    const split =
      ids.header.speaker === ROW_SPEAKER.tool &&
      ids.header.blocks.some(
        (block) => block.type === ROW_BLOCK_TYPE.tool_call,
      );
    const part0 = 1 + Number(selected.entry.answered > 0);
    const part = split && selected.unit >= part0 ? 1 : 0;
    positions.push({
      label: selected.entry.label,
      part,
      unit: selected.unit - (part === 1 ? part0 : 0),
    });
  }
  return positions;
}

function expectedOccurrences(
  units: readonly IContent[],
  sourceRows: readonly IContent[],
  positions: readonly UnitPosition[],
  family: NormalizedFamily,
  kind: OccurrenceKind,
): ReadonlyMap<string, readonly UnitPosition[]> {
  const normalize =
    family === 1 ? normalizeToOpenAIToolId : normalizeToAnthropicToolId;
  const expected = new Map<string, UnitPosition[]>();
  for (const row of sourceRows) {
    for (const block of row.blocks) {
      const raw = sourceId(block);
      if (raw !== undefined) expected.set(normalize(raw), []);
    }
  }
  for (const [index, unit] of units.entries()) {
    for (const block of unit.blocks) {
      const raw = emittedId(unit, block, kind);
      if (raw === undefined) continue;
      const id = normalize(raw);
      const list = expected.get(id) ?? [];
      list.push(positions[index]);
      expected.set(id, list);
    }
  }
  return expected;
}

async function assertList(
  snapshot: VersionSnapshot,
  family: NormalizedFamily,
  kind: OccurrenceKind,
  id: string,
  list: readonly UnitPosition[],
): Promise<void> {
  expect(await snapshot.facts.normalizedCount(family, kind, id)).toBe(
    list.length,
  );
  for (const [index, at] of list.entries()) {
    expect(
      await snapshot.facts.normalizedPosition(family, kind, id, index + 1),
    ).toStrictEqual(at);
  }
}

export async function assertNormalizedOccurrences(
  snapshot: VersionSnapshot,
  units: readonly IContent[],
  sourceRows: readonly IContent[],
): Promise<void> {
  const positions = await unitPositions(snapshot, units.length);
  for (const family of families) {
    for (const kind of kinds) {
      const expected = expectedOccurrences(
        units,
        sourceRows,
        positions,
        family,
        kind,
      );
      for (const [id, list] of expected)
        await assertList(snapshot, family, kind, id, list);
    }
  }
}
