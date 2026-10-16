/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ROW_ENTRY_NO_CHRONOLOGY_SEQ, type RowEntry } from '../../rowEntry.js';
import { SLOT_SUMMARY_BYTES } from '../../slotSummary.js';

const EMPTY_SUMMARY = new Uint8Array(SLOT_SUMMARY_BYTES);
const STAMP = { gen: 1, imageGen: 1 };

/**
 * A small synthetic row for the big builds: label `(index + 1) * 1000` and no
 * summaries. Each call allocates a new object, so a consumer that keeps the
 * entries it is given really holds them.
 */
export function cheapEntry(index: number): RowEntry {
  return {
    label: BigInt(index + 1) * 1000n,
    recordOffset: 4096 + index * 64,
    recordLength: 64,
    speaker: index % 3,
    flags: 1,
    reconBlocks: 0,
    answered: 0,
    chronologySeq: ROW_ENTRY_NO_CHRONOLOGY_SEQ,
    chronologyUserTurn: index % 1000,
    chronologyStep: 0,
    chronologyRecordedAt: 1_900_000_000_000,
    owner: index % 4,
    callBlocks: 0,
    unmappedBlocks: 0,
    lensRef: [0, 0, 0],
    summary: [EMPTY_SUMMARY, EMPTY_SUMMARY, EMPTY_SUMMARY],
    media: { mediaChars: 0, imageChars: [0, 0, 0], pdfBytes: [0, 0, 0] },
    tokens: [
      [1, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    stamp: [STAMP, STAMP, STAMP],
  };
}

export function* cheapEntries(count: number): Generator<RowEntry> {
  for (let index = 0; index < count; index++) yield cheapEntry(index);
}
