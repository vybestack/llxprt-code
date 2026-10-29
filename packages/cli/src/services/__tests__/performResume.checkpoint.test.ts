/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readRecordedRows } from '../../__tests__/journal-recording.js';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';

import { createRowCounters } from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { collectResumeRows } from '../../__tests__/resumeRows.js';
import {
  makeConfig,
  makeContent,
  makeResumeContext,
  performResume,
  ResumeTestSetup,
  createSessionRecorder,
} from './performResume-test-helpers.js';

describe('checkpoint resume adoption', () => {
  const setup = new ResumeTestSetup();
  let history: HistoryService;
  let context: ReturnType<typeof makeResumeContext>;
  beforeEach(async () => {
    await setup.beforeEach();
    history = new HistoryService();
    context = {
      ...makeResumeContext(setup.chatsDir),
      history: {
        adoptResumeBoot: history.adoptResumeBoot.bind(history),
        attachRecording: async (integration) => {
          await integration.subscribeToJournal(history);
        },
      },
    };
    const source = createSessionRecorder(
      makeConfig(setup.chatsDir, { sessionId: 'checkpoint-source' }),
    );
    await recordRowsForTest(source, [makeContent('prefix')]);
    await source.createCheckpoint('checkpoint-cut');
    await recordRowsForTest(source, [makeContent('after checkpoint')]);
    await source.dispose();
  });
  afterEach(async () => {
    await history.dispose();
    await context.recordingCallbacks.getCurrentIntegration()?.dispose();
    await context.recordingCallbacks.getCurrentRecording()?.dispose();
    await setup.afterEach();
  });

  it('adopts the child journal without eager history and appends exactly once', async () => {
    forbidHistoryMaterializationForTest(history);
    const kit = createRowCounters();
    const result = await performResume('checkpoint-cut', {
      ...context,
      counters: kit.counters,
    });
    if (!result.ok) throw new Error(result.error);
    expect(kit.snapshot().recordsDecoded).toBe(0);
    expect(kit.snapshot().peakDecodedRows).toBeLessThanOrEqual(256);
    expect(
      (await collectResumeRows(result.history)).map((row) => row.blocks),
    ).toStrictEqual([makeContent('prefix').blocks]);
    history.add(makeContent('continued'));
    await history.waitForCommit();
    const path = history.journalPath();
    if (path === null) throw new Error('No adopted journal');
    const rows = await readRecordedRows(path);
    expect(rows.map((row) => row.blocks)).toStrictEqual([
      makeContent('prefix').blocks,
      makeContent('continued').blocks,
    ]);
    expect(
      context.recordingCallbacks.getCurrentRecording()?.getSessionId(),
    ).toBe(result.metadata.sessionId);
  });

  it('restores prior history and removes the prepared child when publication fails', async () => {
    history.add(makeContent('previous'));
    await history.waitForCommit();
    const before = await readdir(setup.chatsDir);
    const result = await performResume('checkpoint-cut', {
      ...context,
      recordingCallbacks: {
        ...context.recordingCallbacks,
        setRecording: () => {
          throw new Error('publication failed');
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Unexpected successful publication');
    expect(result.error).toContain('publication failed');
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows.map((row) => row.blocks)).toStrictEqual([
        makeContent('previous').blocks,
      ]);
    });
    expect((await readdir(setup.chatsDir)).sort()).toStrictEqual(before.sort());
  });
});
