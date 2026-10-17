/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { testJournalSeams } from '../../../journal/__tests__/support/journalFixtures.js';
import type { RecordingCheckpointInfo } from '../../types.js';
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
  /** The checkpoints made, in order, deleted ones included. */
  readonly checkpoints: readonly RecordingCheckpointInfo[];
}

export interface RecordOptions {
  readonly rows?: readonly IContent[];
  readonly projectHash?: string;
  readonly provider?: string;
  readonly title?: string;
  readonly name?: string;
  readonly kind?: 'main' | 'subagent';
  /** Checkpoint names created after the rows, each of the version the rows left. */
  readonly checkpoints?: readonly string[];
  /** The first-user-message preview the history store would have offered. */
  readonly preview?: string;
  /** Rows appended after the checkpoints, so a checkpoint names an earlier version. */
  readonly rowsAfterCheckpoints?: readonly IContent[];
  /** Names among `checkpoints` that are deleted again. */
  readonly deleteCheckpoints?: readonly string[];
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
  const checkpoints: RecordingCheckpointInfo[] = [];
  try {
    const session = await recording.session();
    if (options.title !== undefined) {
      recording.recordSessionMetadata(options.title);
    }
    if (options.name !== undefined)
      await recording.setSessionName(options.name);
    if (options.rows !== undefined && options.rows.length > 0) {
      await session.append(options.rows);
    }
    if (options.preview !== undefined) {
      recording.recordFirstUserPreview(options.preview);
    }
    for (const name of options.checkpoints ?? []) {
      checkpoints.push(await recording.createCheckpoint(name));
    }
    for (const info of checkpoints) {
      if (options.deleteCheckpoints?.includes(info.name) === true) {
        await recording.deleteCheckpoint(info.checkpointId);
      }
    }
    if (options.rowsAfterCheckpoints !== undefined) {
      await session.append(options.rowsAfterCheckpoints);
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
  return { sessionId, filePath, checkpoints };
}

export function chatsDirIn(root: string): string {
  return path.join(root, 'chats');
}
