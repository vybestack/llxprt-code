/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { UnitPosition } from './idEntryCodecs.js';
import type { IdFactQueries } from './idFactQueries.js';
import { compareUnitPositions } from './idFactUpdate.js';
import type { NormalizedFamily, OccurrenceKind } from './idKeys.js';

export interface NormalizedListEdit {
  readonly family: NormalizedFamily;
  readonly kind: OccurrenceKind;
  readonly id: string;
  readonly label: bigint;
  readonly positions: readonly UnitPosition[];
}

export interface NormalizedListWriter {
  freeze(): Promise<IdFactQueries>;
  position(ordinal: number, at: UnitPosition): Promise<void>;
  count(value: number): void;
}

export async function replaceNormalizedRow(
  queries: IdFactQueries,
  edit: NormalizedListEdit,
  writer: NormalizedListWriter,
): Promise<void> {
  const { family, kind, id, label, positions } = edit;
  const count = await queries.normalizedCount(family, kind, id);
  async function read(
    view: IdFactQueries,
    ordinal: number,
  ): Promise<UnitPosition> {
    const at = await view.normalizedPosition(family, kind, id, ordinal);
    if (at === undefined)
      throw new JournalFormatError('Missing counted normalized occurrence');
    return at;
  }
  async function boundary(inclusive: boolean): Promise<number> {
    let low = 1;
    let high = count + 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const at = await read(queries, middle);
      if (at.label < label || (inclusive && at.label === label))
        low = middle + 1;
      else high = middle;
    }
    return low;
  }
  const afterTail = count === 0 || (await read(queries, count)).label < label;
  const first = afterTail ? count + 1 : await boundary(false);
  const end = afterTail ? count + 1 : await boundary(true);
  const removed = end - first;
  let unchanged = removed === positions.length;
  for (let index = 0; unchanged && index < positions.length; index++) {
    unchanged =
      compareUnitPositions(
        await read(queries, first + index),
        positions[index],
      ) === 0;
  }
  if (unchanged) return;
  const shift = positions.length - removed;
  const original =
    shift !== 0 && end <= count ? await writer.freeze() : undefined;
  for (const [index, at] of positions.entries())
    await writer.position(first + index, at);
  if (original !== undefined) {
    for (let ordinal = end; ordinal <= count; ordinal++) {
      await writer.position(ordinal + shift, await read(original, ordinal));
    }
  }
  writer.count(count + shift);
}
