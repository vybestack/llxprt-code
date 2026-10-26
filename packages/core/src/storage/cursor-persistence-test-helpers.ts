/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { dirname, join } from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import { JournalSession } from '../services/history/journalSession.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import { NativeRecordingProbe } from './native-recording-probe.test-support.js';

export async function createCursorJournal(
  history: HistoryService,
  sessionId: string,
) {
  const path = history.journalPath();
  if (path === null) throw new Error('Missing persistence fixture journal');
  const probe = new NativeRecordingProbe();
  const session = await JournalSession.create(
    join(dirname(path), `${sessionId}.llxj`),
    probe.options,
  );
  return { session, probe };
}

export async function replaceJournalRows(
  session: JournalSession,
  rows: AsyncIterable<IContent>,
): Promise<void> {
  async function* drafts() {
    for await (const row of rows) yield encodeContentRow(row, { owner: 0 });
  }
  await session.store.commit([{ kind: 'replace', rows: drafts() }]);
}

export async function journalHistoryDigest(
  session: JournalSession,
): Promise<string> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update('[');
  let separator = '';
  for await (const { content } of session.rows()) {
    hash.update(separator).update(JSON.stringify(content));
    separator = ',';
  }
  return hash.update(']').digest('hex');
}
