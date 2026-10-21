/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  encodeCountValue,
  decodeCountValue,
  encodeUnitPositionValue,
  decodeUnitPositionValue,
} from './idEntryCodecs.js';
import type { IdFactBatch } from './idFactBatch.js';
import type { IdFactQueries } from './idFactQueries.js';
import { ID_NS } from './idKeys.js';
import { ROW_ENTRY_NO_CHRONOLOGY_SEQ } from './rowEntry.js';
import { ROW_FLAG } from './rowRecord.js';
import { JournalFormatError } from './errors.js';

const utf8 = new TextEncoder();
function key(seq: bigint, curated: boolean, ordinal: number): Uint8Array {
  return utf8.encode(`${seq}:${Number(curated)}:${ordinal}`);
}

export class ChronologyFacts {
  constructor(private readonly facts: IdFactQueries) {}

  async count(seq: bigint, curated: boolean): Promise<number> {
    const bytes = await this.facts.getEntry(
      ID_NS.chronology,
      key(seq, curated, 0),
    );
    return bytes === undefined ? 0 : decodeCountValue(bytes);
  }

  async label(
    seq: bigint,
    curated: boolean,
    ordinal: number,
  ): Promise<bigint | undefined> {
    const bytes = await this.facts.getEntry(
      ID_NS.chronology,
      key(seq, curated, ordinal),
    );
    return bytes === undefined
      ? undefined
      : decodeUnitPositionValue(bytes).label;
  }

  async inRange(seq: bigint, from: bigint, to: bigint): Promise<boolean> {
    let low = 1;
    let high = (await this.count(seq, true)) + 1;
    let found: bigint | undefined;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const label = await this.label(seq, true, middle);
      if (label === undefined)
        throw new JournalFormatError('Missing chronology occurrence');
      if (label >= from) {
        found = label;
        high = middle;
      } else low = middle + 1;
    }
    return found !== undefined && found < to;
  }
}

export async function applyChronologyFact(
  batch: IdFactBatch,
  label: bigint,
  seq: bigint,
  flags: number,
): Promise<void> {
  if (seq === ROW_ENTRY_NO_CHRONOLOGY_SEQ) return;
  const facts = new ChronologyFacts(batch.queries);
  for (const curated of (flags & ROW_FLAG.curated) === 0
    ? [false]
    : [false, true]) {
    const count = await facts.count(seq, curated);
    await batch.setEntry(
      ID_NS.chronology,
      key(seq, curated, count + 1),
      encodeUnitPositionValue({ label, unit: 0, part: 0 }),
    );
    await batch.setEntry(
      ID_NS.chronology,
      key(seq, curated, 0),
      encodeCountValue(count + 1),
    );
  }
}
