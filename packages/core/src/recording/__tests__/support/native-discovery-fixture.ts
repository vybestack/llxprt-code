/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { JournalSession } from '../../../services/history/journalSession.js';
import { encodeSessionFact } from '../../sessionMetaKeys.js';
import { journalSeams } from './recordedJournals.js';

export async function discoveryDirectory(label: string): Promise<string> {
  const root = resolve(
    import.meta.dir,
    '../../../../../..',
    'tmp/854-notes/p4/w21/discovery/fixtures',
  );
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, `${label}-`));
}

export async function replaceFact(
  filePath: string,
  key: string,
  value: unknown,
): Promise<void> {
  const session = await JournalSession.open(filePath, journalSeams());
  try {
    await session.store.commit([
      { kind: 'setState', key, value: encodeSessionFact(value) },
    ]);
  } finally {
    await session.close();
  }
}

export const START_FACT = {
  startTime: '2026-10-19T00:00:00.000Z',
  projectHash: 'project-hash',
  workspaceDirs: ['/work/雪', '/work/second'],
  kind: 'main',
};
