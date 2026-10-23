/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { IContent } from '../../../services/history/IContent.js';
import { JournalSession } from '../../../services/history/journalSession.js';
import type { LocalMediaStore } from '../../../storage/local-media-store.js';
import type { SessionRecordingPort } from '../../recordingPort.js';
import { replaySession } from '../../ReplayEngine.js';
import { createSessionRecorder } from '../../sessionRecorderFactory.js';
import type { SessionRecordingServiceConfig } from '../../types.js';

export function createPackageRecorder(
  config: Partial<SessionRecordingServiceConfig> &
    Pick<SessionRecordingServiceConfig, 'chatsDir'>,
): SessionRecordingPort {
  return createSessionRecorder({
    sessionId: 'package-source',
    projectHash: 'package-project',
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
    ...config,
  });
}

export function packageRecordingName(): 'session.jsonl' | 'session.llxj' {
  return 'session.llxj';
}

export async function writePackageRecording(
  directory: string,
  rows: AsyncIterable<readonly IContent[]> | Iterable<readonly IContent[]>,
  projectHash: string,
): Promise<string> {
  const chats = join(directory, 'fixture-chats');
  const recorder = createPackageRecorder({
    chatsDir: chats,
    sessionId: 'package-source',
    projectHash,
    workspaceDirs: ['/elsewhere'],
    cwd: '/elsewhere',
  });
  let path: string;
  try {
    for await (const batch of rows) await recordRowsForTest(recorder, batch);
    await recorder.flush();
    const recorded = recorder.getFilePath();
    assertNotNull(recorded, 'Expected package fixture recording');
    path = recorded;
  } finally {
    await recorder.dispose();
  }
  const destination = join(directory, packageRecordingName());
  await rename(path, destination);
  await rm(chats, { recursive: true });
  return destination;
}

export async function readPackageRows(
  path: string,
  projectHash: string,
  mediaStore?: LocalMediaStore,
): Promise<readonly IContent[]> {
  if (path.endsWith('.jsonl')) {
    const result = await replaySession(path, projectHash, { mediaStore });
    if (!result.ok) throw new Error(result.error);
    return result.history;
  }
  const session = await JournalSession.open(path);
  try {
    const rows: IContent[] = [];
    for await (const row of session.rows()) rows.push(row.content);
    return rows;
  } finally {
    await session.close();
  }
}
