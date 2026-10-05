/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { forbidHistoryMaterializationForTest } from '../../../core/src/test-utils/history-materialization-test-guard.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { collectRowsForAssertions } from '../../../core/src/test-utils/collect-rows-for-assertions.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionRecordingService,
  resumeSession,
  replaySession,
  type ResumeResult,
} from '@vybestack/llxprt-code-core';
import { restoreResumeBoot } from './restoreResumeBoot.js';

let root: string;

let resumed: ResumeResult;

let history: HistoryService;

describe('startup journal restoration', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'caller-boot-'));
    const recording = new SessionRecordingService({
      chatsDir: root,
      sessionId: 'source',
      projectHash: 'project',
      provider: 'test',
      model: 'test',
      workspaceDirs: [],
    });
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'original' }],
    });
    await recording.dispose();
    const result = await resumeSession({
      continueRef: 'source',
      chatsDir: root,
      projectHash: 'project',
      currentProvider: 'test',
      currentModel: 'test',
      workspaceDirs: [],
    });
    if (!result.ok) throw new Error(result.error);
    resumed = result;
    history = new HistoryService();
  });
  afterEach(async () => {
    history.dispose();
    await resumed.recording.dispose();
    await rm(root, { recursive: true, force: true });
  });
  it(
    'initializes the client before adopting its journal and appends without duplicating the prefix',
    verifyInitializesTheClientBeforeAdoptingItsJournalAndAppendsWithoutDuplicatingThe,
  );
  it(
    'restores the prior journal when session publication fails',
    verifyRestoresThePriorJournalWhenSessionPublicationFails,
  );
});

async function verifyInitializesTheClientBeforeAdoptingItsJournalAndAppendsWithoutDuplicatingThe(): Promise<void> {
  let published = false;
  forbidHistoryMaterializationForTest(history);
  await restoreResumeBoot(
    {
      getHistoryService: () => history,
      hasChatInitialized: () => true,
      storeHistoryForLaterUse: async () => {
        throw new Error('Unexpected deferred admission for active chat');
      },
    },
    resumed.recording,
    resumed.boot,
    () => {
      published = true;
    },
  );
  expect(published).toBe(true);
  expect(history.journalPath()).toBe(resumed.boot.filePath);
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'continued' }],
  });
  await history.waitForCommit();
  const replay = await replaySession(resumed.boot.filePath, 'project');
  if (!replay.ok) throw new Error(replay.error);
  expect(replay.history.map((row) => row.blocks)).toStrictEqual([
    [{ type: 'text', text: 'original' }],
    [{ type: 'text', text: 'continued' }],
  ]);
}

async function verifyRestoresThePriorJournalWhenSessionPublicationFails(): Promise<void> {
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'previous' }],
  });
  await history.waitForCommit();
  await expect(
    restoreResumeBoot(
      {
        getHistoryService: () => history,
        hasChatInitialized: () => true,
        storeHistoryForLaterUse: async () => {
          throw new Error('unexpected deferred admission');
        },
      },
      resumed.recording,
      resumed.boot,
      () => {
        throw new Error('publication failed');
      },
    ),
  ).rejects.toThrow('publication failed');
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.blocks)).toStrictEqual([
      [{ type: 'text', text: 'previous' }],
    ]);
  });
  expect(history.journalPath()).not.toBe(resumed.boot.filePath);
}
