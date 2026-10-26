/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from '../services/history/journalSession.js';
import { openJournalReadOnly } from './journalReader.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('arrival process crash', () => {
  const directory = useTempDir('arrival-crash-');
  it('recovers the acknowledged prefix after SIGKILL with real platform flushes', async () => {
    const path = join(directory(), 'crashed.llxj');
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, '__tests__/support/arrival-crash-worker.ts'),
        path,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    try {
      const reader = child.stdout.getReader();
      const ready = await reader.read();
      expect(new TextDecoder().decode(ready.value)).toBe('durable-prefix\n');
      reader.releaseLock();
      child.kill('SIGKILL');
      await child.exited;
      const session = await JournalSession.open(path);
      await session.close();
      const journal = await openJournalReadOnly(path);
      try {
        const transcript = new TranscriptReader(journal, sha256KeyHash);
        const entries = await transcript.page({
          direction: 'forward',
          limit: 10,
        });
        expect(entries).toHaveLength(1);
        expect(entries[0].status).toBe(4);
        const row = await transcript.readRow(entries[0]);
        expect(new TextDecoder().decode(row.blocks[0])).toBe(
          'acknowledged content',
        );
        expect(journal.trailer?.rootAggregate.rows).toBe(0);
      } finally {
        await journal.close();
      }
    } finally {
      child.kill('SIGKILL');
      await child.exited;
    }
  });
});
