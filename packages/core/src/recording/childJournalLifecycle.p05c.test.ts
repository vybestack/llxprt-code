/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05c target contract: a child journal is EPHEMERAL. One seam owns the
 * lifecycle — allocate an fs-safe id, acquire the lock, stamp
 * kind=subagent/parentSessionId, and GUARANTEE cleanup (journal file + lock)
 * on success, failure, timeout, cancellation, and nested-child teardown.
 * Cleanup must survive injected I/O failures and dispose must be idempotent.
 *
 * RED (missing API): imports the pinned `createChildSessionJournal` seam
 * that the green session implements per tmp/verify854/p05c/api_sketch.md.
 * The module does not exist at HEAD, so this file fails at load — the
 * sanctioned red mode for a missing contract.
 *
 * @plan:PLAN-20260917-ISSUE854.P05c
 * @requirement:G7
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import {
  testJournalSeams,
  type Failures,
} from '../journal/__tests__/support/journalFixtures.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';

import { createChildSessionJournal } from './childJournal.js';
import { SessionLockManager } from './SessionLockManager.js';
import { JournalRecordingService } from './journalRecordingService.js';

const PROJECT_HASH = 'p05c-lifecycle-hash';

let fixtureDir: string | null = null;

async function makeChatsDir(): Promise<string> {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'p05c-lifecycle-'));
  return path.join(fixtureDir, 'chats');
}

function journalOptions(
  chatsDir: string,
): Parameters<typeof createChildSessionJournal>[0] {
  return {
    parentSessionId: randomUUID(),
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/w'],
    provider: 'anthropic',
    model: 'claude-4',
  };
}

async function lockExists(chatsDir: string): Promise<boolean> {
  const entries = await readdir(chatsDir);
  return entries.some((entry) => entry.endsWith('.lock'));
}

async function journalCount(chatsDir: string): Promise<number> {
  const entries = await readdir(chatsDir);
  return entries.filter((entry) => entry.startsWith('session-')).length;
}

async function cleanupFixture(): Promise<void> {
  if (fixtureDir !== null) {
    await rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = null;
  }
}

describe('P05c child journal creation and disposal @plan:PLAN-20260917-ISSUE854.P05c', () => {
  afterEach(cleanupFixture);

  it('materializes a locked child journal under its own file', async () => {
    const chatsDir = await makeChatsDir();
    const journal = await createChildSessionJournal(journalOptions(chatsDir));
    await recordRowsForTest(journal.recording, [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'child work' }],
      },
    ]);
    await journal.recording.flush();
    const filePath = journal.recording.getFilePath();
    expect(filePath).not.toBeNull();
    if (filePath === null) throw new Error('Missing child file');
    expect(existsSync(filePath)).toBe(true);
    expect(await SessionLockManager.isLocked(chatsDir, journal.sessionId)).toBe(
      true,
    );
    await journal.dispose();
  });

  it('dispose removes the journal file and releases the lock', async () => {
    const chatsDir = await makeChatsDir();
    const journal = await createChildSessionJournal(journalOptions(chatsDir));
    const sessionId = journal.sessionId;
    await journal.dispose();
    expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(false);
    expect(await journalCount(chatsDir)).toBe(0);
    expect(await lockExists(chatsDir)).toBe(false);
  });

  it('dispose is idempotent', async () => {
    const chatsDir = await makeChatsDir();
    const journal = await createChildSessionJournal(journalOptions(chatsDir));
    await journal.dispose();
    await expect(journal.dispose()).resolves.toBeUndefined();
  });
});

describe('P05c child journal failure cleanup and isolation @plan:PLAN-20260917-ISSUE854.P05c', () => {
  afterEach(cleanupFixture);

  it('an init failure leaves no journal or lock behind', async () => {
    const chatsDir = await makeChatsDir();
    const seams = testJournalSeams({ failWriteAt: 0 });
    let error: unknown = null;
    try {
      await createChildSessionJournal({
        ...journalOptions(chatsDir),
        journal: { journal: seams.dependencies },
      });
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(await journalCount(chatsDir)).toBe(0);
    expect(await lockExists(chatsDir)).toBe(false);
  });

  it('a mid-life write failure still cleans up on dispose', async () => {
    const chatsDir = await makeChatsDir();
    const failures: Failures = {};
    const seams = testJournalSeams(failures);
    const journal = await createChildSessionJournal({
      ...journalOptions(chatsDir),
      journal: { journal: seams.dependencies },
    });
    failures.failFlushAt = seams.events.filter(
      (event) => event.type === 'flush',
    ).length;
    journal.recording.recordSessionMetadata('rejected');
    await expect(journal.recording.flush()).rejects.toThrow(
      'injected flush failure',
    );
    await journal.dispose();
    expect(await journalCount(chatsDir)).toBe(0);
    expect(await lockExists(chatsDir)).toBe(false);
  });

  it('the parent journal stays one task group, isolated from children', async () => {
    const chatsDir = await makeChatsDir();
    const parent = await JournalRecordingService.createLocked({
      sessionId: randomUUID(),
      projectHash: PROJECT_HASH,
      chatsDir,
      workspaceDirs: ['/w'],
      provider: 'anthropic',
      model: 'claude-4',
    });
    await recordRowsForTest(parent, [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'parent work' }],
      },
    ]);
    await parent.flush();
    const journal = await createChildSessionJournal(journalOptions(chatsDir));
    await recordRowsForTest(journal.recording, [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'child work' }],
      },
    ]);
    await journal.recording.flush();
    const parentPath = parent.getFilePath();
    expect(parentPath).not.toBeNull();
    if (parentPath === null) throw new Error('Missing parent file');
    const saved = await readJournalSnapshot(parentPath, PROJECT_HASH);
    expect(saved.history.map((row) => row.blocks)).toStrictEqual([
      [{ type: 'text', text: 'parent work' }],
    ]);
    expect(journal.recording.getFilePath()).not.toBe(parentPath);
    await journal.dispose();
    await parent.dispose();
  });
});
