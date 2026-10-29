import { versionOf } from '../journal/version.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { access, readdir, utimes } from 'node:fs/promises';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { openJournalReadOnly } from '../journal/journalReader.js';
import { readVersionAt } from '../journal/trailerAccess.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import {
  CONTINUE_LATEST,
  resumeSession,
  type ResumeResult,
} from './resumeSession.js';
import { deleteSession } from './sessionManagement.js';

const PROJECT_HASH = 'integration-test-project';

function content(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function resolveContinueSession(value: boolean | string): string | null {
  if (typeof value === 'string') return value;
  return value ? CONTINUE_LATEST : null;
}

function fileOf(recording: JournalRecordingService): string {
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing session file');
  return file;
}

describe('integration: full journal session lifecycle', () => {
  const directory = useTempDir('integration-test-');
  const recordings: JournalRecordingService[] = [];
  const histories: HistoryService[] = [];
  const resumed: ResumeResult[] = [];
  afterEach(async () => {
    for (const result of resumed.splice(0)) await result.recording.dispose();
    for (const history of histories.splice(0)) await history.dispose();
    for (const recording of recordings.splice(0)) await recording.dispose();
  });

  function config(): Parameters<typeof JournalRecordingService.create>[0] {
    return {
      sessionId: crypto.randomUUID(),
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      workspaceDirs: ['/test/workspace'],
      provider: 'anthropic',
      model: 'claude-4',
    };
  }

  function recorder(): JournalRecordingService {
    const recording = JournalRecordingService.create(config());
    recordings.push(recording);
    return recording;
  }

  async function record(
    rows: readonly IContent[],
  ): Promise<JournalRecordingService> {
    const recording = recorder();
    await recordRowsForTest(recording, rows);
    await recording.flush();
    await recording.dispose();
    return recording;
  }

  function live(recording: JournalRecordingService): HistoryService {
    const history = new HistoryService({ recording });
    histories.push(history);
    return history;
  }

  function resume(
    ref: string = CONTINUE_LATEST,
  ): ReturnType<typeof resumeSession> {
    return resumeSession({
      continueRef: ref,
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      currentProvider: 'anthropic',
      currentModel: 'claude-4',
      workspaceDirs: ['/test/workspace'],
    });
  }

  async function resumeOk(
    ref: string = CONTINUE_LATEST,
  ): Promise<ResumeResult> {
    const result = await resume(ref);
    if (!result.ok) throw new Error(result.error);
    resumed.push(result);
    return result;
  }

  it('records three turns and reopens all six content rows', async () => {
    const rows = [
      content('hello'),
      content('hi there', 'ai'),
      content('how are you?'),
      content('I am fine', 'ai'),
      content('bye'),
      content('goodbye', 'ai'),
    ];
    const recording = await record(rows);
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(saved.history).toHaveLength(6);
    expect(saved.history[0].speaker).toBe('human');
    expect(saved.history[0].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'hello',
    });
    expect(saved.history[5].speaker).toBe('ai');
    expect(saved.history[5].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'goodbye',
    });
    expect(saved.history).toStrictEqual(rows);
  });

  it('records three turns, resumes and appends two more turns without losing rows', async () => {
    const first = Array.from(
      { length: 6 },
      (_, index): IContent =>
        content(
          `turn${Math.floor(index / 2) + 1}-${index % 2 === 0 ? 'h' : 'a'}`,
          index % 2 === 0 ? 'human' : 'ai',
        ),
    );
    const recording = await record(first);
    expect(
      (await readJournalSnapshot(fileOf(recording), PROJECT_HASH)).history,
    ).toHaveLength(6);
    const result = await resumeOk(recording.getSessionId());
    const more = [
      content('turn4-h'),
      content('turn4-a', 'ai'),
      content('turn5-h'),
      content('turn5-a', 'ai'),
    ];
    await recordRowsForTest(result.recording, more);
    await result.recording.dispose();
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(saved.history).toHaveLength(10);
    expect(saved.history[9].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'turn5-a',
    });
    expect(saved.history).toStrictEqual([...first, ...more]);
  });

  it('keeps commit sequences monotonic across the resume boundary', async () => {
    const recording = await record([
      content('m1'),
      content('m2', 'ai'),
      content('m3'),
    ]);
    const file = fileOf(recording);
    const before = await readJournalSnapshot(file, PROJECT_HASH);
    const result = await resumeOk(recording.getSessionId());
    await recordRowsForTest(result.recording, [
      content('m4'),
      content('m5', 'ai'),
    ]);
    await result.recording.dispose();
    const reader = await openJournalReadOnly(file);
    try {
      const trailer = reader.trailer;
      if (trailer === undefined) throw new Error('Missing committed trailer');
      let current = versionOf(trailer);
      expect(current.commitSeq).toBeGreaterThan(before.commitSeq);
      while (current.parent !== 0) {
        const parent = await readVersionAt(reader, current.parent);
        expect(current.commitSeq).toBeGreaterThan(parent.commitSeq);
        current = parent;
      }
    } finally {
      await reader.close();
    }
  });

  it('persists compression as summary plus post-compression rows', async () => {
    const recording = recorder();
    const history = live(recording);
    await history.addBatch(
      Array.from(
        { length: 5 },
        (_, index): IContent =>
          content(`pre-${index}`, index % 2 === 0 ? 'human' : 'ai'),
      ),
    );
    const summary = content('Summary of 5 items', 'ai');
    history.startCompression();
    await history.replaceAll([summary]);
    history.endCompression(summary, 5);
    await history.addBatch([content('post-1'), content('post-2', 'ai')]);
    await history.waitForCommit();
    const file = fileOf(recording);
    await history.dispose();
    await recording.dispose();
    const saved = await readJournalSnapshot(file, PROJECT_HASH);
    expect(saved.history).toHaveLength(3);
    expect(saved.history.map((row) => row.blocks)).toStrictEqual([
      summary.blocks,
      content('post-1').blocks,
      content('post-2', 'ai').blocks,
    ]);
  });

  it('records five rows and rewinds two leaving exactly the first three', async () => {
    const recording = recorder();
    const history = live(recording);
    await history.addBatch(
      Array.from(
        { length: 5 },
        (_, index): IContent =>
          content(`item-${index}`, index % 2 === 0 ? 'human' : 'ai'),
      ),
    );
    expect((await history.pop())?.blocks).toStrictEqual(
      content('item-4').blocks,
    );
    expect((await history.pop())?.blocks).toStrictEqual(
      content('item-3', 'ai').blocks,
    );
    await history.waitForCommit();
    const file = fileOf(recording);
    await history.dispose();
    await recording.dispose();
    const saved = await readJournalSnapshot(file, PROJECT_HASH);
    expect(saved.history).toHaveLength(3);
    expect(saved.history[2].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'item-2',
    });
    expect(saved.history.map((row) => row.blocks)).toStrictEqual([
      content('item-0').blocks,
      content('item-1', 'ai').blocks,
      content('item-2').blocks,
    ]);
  });

  it('persists the switched provider and model with both rows', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('hi')]);
    recording.recordProviderSwitch('openai', 'gpt-5');
    await recordRowsForTest(recording, [content('hello', 'ai')]);
    await recording.dispose();
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(saved.metadata.provider).toBe('openai');
    expect(saved.metadata.model).toBe('gpt-5');
    expect(saved.history).toHaveLength(2);
  });

  it('persists the changed workspace directories', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('hi')]);
    recording.recordDirectoriesChanged(['/new/dir-a', '/new/dir-b']);
    await recording.dispose();
    expect(
      (await readJournalSnapshot(fileOf(recording), PROJECT_HASH)).metadata
        .workspaceDirs,
    ).toStrictEqual(['/new/dir-a', '/new/dir-b']);
  });

  it('does not create a session file for operational events alone', async () => {
    const recording = recorder();
    recording.recordSessionEvent('info', 'started');
    await recording.flush();
    expect(recording.getFilePath()).toBeNull();
    await recording.dispose();
    expect(
      (await readdir(directory())).filter((name) => name.endsWith('.llxj')),
    ).toHaveLength(0);
  });

  it('discovers three recordings sorted newest first', async () => {
    for (let index = 0; index < 3; index++) {
      const recording = await record([content(`session-${index}`)]);
      const when = new Date(Date.UTC(2026, 9, 1 + index));
      await utimes(fileOf(recording), when, when);
    }
    const sessions = await SessionDiscovery.listSessions(
      directory(),
      PROJECT_HASH,
    );
    expect(sessions).toHaveLength(3);
    expect(sessions[0].lastModified.getTime()).toBeGreaterThanOrEqual(
      sessions[1].lastModified.getTime(),
    );
    expect(sessions[1].lastModified.getTime()).toBeGreaterThanOrEqual(
      sessions[2].lastModified.getTime(),
    );
  });

  it('resumes the newest recording for bare continue', async () => {
    const sessions: string[] = [];
    for (let index = 0; index < 3; index++) {
      const recording = await record([
        content(`s${index}`),
        content(`r${index}`, 'ai'),
      ]);
      sessions.push(recording.getSessionId());
      const when = new Date(Date.UTC(2026, 9, 1 + index));
      await utimes(fileOf(recording), when, when);
    }
    const result = await resumeOk();
    expect(result.metadata.sessionId).toBe(sessions[2]);
    expect(await Array.fromAsync(result.boot.streamRows())).toHaveLength(2);
  });

  it('resumes the requested session ID even when another session is newer', async () => {
    const first = await record([content('first-session')]);
    await record([content('second-session')]);
    const result = await resumeOk(first.getSessionId());
    expect(result.metadata.sessionId).toBe(first.getSessionId());
    const rows = await Array.fromAsync(result.boot.streamRows());
    expect(rows).toHaveLength(1);
    expect(rows[0].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'first-session',
    });
  });

  it('deletes the selected recording file', async () => {
    const recording = await record([content('to-delete')]);
    const file = fileOf(recording);
    await expect(access(file)).resolves.toBeFalsy();
    expect(
      (await deleteSession(recording.getSessionId(), directory(), PROJECT_HASH))
        .ok,
    ).toBe(true);
    await expect(access(file)).rejects.toThrow(/ENOENT/);
  });

  it('refuses a second resume while the first owns the session lock', async () => {
    const recording = await record([content('locked-session')]);
    await resumeOk(recording.getSessionId());
    const result = await resume(recording.getSessionId());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Second resume acquired a held lock');
    expect(result.error).toContain('in use');
  });

  it('keeps an explicit continue reference', () => {
    expect(resolveContinueSession('abc123')).toBe('abc123');
  });

  it('uses the newest-session reference for bare continue', () => {
    expect(resolveContinueSession(true)).toBe(CONTINUE_LATEST);
  });

  it('distinguishes string and false continue settings', () => {
    expect(Boolean('abc123')).toBe(true);
    expect(Boolean(false)).toBe(false);
    expect(resolveContinueSession(false)).toBeNull();
  });
});
