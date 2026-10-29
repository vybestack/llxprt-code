/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ChronologyFacts } from '../../journal/chronologyFacts.js';
import { JournalFormatError } from '../../journal/errors.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { ROW_ENTRY_NO_CHRONOLOGY_SEQ } from '../../journal/rowEntry.js';
import type {
  CompressionChronologySelection,
  CompressionSpanAnnotation,
} from './compressionChronology.js';
import type { ContentMetadata } from './IContent.js';
import { decodeStoredRow } from './journalRowCodec.js';

async function isFirst(
  facts: ChronologyFacts,
  seq: bigint,
  label: bigint,
): Promise<boolean> {
  if (seq === ROW_ENTRY_NO_CHRONOLOGY_SEQ) return false;
  const first = await facts.label(seq, false, 1);
  if (first === undefined)
    throw new JournalFormatError('Journal chronology facts require a rebuild');
  return first === label;
}

export async function journalCompressionSpan(
  snapshot: VersionSnapshot,
  selection: CompressionChronologySelection,
  hasFrontier: boolean,
  signal?: AbortSignal,
): Promise<CompressionSpanAnnotation> {
  signal?.throwIfAborted();
  const facts = new ChronologyFacts(snapshot.facts);
  const ranges: Array<{ readonly from: bigint; readonly to: bigint }> = [];
  for (const range of selection.ranges) {
    const first = await snapshot.entryAt(range.from);
    const to =
      range.to === snapshot.rows
        ? snapshot.version?.nextLabel
        : (await snapshot.entryAt(range.to)).label;
    if (to === undefined)
      throw new JournalFormatError('Missing compression range boundary');
    ranges.push({ from: first.label, to });
  }
  let fromSeq = Number.POSITIVE_INFINITY;
  let toSeq = Number.NEGATIVE_INFINITY;
  let itemCount = 0;
  let frontier: ContentMetadata['semanticMediaPurgeFrontier'];
  for await (const entry of snapshot.entries()) {
    signal?.throwIfAborted();
    frontier ??= decodeStoredRow(await snapshot.readMetadata(entry)).metadata
      ?.semanticMediaPurgeFrontier;
    const seq = entry.chronologySeq;
    if (!(await isFirst(facts, seq, entry.label))) continue;
    let preserved = selection.generated.some(
      (row) => row.metadata?.chronology?.seq === Number(seq),
    );
    for (const range of ranges) {
      if (preserved) break;
      preserved = await facts.inRange(seq, range.from, range.to);
    }
    if (!preserved) {
      itemCount++;
      fromSeq = Math.min(fromSeq, Number(seq));
      toSeq = Math.max(toSeq, Number(seq));
    }
  }
  signal?.throwIfAborted();
  return { span: { fromSeq, toSeq, itemCount }, frontier, hasFrontier };
}
