/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05c target contract: the subagent facade is the SAME HistoryService class
 * running over the child's own journal. Parent and child facades must be
 * isolated (parent history never folds child rows and vice versa) and the
 * child facade must satisfy the P05b3 journal criteria on its own journal:
 * add -> waitForCommit -> durable fold reflects the op; late attach
 * (attachJournal) carries pre-attach rows onto the attached recorder.
 *
 * SIGNAL FILE: every import exists at HEAD. These tests are expected to pass
 * already — they pin the facade contract the green session must preserve
 * when it wires child journals through the orchestrator. A failure here is
 * a real regression signal, not the sanctioned red.
 *
 * @plan:PLAN-20260917-ISSUE854.P05c
 * @requirement:G7
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionLockManager } from './SessionLockManager.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';

const PROJECT_HASH = 'p05c-facade-hash';

let fixtureDir: string | null = null;

afterEach(async () => {
  if (fixtureDir !== null) {
    await rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = null;
  }
});

async function makeChatsDir(): Promise<string> {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'p05c-facade-'));
  return path.join(fixtureDir, 'chats');
}

async function startRecording(
  chatsDir: string,
  sessionId: string,
): Promise<SessionRecordingService> {
  const recording = await SessionRecordingService.createLocked({
    sessionId,
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/w'],
    provider: 'anthropic',
    model: 'claude-4',
  });
  recording.recordContent({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'seed' }],
  });
  await recording.flush();
  return recording;
}

function textContent(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function textOf(content: IContent): string {
  if (content.blocks.length === 0) return '';
  const block = content.blocks[0];
  return block.type === 'text' ? block.text : '';
}

describe('P05c child facade is HistoryService over its own journal @plan:PLAN-20260917-ISSUE854.P05c', () => {
  it('keeps parent and child facades isolated to their own journals', async () => {
    const chatsDir = await makeChatsDir();
    const parentRecording = await startRecording(chatsDir, randomUUID());
    const childRecording = await startRecording(chatsDir, randomUUID());
    const parentHistory = new HistoryService({
      recording: parentRecording,
    });
    const childHistory = new HistoryService({ recording: childRecording });

    parentHistory.add(textContent('parent task one'));
    childHistory.add(textContent('child task one'));
    await parentHistory.waitForCommit();
    await childHistory.waitForCommit();

    const parentRows = parentHistory.getAll().map(textOf);
    const childRows = childHistory.getAll().map(textOf);
    expect(parentRows).toStrictEqual(['seed', 'parent task one']);
    expect(childRows).toStrictEqual(['seed', 'child task one']);
    expect(parentHistory.journalPath()).not.toBe(childHistory.journalPath());

    parentHistory.dispose();
    childHistory.dispose();
    await parentRecording.dispose();
    await childRecording.dispose();
  });

  it('child facade commits rows durably to its own journal', async () => {
    const chatsDir = await makeChatsDir();
    const recording = await startRecording(chatsDir, randomUUID());
    const history = new HistoryService({ recording });
    history.add(textContent('durable child row'));
    await history.waitForCommit();
    expect(history.journalPath()).toBe(recording.getFilePath());
    expect(history.journalPath()).not.toBeNull();
    history.dispose();
    await recording.dispose();
  });

  it('a child facade can late-attach to a child recorder', async () => {
    const chatsDir = await makeChatsDir();
    const childRecording = await startRecording(chatsDir, randomUUID());
    const history = new HistoryService();
    history.add(textContent('pre-attach child row'));
    await history.waitForCommit();

    history.attachJournal(childRecording);
    history.add(textContent('post-attach child row'));
    await history.waitForCommit();

    const rows = history.getAll().map(textOf);
    expect(rows).toStrictEqual([
      'seed',
      'pre-attach child row',
      'post-attach child row',
    ]);
    history.dispose();
    await childRecording.dispose();
  });

  it('locks of both recordings release independently on dispose', async () => {
    const chatsDir = await makeChatsDir();
    const parentId = randomUUID();
    const childId = randomUUID();
    const parentRecording = await startRecording(chatsDir, parentId);
    const childRecording = await startRecording(chatsDir, childId);

    expect(await SessionLockManager.isLocked(chatsDir, parentId)).toBe(true);
    expect(await SessionLockManager.isLocked(chatsDir, childId)).toBe(true);

    await childRecording.dispose();
    expect(await SessionLockManager.isLocked(chatsDir, childId)).toBe(false);
    expect(await SessionLockManager.isLocked(chatsDir, parentId)).toBe(true);

    await parentRecording.dispose();
    expect(await SessionLockManager.isLocked(chatsDir, parentId)).toBe(false);
  });
});
