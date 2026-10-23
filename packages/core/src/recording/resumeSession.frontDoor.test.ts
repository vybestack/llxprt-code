/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import type { IContent } from '../services/history/IContent.js';
import {
  PROJECT_HASH,
  createRecordedSession,
} from './__tests__/support/p05dTestKit.js';
import { createResumableSession } from './__tests__/support/resumableSession.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { JournalResumeBoot } from './journalResume.js';
import {
  resumeSession,
  type ResumeRequest,
  type ResumeResult,
} from './resumeSession.js';
import { SessionLockManager } from './SessionLockManager.js';

async function texts(rows: AsyncIterable<IContent>): Promise<string[]> {
  const out: string[] = [];
  for await (const row of rows) {
    const block = row.blocks[0];
    if (block.type === 'text') out.push(block.text);
  }
  return out;
}

describe('the resume front door', () => {
  const directory = useTempDir('resume-front-door-');
  let resumed: ResumeResult | undefined;
  afterEach(async () => {
    await resumed?.recording.dispose();
    resumed = undefined;
  });

  function request(sessionId: string): ResumeRequest {
    return {
      continueRef: sessionId,
      chatsDir: directory(),
      projectHash: PROJECT_HASH,
      currentProvider: 'anthropic',
      currentModel: 'claude-4',
      workspaceDirs: [],
    };
  }

  it('resumes a journal session with its recorder and point boot without selecting a backend', async () => {
    const fixture = await createResumableSession(directory(), { rows: 3 });
    const result = await resumeSession(request(fixture.sessionId));
    if (!result.ok) throw new Error(result.error);
    resumed = result;
    expect(result.recording).toBeInstanceOf(JournalRecordingService);
    expect(result.boot).toBeInstanceOf(JournalResumeBoot);
    expect(result.boot).toMatchObject({ rows: 3 });
    expect(result.metadata.sessionId).toBe(fixture.sessionId);
    expect(await texts(result.boot.streamRows())).toStrictEqual([
      'row-0',
      'row-1',
      'row-2',
    ]);
    expect(
      await SessionLockManager.isLocked(directory(), fixture.sessionId),
    ).toBe(true);
  });

  it('refuses a retired JSONL session without acquiring its lock', async () => {
    const fixture = await createRecordedSession(directory(), { rows: 3 });
    const result = await resumeSession(request(fixture.sessionId));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Resumed a retired JSONL session');
    expect(result.error).toContain(retiredJournalMessage(fixture.filePath));
    expect(
      await SessionLockManager.isLocked(directory(), fixture.sessionId),
    ).toBe(false);
  });
});
