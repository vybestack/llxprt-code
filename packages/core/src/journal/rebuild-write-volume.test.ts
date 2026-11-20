/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { testNamedWriters } from './__tests__/support/namedWriterOwner.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { decodeFrameStart } from './frame.js';
import { JournalStore } from './journalStore.js';
import { RECORD_KIND } from './recordKinds.js';
import { ROW_SPEAKER } from './rowRecord.js';
import type { RowDraft } from './rowDraft.js';

const SPEAKERS = [ROW_SPEAKER.human, ROW_SPEAKER.ai, ROW_SPEAKER.tool];

/** Every row carries one tool call id, so each row adds id facts to the rebuild. */
function* rows(count: number): Generator<RowDraft> {
  for (let index = 0; index < count; index++)
    yield draftRow({
      speaker: SPEAKERS[index % SPEAKERS.length],
      text: `${index}`,
      calls: [`call-${index}`],
      responses: [`call-${index}`],
    });
}

interface WriteVolume {
  readonly written: number;
  readonly rowBytes: number;
}

/** Sums the frames written from `from` on, by kind. */
function volumeAfter(file: string, from: number): WriteVolume {
  const bytes = readFileSync(file);
  let offset = Math.max(from, JOURNAL_HEADER_BYTES);
  let rowBytes = 0;
  while (offset < bytes.length) {
    const head = decodeFrameStart(bytes.subarray(offset), offset);
    if (head.kind === RECORD_KIND.ROW) rowBytes += head.endOffset - offset;
    offset = head.endOffset;
  }
  return { written: bytes.length - from, rowBytes };
}

async function rebuildVolume(file: string, count: number) {
  const store = await JournalStore.create(
    file,
    storeDeps({
      seams: testJournalSeams({}, 1, false),
      compactionDue: () => false,
    }),
    testNamedWriters,
  );
  const before = statSync(file).size;
  try {
    await store.commit([{ kind: 'replace', rows: rows(count) }]);
  } finally {
    await store.close();
  }
  return volumeAfter(file, before);
}

/**
 * What a rebuild may write beyond the rows, per row that carries one id: the
 * fact's leaf, its id-trie path and its share of the first sorted spill run.
 */
const PER_ID_FACT_BYTES = 3 * 1024;
/** One more rewrite of a fact in a merged run, paid once per eightfold growth. */
const PER_RUN_REWRITE_BYTES = 512;
const RUN_FAN_IN = 8;

function overheadBound(count: number): number {
  return (
    PER_ID_FACT_BYTES +
    PER_RUN_REWRITE_BYTES * (Math.log(count) / Math.log(RUN_FAN_IN))
  );
}

/**
 * Design 4.6 rebuilds the whole history on compression, density, replace,
 * purge and profile adoption, so its write volume is a production cost. Rows
 * are written once; everything else a rebuild writes is per id fact (the id
 * trie, its sorted spill runs and their merges). Two-way run merges rewrote
 * every fact once per doubling, so the overhead per row grew with log2 of the
 * history; eight-way merges keep it to the log8 term.
 */
describe('rebuild write volume', () => {
  const dir = useTempDir('rebuild-volume-');

  it.each([512, 8192])(
    'writes %i rows once plus a per-id-fact overhead that grows only with log8 of the row count',
    async (count) => {
      const volume = await rebuildVolume(
        path.join(dir(), `rows-${count}.llxj`),
        count,
      );
      expect(volume.rowBytes).toBeGreaterThan(0);
      expect(volume.written).toBeLessThanOrEqual(
        volume.rowBytes + count * overheadBound(count),
      );
    },
    60_000,
  );
});
