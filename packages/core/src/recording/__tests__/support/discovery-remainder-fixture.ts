/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readOnlyJournalRows } from './read-only-journal-rows.js';
import type { IContent } from '../../../services/history/IContent.js';
import type { JournalRecordingConfig } from '../../journalRecordingService.js';
import { journalSeams, PROJECT } from './recordedJournals.js';

export async function remainderDirectory(label: string): Promise<string> {
  const root = resolve(
    import.meta.dir,
    '../../../../../..',
    'tmp/854-notes/p4/w21/discovery-remainder/fixtures',
  );
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, `${label}-`));
}

export function remainderConfig(
  chatsDir: string,
  sessionId: string,
): JournalRecordingConfig {
  return {
    sessionId,
    projectHash: PROJECT,
    chatsDir,
    workspaceDirs: ['/work/a'],
    provider: 'anthropic',
    model: 'model-1',
    journal: journalSeams(),
  };
}

export async function remainderRows(filePath: string): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of readOnlyJournalRows(filePath)) rows.push(row.content);
  return rows;
}
