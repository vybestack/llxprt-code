/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { testJournalSeams } from '../../../journal/__tests__/support/journalFixtures.js';
import type { IContent } from '../../../services/history/IContent.js';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from '../../journalRecordingService.js';

export const PROJECT = 'project-hash';

export function userRow(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

export interface RecordedJournal {
  readonly sessionId: string;
  readonly filePath: string;
}

export interface RecordOptions {
  readonly rows?: readonly IContent[];
  readonly projectHash?: string;
  readonly provider?: string;
  readonly title?: string;
  readonly kind?: 'main' | 'subagent';
  /** Sets the file's modification time, so the listing order is known. */
  readonly modifiedAt?: Date;
}

export function journalSeams(): JournalRecordingConfig['journal'] {
  return { journal: testJournalSeams().dependencies };
}

/** Writes a session journal the way the recorder does, then closes it. */
export async function recordJournal(
  chatsDir: string,
  sessionId: string,
  options: RecordOptions = {},
): Promise<RecordedJournal> {
  const recording = JournalRecordingService.create({
    sessionId,
    projectHash: options.projectHash ?? PROJECT,
    chatsDir,
    workspaceDirs: ['/work/a'],
    provider: options.provider ?? 'anthropic',
    model: 'model-1',
    kind: options.kind ?? 'main',
    journal: journalSeams(),
  });
  let filePath: string | null;
  try {
    const session = await recording.session();
    if (options.title !== undefined) {
      recording.recordSessionMetadata(options.title);
    }
    if (options.rows !== undefined && options.rows.length > 0) {
      await session.append(options.rows);
    }
    await recording.flush();
    filePath = recording.getFilePath();
  } catch (error) {
    await recording.dispose().catch(() => undefined);
    throw error;
  }
  await recording.dispose();
  if (filePath === null) throw new Error('The recorder wrote no file');
  if (options.modifiedAt !== undefined) {
    await fsp.utimes(filePath, options.modifiedAt, options.modifiedAt);
  }
  return { sessionId, filePath };
}

export function chatsDirIn(root: string): string {
  return path.join(root, 'chats');
}
