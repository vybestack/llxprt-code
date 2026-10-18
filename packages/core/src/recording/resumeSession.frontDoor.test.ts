/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResumableSession } from './__tests__/support/resumableSession.js';
import { PROJECT_HASH } from './__tests__/support/p05dTestKit.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { JournalResumeBoot } from './journalResume.js';
import { ResumeCursorBoot } from './resumeCursorBoot.js';
import { resumeSession, type ResumeResult } from './resumeSession.js';
import { SessionLockManager } from './SessionLockManager.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import type { IContent } from '../services/history/IContent.js';

let root: string;
let resumed: ResumeResult | undefined;

async function open(
  backend: 'old' | 'journal',
  sessionId: string,
): Promise<ResumeResult> {
  const result = await resumeSession(
    {
      continueRef: sessionId,
      chatsDir: root,
      projectHash: PROJECT_HASH,
      currentProvider: 'anthropic',
      currentModel: 'claude-4',
      workspaceDirs: [],
    },
    { LLXPRT_HISTORY_BACKEND: backend },
  );
  if (!result.ok) throw new Error(result.error);
  resumed = result;
  return result;
}

async function texts(rows: AsyncIterable<IContent>): Promise<string[]> {
  const out: string[] = [];
  for await (const row of rows) {
    const block = row.blocks[0];
    if (block.type === 'text') out.push(block.text);
  }
  return out;
}

describe('the resume front door', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'resume-front-door-'));
    resumed = undefined;
  });
  afterEach(async () => {
    await resumed?.recording.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it('resumes a JSONL session with the JSONL recorder and a cursor boot on the old backend', async () => {
    const env = { LLXPRT_HISTORY_BACKEND: 'old' };
    const fixture = await createResumableSession(root, { rows: 3 }, env);
    const result = await open('old', fixture.sessionId);
    expect(result.recording).toBeInstanceOf(SessionRecordingService);
    expect(result.boot).toBeInstanceOf(ResumeCursorBoot);
    expect(await texts(result.boot.streamRows())).toStrictEqual([
      'row-0',
      'row-1',
      'row-2',
    ]);
  });

  it('resumes a journal session with the journal recorder and a point boot on the journal backend', async () => {
    const env = { LLXPRT_HISTORY_BACKEND: 'journal' };
    const fixture = await createResumableSession(root, { rows: 3 }, env);
    const result = await open('journal', fixture.sessionId);
    expect(result.recording).toBeInstanceOf(JournalRecordingService);
    expect(result.boot).toBeInstanceOf(JournalResumeBoot);
    expect(result.boot).toMatchObject({ rows: 3 });
    expect(result.metadata.sessionId).toBe(fixture.sessionId);
    expect(await texts(result.boot.streamRows())).toStrictEqual([
      'row-0',
      'row-1',
      'row-2',
    ]);
    expect(await SessionLockManager.isLocked(root, fixture.sessionId)).toBe(
      true,
    );
  });

  it('reports a session the selected backend cannot see as not found', async () => {
    const fixture = await createResumableSession(
      root,
      { rows: 1 },
      { LLXPRT_HISTORY_BACKEND: 'old' },
    );
    const result = await resumeSession(
      {
        continueRef: fixture.sessionId,
        chatsDir: root,
        projectHash: PROJECT_HASH,
        currentProvider: 'anthropic',
        currentModel: 'claude-4',
        workspaceDirs: [],
      },
      { LLXPRT_HISTORY_BACKEND: 'journal' },
    );
    expect(result.ok).toBe(false);
    expect(await SessionLockManager.isLocked(root, fixture.sessionId)).toBe(
      false,
    );
  });
});
