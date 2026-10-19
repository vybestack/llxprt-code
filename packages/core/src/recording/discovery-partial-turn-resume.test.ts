/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { pinHistoryBackend } from './__tests__/support/backendEnv.js';
import {
  remainderDirectory,
  remainderRows,
} from './__tests__/support/discovery-remainder-fixture.js';
import {
  journalSeams,
  PROJECT,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';
import type { IContent } from '../services/history/IContent.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { resumeSession } from './resumeSession.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';

pinHistoryBackend('journal');

describe('discovery and continuation of a partial native tool turn', () => {
  it('resumes only committed call/results by original identity and appends on that file without inventing unfinished results', async () => {
    const chats = await remainderDirectory('partial-tool-turn');
    const committed: IContent[] = [
      userRow('do three things'),
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'first',
            name: 'read_file',
            parameters: { path: '/a' },
          },
          {
            type: 'tool_call',
            id: 'second',
            name: 'read_file',
            parameters: { path: '/b' },
          },
          {
            type: 'tool_call',
            id: 'third',
            name: 'read_file',
            parameters: { path: '/c' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'first',
            toolName: 'read_file',
            result: 'completed first only',
          },
        ],
      },
    ];
    const recorded = await recordJournal(chats, 'partial-turn', {
      rows: committed,
      name: 'interrupted',
    });
    const listing = await SessionDiscovery.listSessions(chats, PROJECT);
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({
      sessionId: 'partial-turn',
      name: 'interrupted',
      messageCount: 3,
      filePath: recorded.filePath,
    });
    const resumed = await resumeSession({
      continueRef: 'partial-turn',
      projectHash: PROJECT,
      chatsDir: chats,
      currentProvider: 'anthropic',
      currentModel: 'model-1',
      workspaceDirs: ['/work/a'],
      journal: journalSeams(),
    });
    if (!resumed.ok) throw new Error(resumed.error);
    try {
      expect(resumed.metadata.sessionId).toBe('partial-turn');
      expect(resumed.recording.getFilePath()).toBe(recorded.filePath);
      expect(await SessionLockManager.isLocked(chats, 'partial-turn')).toBe(
        true,
      );
      expect(await Array.fromAsync(resumed.boot.streamRows())).toStrictEqual(
        committed,
      );
      if (!(resumed.recording instanceof JournalRecordingService))
        throw new Error('Expected native recorder');
      await (
        await resumed.recording.session()
      ).append([userRow('continue after interruption')]);
      await resumed.recording.flush();
    } finally {
      await resumed.recording.dispose();
    }
    expect(await remainderRows(recorded.filePath)).toStrictEqual([
      ...committed,
      userRow('continue after interruption'),
    ]);
    expect(await SessionLockManager.isLocked(chats, 'partial-turn')).toBe(
      false,
    );
    expect(await readdir(chats)).toHaveLength(1);
  });
});
