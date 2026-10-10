/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { replaySession } from './ReplayEngine.js';
import type { IContent } from '../services/history/IContent.js';
import type { SessionRecordingServiceConfig } from './types.js';

const START_TIME = '2026-09-30T12:34:56.000Z';
const SESSION_ID = 'identical-session-label';
const INSTANCE_ID = '550e8400-e29b-41d4-a716-446655440000';

function content(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function recordingPath(recording: SessionRecordingService): string {
  const filePath = recording.getFilePath();
  if (filePath === null) throw new Error('Recording was not materialized');
  return filePath;
}

async function journal(filePath: string): Promise<unknown[]> {
  const raw = await readFile(filePath, 'utf8');
  return raw
    .trim()
    .split('\n')
    .map((line): unknown => JSON.parse(line));
}

describe('recording instance pathname ownership', () => {
  let directory: string;
  let config: SessionRecordingServiceConfig;
  let recordings: SessionRecordingService[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'recording-instance-isolation-'));
    config = {
      sessionId: SESSION_ID,
      projectHash: 'recording-instance-project',
      chatsDir: join(directory, 'chats'),
      workspaceDirs: [directory],
      provider: 'local',
      model: 'fixture',
    };
    recordings = [];
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(START_TIME);
  });

  afterEach(async () => {
    try {
      await Promise.all(recordings.map((recording) => recording.dispose()));
    } finally {
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  });

  function owner(): SessionRecordingService {
    const recording = new SessionRecordingService(config);
    recordings.push(recording);
    return recording;
  }

  it('keeps simultaneous same-label journals independent through disposal, surviving append and original-path resume', async () => {
    const first = owner();
    const second = owner();
    first.recordContent(content('first owner'));
    second.recordContent(content('second owner'));
    await Promise.all([first.flush(), second.flush()]);
    const firstPath = recordingPath(first);
    const secondPath = recordingPath(second);
    await first.dispose();
    second.recordContent(content('surviving second owner'));
    await second.flush();
    const discovery = await SessionDiscovery.listContinueTargetsDetailed(
      config.chatsDir,
      config.projectHash,
    );
    const secondReplay = await replaySession(secondPath, config.projectHash);
    if (!secondReplay.ok) throw new Error(secondReplay.error);
    expect(secondReplay.sequenceCorrupt).toBe(false);
    expect(secondReplay.history).toStrictEqual([
      content('second owner'),
      content('surviving second owner'),
    ]);
    expect(await journal(firstPath)).toMatchObject([
      { seq: 1, type: 'session_start', payload: { sessionId: SESSION_ID } },
      { seq: 2, type: 'content', payload: { content: content('first owner') } },
    ]);
    expect(firstPath).not.toBe(secondPath);
    expect(discovery.recordingErrors).toStrictEqual([]);
    expect(discovery.targets.map((target) => target.kind)).toStrictEqual([
      'session',
      'session',
    ]);
    const sessions = await SessionDiscovery.listSessions(
      config.chatsDir,
      config.projectHash,
    );
    expect(sessions.map((session) => session.sessionId)).toStrictEqual([
      SESSION_ID,
      SESSION_ID,
    ]);
    expect(new Set(sessions.map((session) => session.filePath))).toStrictEqual(
      new Set([firstPath, secondPath]),
    );
    for (const filePath of [firstPath, secondPath]) {
      expect(filePath.endsWith(`-${SESSION_ID.substring(0, 12)}.jsonl`)).toBe(
        true,
      );
    }
    expect(await journal(secondPath)).toMatchObject([
      { seq: 1, type: 'session_start', payload: { sessionId: SESSION_ID } },
      { seq: 2, type: 'content' },
      { seq: 3, type: 'content' },
    ]);
    const resumed = owner();
    resumed.initializeForResume(firstPath, 2);
    resumed.recordContent(content('resumed first owner'));
    await resumed.flush();
    expect(recordingPath(resumed)).toBe(firstPath);
    const resumedReplay = await replaySession(firstPath, config.projectHash);
    if (!resumedReplay.ok) throw new Error(resumedReplay.error);
    expect(resumedReplay.sequenceCorrupt).toBe(false);
    expect(resumedReplay.history).toStrictEqual([
      content('first owner'),
      content('resumed first owner'),
    ]);
    expect(await readdir(config.chatsDir)).toHaveLength(2);
  });

  it('rejects exclusive allocation collisions without touching an existing journal', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(INSTANCE_ID);
    await mkdir(config.chatsDir, { recursive: true });
    const occupiedPath = join(
      config.chatsDir,
      `session-2026-09-30T12-34-56-${INSTANCE_ID}-${SESSION_ID.substring(0, 12)}.jsonl`,
    );
    const occupiedBytes = 'previous owner bytes\n';
    await writeFile(occupiedPath, occupiedBytes);
    const recording = owner();
    expect(() => recording.recordContent(content('must not append'))).toThrow(
      /EEXIST/,
    );
    expect(recording.getFilePath()).toBeNull();
    await recording.flush();
    expect(await readFile(occupiedPath, 'utf8')).toBe(occupiedBytes);
    expect(await readdir(config.chatsDir)).toStrictEqual([
      occupiedPath.slice(config.chatsDir.length + 1),
    ]);
  });

  it('releases a rolled-back empty reservation so the next batch can publish', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(INSTANCE_ID);
    const recording = owner();
    const prepared = recording.prepareContentBatch([content('aborted')]);
    prepared.publish();
    const reservedPath = recordingPath(recording);
    expect(await readFile(reservedPath, 'utf8')).toBe('');
    prepared.rollback();
    expect(recording.getFilePath()).toBeNull();
    expect(await readdir(config.chatsDir)).toStrictEqual([]);
    const replacement = recording.prepareContentBatch([content('committed')]);
    replacement.publish();
    replacement.finalize();
    await recording.flush();
    const replay = await replaySession(
      recordingPath(recording),
      config.projectHash,
    );
    if (!replay.ok) throw new Error(replay.error);
    expect(replay.sequenceCorrupt).toBe(false);
    expect(replay.history).toStrictEqual([content('committed')]);
  });
});
