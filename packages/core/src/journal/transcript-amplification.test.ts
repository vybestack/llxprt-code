/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { openJournalReadOnly } from './journalReader.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { RECORD_KIND } from './recordKinds.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function* rows(count: number) {
  for (let index = 0; index < count; index++)
    yield draftRow({ text: `row ${index}` });
}

describe('transcript commit-group amplification', () => {
  const directory = useTempDir('transcript-amplification-');
  it('writes completed leaves once and retains only the changed right path across groups', async () => {
    const file = join(directory(), 'history.llxj');
    const count = 4096;
    const store = await JournalStore.create(file, storeDeps());
    try {
      await store.commit([{ kind: 'replace', rows: rows(count) }]);
      await store.commit([{ kind: 'append', rows: [...rows(33)] }]);
    } finally {
      await store.close();
    }
    const journal = await openJournalReadOnly(file);
    try {
      let bytes = 0;
      let offset = JOURNAL_HEADER_BYTES;
      while (offset < journal.fileSize) {
        const head = await journal.readRecordHead(offset);
        if (head.kind === RECORD_KIND.TNODE && head.kindHeader[0] === 0)
          bytes += head.endOffset - offset;
        offset = head.endOffset;
      }
      process.stderr.write(
        `transcript index: ${bytes} bytes, ${bytes / (count + 33)} bytes/row; file ${journal.fileSize} bytes\n`,
      );
      expect(bytes).toBeLessThan((count + 33) * 96 + 2 * 4096);
      const transcript = new TranscriptReader(journal, sha256KeyHash);
      const last = await transcript.page({ direction: 'backward', limit: 50 });
      expect(last[0].transcriptId).toBe(BigInt(count + 33));
      expect(last[49].transcriptId).toBe(BigInt(count + 33 - 49));
    } finally {
      await journal.close();
    }
  });
});
