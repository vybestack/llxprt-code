/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { IContent } from '../services/history/IContent.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import type { HistoryService } from '../services/history/HistoryService.js';
import {
  SessionPersistenceService,
  type SessionPersistenceServiceOptions,
} from './SessionPersistenceService.js';

class SnapshotTestStorage extends Storage {
  constructor(private readonly directory: string) {
    super(directory);
  }
  override getProjectTempDir(): string {
    return this.directory;
  }
}

export function createCursorPersistence(
  history: HistoryService,
  sessionId: string,
  options: SessionPersistenceServiceOptions = {},
): SessionPersistenceService {
  const journal = history.journalPath();
  if (journal === null) throw new Error('Missing persistence fixture journal');
  return new SessionPersistenceService(
    new SnapshotTestStorage(dirname(journal)),
    sessionId,
    options,
  );
}

export async function seedCursorPersistence(
  persistence: SessionPersistenceService,
  row: IContent,
): Promise<string> {
  const expected = JSON.stringify({
    version: 1,
    generation: 1,
    sessionId: 'independent-cursor-fixture',
    projectHash: 'cursor-fixture',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    history: [row],
  });
  await mkdir(persistence.getChatsDir(), { recursive: true });
  await writeFile(persistence.getSessionFilePath(), expected, 'utf8');
  return expected;
}
