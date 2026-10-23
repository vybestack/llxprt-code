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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { journalSessionFileName } from './sessionFileName.js';
import type { SessionRecordingServiceConfig } from './types.js';

const START_TIME = '2026-09-30T12:34:56.000Z';
const SESSION_ID = 'identical-session-label';
const INSTANCE_ID = '550e8400-e29b-41d4-a716-446655440000';

function content(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function recordingPath(recording: JournalRecordingService): string {
  const filePath = recording.getFilePath();
  if (filePath === null) throw new Error('Recording was not materialized');
  return filePath;
}

describe('recording instance pathname ownership', () => {
  let directory: string;
  let config: SessionRecordingServiceConfig;
  let recordings: JournalRecordingService[];

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

  function owner(): JournalRecordingService {
    const recording = JournalRecordingService.create(config);
    recordings.push(recording);
    return recording;
  }

  it('keeps simultaneous same-label journals independent through disposal, surviving append and original-path resume', async () => {
    const first = JournalRecordingService.create(config);
    const second = JournalRecordingService.create(config);
    const native = [first, second];
    try {
      await (await first.session()).append([content('first owner')]);
      await (await second.session()).append([content('second owner')]);
      const firstPath = first.getFilePath();
      const secondPath = second.getFilePath();
      if (firstPath === null || secondPath === null)
        throw new Error('Missing journals');
      await first.dispose();
      await (
        await second.session()
      ).append([content('surviving second owner')]);
      await second.flush();
      expect(firstPath).not.toBe(secondPath);
      const discovery = await SessionDiscovery.listContinueTargetsDetailed(
        config.chatsDir,
        config.projectHash,
      );
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
      expect(
        new Set(sessions.map((session) => session.filePath)),
      ).toStrictEqual(new Set([firstPath, secondPath]));
      expect(
        (await readJournalSnapshot(firstPath, config.projectHash)).history,
      ).toStrictEqual([content('first owner')]);
      expect(
        (await readJournalSnapshot(secondPath, config.projectHash)).history,
      ).toStrictEqual([
        content('second owner'),
        content('surviving second owner'),
      ]);
      for (const file of [firstPath, secondPath])
        expect(file.endsWith('.llxj')).toBe(true);
      const resumed = await JournalRecordingService.open(config, firstPath);
      native.push(resumed);
      await (await resumed.session()).append([content('resumed first owner')]);
      await resumed.flush();
      expect(resumed.getFilePath()).toBe(firstPath);
      expect(
        (await readJournalSnapshot(firstPath, config.projectHash)).history,
      ).toStrictEqual([content('first owner'), content('resumed first owner')]);
      expect(
        (await readJournalSnapshot(secondPath, config.projectHash)).history,
      ).toStrictEqual([
        content('second owner'),
        content('surviving second owner'),
      ]);
      expect(await readdir(config.chatsDir)).toHaveLength(2);
    } finally {
      for (const recorder of native) await recorder.dispose();
    }
  });

  it('rejects exclusive allocation collisions without touching an existing journal', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(INSTANCE_ID);
    await mkdir(config.chatsDir, { recursive: true });
    const occupiedPath = join(
      config.chatsDir,
      journalSessionFileName(SESSION_ID),
    );
    const occupiedBytes = 'previous owner bytes\n';
    await writeFile(occupiedPath, occupiedBytes);
    const recording = owner();
    await expect(recording.session()).rejects.toThrow(/EEXIST/);
    expect(recording.getFilePath()).toBeNull();
    await expect(recording.flush()).rejects.toThrow(/EEXIST/);
    expect(await readFile(occupiedPath, 'utf8')).toBe(occupiedBytes);
    expect(await readdir(config.chatsDir)).toStrictEqual([
      occupiedPath.slice(config.chatsDir.length + 1),
    ]);
  });

  it('preserves an occupied empty file and permits a fresh recorder after its removal', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(INSTANCE_ID);
    await mkdir(config.chatsDir, { recursive: true });
    const occupiedPath = join(
      config.chatsDir,
      journalSessionFileName(SESSION_ID),
    );
    await writeFile(occupiedPath, '');
    const recording = owner();
    await expect(recording.session()).rejects.toThrow(/EEXIST/);
    expect(recording.getFilePath()).toBeNull();
    await expect(recording.flush()).rejects.toThrow(/EEXIST/);
    expect(recording.isActive()).toBe(false);
    expect(await readFile(occupiedPath, 'utf8')).toBe('');
    await recording.dispose();
    await rm(occupiedPath);
    expect(await readdir(config.chatsDir)).toStrictEqual([]);
    const next = owner();
    await (await next.session()).append([content('committed')]);
    await next.flush();
    const replay = await readJournalSnapshot(
      recordingPath(next),
      config.projectHash,
    );
    expect(replay.history).toStrictEqual([content('committed')]);
  });
});
