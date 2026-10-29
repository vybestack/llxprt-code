/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readRecordedRows } from '../__tests__/journal-recording.js';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';

import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';

import {
  createSessionRecorder,
  resumeSession,
  type ResumeResult,
} from '@vybestack/llxprt-code-core';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgent } from '../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { captureSessionOwner } from '../../../agents/src/api/__tests__/helpers/capture-session-owner.js';
import { accountingFactory } from '@vybestack/llxprt-code-core/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import { restoreResumeBoot } from './restoreResumeBoot.js';

let root: string;

let resumed: ResumeResult;

let history: HistoryService;

describe('startup journal restoration', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'caller-boot-'));
    const recording = createSessionRecorder({
      chatsDir: root,
      sessionId: 'source',
      projectHash: 'project',
      provider: 'test',
      model: 'test',
      workspaceDirs: [],
    });
    await recordRowsForTest(recording, [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original' }],
      },
    ]);
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
    history = new HistoryService({});
  });
  afterEach(async () => {
    await history.dispose();
    await resumed.recording.dispose();
    await rm(root, { recursive: true, force: true });
  });
  it('uses the inactive client tokenizer while adopting a journal before authentication', async () => {
    const { value: built, owner } = await captureSessionOwner(() =>
      buildAgent('plain-text.jsonl'),
    );
    const client = owner.clients.getAgentClient();
    const tokenizer = accountingFactory((text) => text.length);
    client.bindTokenization(tokenizer.getTokenizer, tokenizer);
    try {
      await restoreResumeBoot(
        client,
        resumed.recording,
        resumed.boot,
        () => {},
      );
      expect(client.hasChatInitialized()).toBe(false);
      expect(client.getHistoryService()?.getTotalTokens()).toBe(
        'original'.length,
      );
    } finally {
      await client.dispose();
      await built.cleanup();
    }
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
  expect(history.journalPath()).toBe(resumed.recording.getFilePath());
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'continued' }],
  });
  await history.waitForCommit();
  const rows = await readRecordedRows(resumed.recording.getFilePath()!);
  expect(rows.map((row) => row.blocks)).toStrictEqual([
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
  expect(history.journalPath()).not.toBe(resumed.recording.getFilePath());
}
