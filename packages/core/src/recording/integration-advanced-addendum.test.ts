/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { describe, expect, it } from 'bun:test';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import type { IContent } from '../services/history/IContent.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';
import { resumeSession } from './resumeSession.js';

const PROJECT_HASH = 'integration-test-project';

function content(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function toolCall(): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'Running tools' },
      { type: 'tool_call', id: 'c1', name: 'tool1', parameters: {} },
      { type: 'tool_call', id: 'c2', name: 'tool2', parameters: {} },
      { type: 'tool_call', id: 'c3', name: 'tool3', parameters: {} },
    ],
  };
}

function toolResult(): IContent {
  return {
    speaker: 'tool',
    blocks: [
      { type: 'tool_response', callId: 'c1', toolName: 'tool1', result: 'ok' },
    ],
  };
}

describe('integration: committed journal lifecycle', () => {
  const directory = useTempDir('recording-addendum-');

  function config(
    sessionId: string,
  ): Parameters<typeof JournalRecordingService.create>[0] {
    return {
      sessionId,
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      workspaceDirs: ['/test/workspace'],
      provider: 'anthropic',
      model: 'claude-4',
    };
  }

  async function record(
    rows: readonly IContent[],
  ): Promise<JournalRecordingService> {
    const recorder = JournalRecordingService.create(
      config(crypto.randomUUID()),
    );
    await recordRowsForTest(recorder, rows);
    await recorder.flush();
    await recorder.dispose();
    return recorder;
  }

  function fileOf(recording: JournalRecordingService): string {
    const file = recording.getFilePath();
    if (file === null) throw new Error('Missing journal recording');
    return file;
  }

  it.each([
    'flush persists all committed content',
    'only committed content survives cancellation flush',
  ])('%s', async () => {
    const rows = [content('user request'), toolCall(), toolResult()];
    const recording = await record(rows);
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(saved.history).toStrictEqual(rows);
    expect(saved.history.map((row) => row.speaker)).toStrictEqual([
      'human',
      'ai',
      'tool',
    ]);
    expect(saved.history.filter((row) => row.speaker === 'tool')).toHaveLength(
      1,
    );
  });

  it('cancel mid-tool resumes the partial turn and appends new rows', async () => {
    const before = [content('user msg'), toolCall()];
    const recording = await record(before);
    const file = fileOf(recording);
    const initial = await readJournalSnapshot(file, PROJECT_HASH);
    expect(initial.history).toStrictEqual(before);
    expect(initial.history.map((row) => row.speaker)).toStrictEqual([
      'human',
      'ai',
    ]);
    const resumed = await JournalRecordingService.open(
      config(recording.getSessionId()),
      file,
    );
    try {
      await recordRowsForTest(resumed, [
        content('new message after resume'),
        content('new response', 'ai'),
      ]);
      await resumed.flush();
    } finally {
      await resumed.dispose();
    }
    const saved = await readJournalSnapshot(file, PROJECT_HASH);
    expect(saved.history).toStrictEqual([
      ...before,
      content('new message after resume'),
      content('new response', 'ai'),
    ]);
    expect(saved.history).toHaveLength(4);
    expect(saved.commitSeq).toBeGreaterThan(initial.commitSeq);
  });

  it('a torn tail leaves the committed prefix readable and new groups append cleanly', async () => {
    const before = [
      content('m1'),
      content('m2', 'ai'),
      content('m3'),
      content('m4', 'ai'),
    ];
    const recording = await record(before);
    const file = fileOf(recording);
    await appendFile(file, new Uint8Array([1, 1, 0, 0, 64, 0]));
    const initial = await readJournalSnapshot(file, PROJECT_HASH);
    expect(initial.history).toStrictEqual(before);
    expect(initial.history).toHaveLength(4);
    const resumed = await JournalRecordingService.open(
      config(recording.getSessionId()),
      file,
    );
    try {
      await recordRowsForTest(resumed, [
        content('after-crash'),
        content('response-after-crash', 'ai'),
      ]);
      await resumed.flush();
    } finally {
      await resumed.dispose();
    }
    const saved = await readJournalSnapshot(file, PROJECT_HASH);
    expect(saved.history).toHaveLength(6);
    expect(saved.history).toStrictEqual([
      ...before,
      content('after-crash'),
      content('response-after-crash', 'ai'),
    ]);
  });

  it('concurrent resume fails while the full session ID lock is held', async () => {
    const recording = await record([content('locked-data')]);
    const file = fileOf(recording);
    const lock = await SessionLockManager.acquire(
      directory(),
      recording.getSessionId(),
    );
    try {
      const result = await resumeSession({
        continueRef: recording.getSessionId(),
        projectHash: PROJECT_HASH,
        chatsDir: directory(),
        currentProvider: 'anthropic',
        currentModel: 'claude-4',
        workspaceDirs: ['/test/workspace'],
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Concurrent resume acquired a held lock');
      expect(result.error).toContain('in use');
      const owner = await JournalRecordingService.open(
        config(recording.getSessionId()),
        file,
      );
      try {
        await recordRowsForTest(owner, [content('from-process-a')]);
        await owner.flush();
      } finally {
        await owner.dispose();
      }
      const saved = await readJournalSnapshot(file, PROJECT_HASH);
      expect(saved.history).toHaveLength(2);
      expect(saved.history).toStrictEqual([
        content('locked-data'),
        content('from-process-a'),
      ]);
    } finally {
      await lock.release();
    }
  });

  it('interactive and prompt recording paths preserve identical content', async () => {
    const rows = [content('hello'), content('world', 'ai')];
    const interactive = await record(rows);
    const prompt = await record(rows);
    const first = await readJournalSnapshot(fileOf(interactive), PROJECT_HASH);
    const second = await readJournalSnapshot(fileOf(prompt), PROJECT_HASH);
    expect(first.history).toHaveLength(2);
    expect(second.history).toHaveLength(2);
    for (let index = 0; index < first.history.length; index++) {
      expect(first.history[index].speaker).toBe(second.history[index].speaker);
      expect(first.history[index].blocks).toStrictEqual(
        second.history[index].blocks,
      );
    }
    expect(first.history).toStrictEqual(rows);
    expect(second.history).toStrictEqual(rows);
  });

  it('an incomplete trailing frame is discarded without losing any committed row', async () => {
    const rows = Array.from(
      { length: 10 },
      (_, index): IContent =>
        content(`msg-${index}`, index % 2 === 0 ? 'human' : 'ai'),
    );
    const recording = await record(rows);
    const file = fileOf(recording);
    await appendFile(file, new Uint8Array([1, 0, 0]));
    const saved = await readJournalSnapshot(file, PROJECT_HASH);
    expect(saved.history).toHaveLength(10);
    expect(saved.history).toStrictEqual(rows);
  });

  it('discovers journal recordings and ignores unrelated JSON files', async () => {
    await record([content('journal-1')]);
    await record([content('journal-2')]);
    await writeFile(join(directory(), 'session-old1.json'), '{"old": true}');
    await writeFile(join(directory(), 'session-old2.json'), '{"old": true}');
    const sessions = await SessionDiscovery.listSessions(
      directory(),
      PROJECT_HASH,
    );
    expect(sessions).toHaveLength(2);
    for (const session of sessions) expect(session.filePath).toMatch(/\.llxj$/);
  });
});
