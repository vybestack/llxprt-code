/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { rootRef } from './groupSegments.js';
import { encodeRowDraft, type RowDraft } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import { readStoredRow, type StoredRow } from './rowReads.js';
import { iterateRowEntries } from './rowTreeReader.js';
import { findChunkEntry } from './chunk-row.js';
import { TranscriptTreeWriter } from './transcript-tree.js';
import type { TranscriptHead } from './transcript-head.js';

/**
 * How the transcript copy of a row changes when the row leaves context. Only
 * entries carrying one of `flags` are read; `revise` returns the row the
 * transcript shows from now on, or undefined to keep the stored one.
 */
export interface TranscriptRevision {
  readonly flags: number;
  revise(row: StoredRow, entry: RowEntry): RowDraft | undefined;
}

/**
 * Writes a new revision of the transcript entry of every row of the published
 * version whose transcript id is no longer a member of the built context
 * (design 16.3), whatever label a retained body is selected under now. The previous
 * rows stream from the row tree; only rows with `revision.flags` are read, and
 * each revised row is one new `ROW` under its own label plus the changed path
 * of the transcript tree, so nothing history-sized is held.
 */
export async function reviseRemovedTranscript(
  ctx: BuildContext,
  target: RecordAppender,
  built: BuiltGroup,
  head: TranscriptHead,
  revision: TranscriptRevision,
  inContext: (transcriptId: bigint) => Promise<boolean>,
): Promise<TranscriptHead> {
  const { published, access } = ctx;
  const previous = published === undefined ? undefined : rootRef(published);
  if (
    previous === undefined ||
    access === undefined ||
    built.state.rowRoot === previous.offset
  )
    return head;
  const read = () => ctx.readGroup(target.nextOffset);
  const tree = new TranscriptTreeWriter(read, target, 'transcript');
  let revised = head;
  const revisedDraft = async (entry: RowEntry) => {
    if ((entry.flags & revision.flags) === 0) return undefined;
    if (await inContext(entry.transcriptId)) return undefined;
    return revision.revise(await readStoredRow(access, entry), entry);
  };
  for await (const entry of iterateRowEntries(access, previous)) {
    const draft = await revisedDraft(entry);
    if (draft === undefined) continue;
    const encoded = encodeRowDraft(entry.label, draft);
    const rowRef = await target.append(encoded.record);
    await target.drain();
    const stored = await findChunkEntry(
      read(),
      revised.root,
      'transcript',
      entry.transcriptId,
    );
    const root = await tree.insert(revised.root, {
      ...stored,
      rowRef,
      recordLength: encoded.recordLength,
      revision: stored.revision + 1,
    });
    await target.drain();
    revised = {
      ...revised,
      root,
      reachableBytes: revised.reachableBytes + encoded.recordLength + 64,
    };
  }
  return revised;
}
