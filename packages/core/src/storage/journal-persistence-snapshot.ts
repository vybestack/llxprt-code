/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open, rename, rm, stat, mkdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JournalResolver } from '../recording/journalResolver.js';
import type { JournalReadCounters } from '../recording/journalCounters.js';
import type { IContent } from '../services/history/IContent.js';
import type { PersistedSession } from './SessionPersistenceService.js';

export interface SnapshotWriteObservation {
  readonly counters?: JournalReadCounters;
  readonly observeRow?: (content: IContent, encoded: string) => void;
  readonly writeFile?: (file: FileHandle, data: string) => Promise<void>;
}

export async function saveJournalSnapshot(
  journal: string,
  target: string,
  session: PersistedSession,
  observation?: SnapshotWriteObservation,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const watermark = (await stat(journal)).size;
  const resolver = await JournalResolver.open(journal, {
    maxBytes: watermark,
    counters: observation?.counters,
  });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      const { history: _history, ...header } = session;
      const writeFile = (data: string): Promise<void> =>
        observation?.writeFile?.(file, data) ?? file.writeFile(data);
      await writeFile(`${JSON.stringify(header).slice(0, -1)},"history":[`);
      let separator = '';
      for await (const entry of resolver.resolve()) {
        const encoded = `${separator}${JSON.stringify(entry.content)}`;
        observation?.observeRow?.(entry.content, encoded);
        await writeFile(encoded);
        separator = ',';
      }
      await writeFile(']}');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
  } finally {
    await resolver.close();
    await rm(temporary, { force: true });
  }
}
