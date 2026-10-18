/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { resumeSession, type ResumeResult } from '@vybestack/llxprt-code-core';
import { restoreResumeBoot } from './restoreResumeBoot.js';

const JOURNAL = { LLXPRT_HISTORY_BACKEND: 'journal' };

let root: string;
let resumed: ResumeResult;
let history: HistoryService;

describe('startup restoration from a journal session', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'caller-boot-journal-'));
    const recording = JournalRecordingService.create({
      chatsDir: root,
      sessionId: 'source',
      projectHash: 'project',
      provider: 'test',
      model: 'test',
      workspaceDirs: [],
    });
    await (
      await recording.session()
    ).append([
      { speaker: 'human', blocks: [{ type: 'text', text: 'original' }] },
    ]);
    await recording.dispose();
    const result = await resumeSession(
      {
        continueRef: 'source',
        chatsDir: root,
        projectHash: 'project',
        currentProvider: 'test',
        currentModel: 'test',
        workspaceDirs: [],
      },
      JOURNAL,
    );
    if (!result.ok) throw new Error(result.error);
    resumed = result;
    history = new HistoryService({ backend: 'journal' });
  });
  afterEach(async () => {
    await history.dispose();
    await resumed.recording.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it('adopts the journal without streaming the prefix into the deferred history first', async () => {
    const stored: unknown[] = [];
    await restoreResumeBoot(
      {
        getHistoryService: () => history,
        hasChatInitialized: () => false,
        storeHistoryForLaterUse: async (source) => {
          stored.push(source);
        },
      },
      resumed.recording,
      resumed.boot,
      () => undefined,
    );
    expect(stored).toStrictEqual([[]]);
    expect(history.journalPath()).toBe(resumed.recording.getFilePath());
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows.map((row) => row.blocks)).toStrictEqual([
        [{ type: 'text', text: 'original' }],
      ]);
    });
  });
});
