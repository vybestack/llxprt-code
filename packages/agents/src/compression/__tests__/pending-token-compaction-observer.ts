/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import { expect, spyOn } from 'bun:test';
import {
  compactionCandidatePath,
  compactionDue,
} from '@vybestack/llxprt-code-core/journal/compaction.js';
import { versionOf } from '@vybestack/llxprt-code-core/journal/version.js';
import type { JournalStore } from '@vybestack/llxprt-code-core/journal/journalStore.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { readStoredRow } from '@vybestack/llxprt-code-core/journal/rowReads.js';
import { iterateRowEntries } from '@vybestack/llxprt-code-core/journal/rowTreeReader.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  operationFileCreates,
  type OperationFileCreates,
} from './support/operation-file-creates.js';

export async function observePendingCompaction(
  recording: JournalStore,
  operation: () => Promise<void>,
): Promise<OperationFileCreates> {
  const path = recording.path;
  const candidate = compactionCandidatePath(path);
  const oldReader = await openJournalReadOnly(path);
  const trailer = oldReader.trailer;
  if (trailer === undefined) throw new Error('Missing initial recording');
  const root = { offset: trailer.rowRoot, rows: versionOf(trailer).rows };
  async function* oldRows() {
    for await (const entry of iterateRowEntries(oldReader, root))
      yield decodeStoredRow(await readStoredRow(oldReader, entry));
  }
  const oldValues = await compressionValueDigest(oldRows());
  const rename = fs.rename;
  let swaps = 0;
  const observer = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    expect(String(from)).toBe(candidate);
    expect(String(to)).toBe(path);
    const version = recording.published;
    if (version === undefined) throw new Error('Missing compaction version');
    expect(compactionDue(version)).toBe(true);
    const before = await openJournalReadOnly(path);
    const copied = await openJournalReadOnly(candidate);
    try {
      const source = before.trailer;
      const target = copied.trailer;
      if (source === undefined || target === undefined)
        throw new Error('Missing compaction trailer');
      expect(target.commitSeq).toBe(source.commitSeq);
      expect(target.groupTag).toBe(source.groupTag);
      expect(target.rootAggregate).toStrictEqual(source.rootAggregate);
      expect(copied.header.fileId).not.toStrictEqual(before.header.fileId);
      expect(copied.fileSize).toBeLessThan(before.fileSize);
      process.stdout.write(
        `PENDING_COMPACTION_SWAP ${JSON.stringify({ path, candidate, beforeBytes: before.fileSize, afterBytes: copied.fileSize, commitSeq: copied.trailer?.commitSeq, groupTag: String(copied.trailer?.groupTag), beforeFileId: Buffer.from(before.header.fileId).toString('hex'), afterFileId: Buffer.from(copied.header.fileId).toString('hex') })}\n`,
      );
      await rename(from, to);
      swaps++;
    } finally {
      await before.close();
      await copied.close();
    }
  });
  try {
    const files = await operationFileCreates(async () => {
      await operation();
      await recording.idle();
    });
    expect(swaps).toBe(1);
    expect(files).toStrictEqual({ directories: [], files: [candidate] });
    expect(await compressionValueDigest(oldRows())).toStrictEqual(oldValues);
    return files;
  } finally {
    observer.mockRestore();
    await oldReader.close();
  }
}
