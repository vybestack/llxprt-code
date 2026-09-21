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

import { randomUUID } from 'node:crypto';
import {
  appendFile as fsAppendFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { createChildSessionJournal } from './childJournal.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionLockManager } from './SessionLockManager.js';
import type { RecordingWriterIo } from './types.js';

const PROJECT_HASH = 'p05c-lifecycle-hash';

let fixtureDir: string | null = null;

afterEach(async () => {
  if (fixtureDir !== null) {
    await rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = null;
  }
});

async function makeChatsDir(): Promise<string> {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'p05c-lifecycle-'));
  return path.join(fixtureDir, 'chats');
}

interface GatedWriterIo extends RecordingWriterIo {
  failNow(): void;
}

/** Allows `allowed` appends through, then fails every later append. */
function gatedWriterIo(allowed: number): GatedWriterIo {
  let calls = 0;
  return {
    async appendFile(
      filePath: string,
      data: string,
      encoding: 'utf8',
    ): Promise<void> {
      calls += 1;
      if (calls > allowed) throw new Error('injected append failure');
      await fsAppendFile(filePath, data, encoding);
    },
    failNow(): void {
      calls = allowed;
    },
  };
}

function journalOptions(
  chatsDir: string,
  io?: RecordingWriterIo,
): {
  parentSessionId: string;
  projectHash: string;
  chatsDir: string;
  workspaceDirs: string[];
  provider: string;
  model: string;
  io?: RecordingWriterIo;
} {
  return {
    parentSessionId: randomUUID(),
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/w'],
    provider: 'anthropic',
    model: 'claude-4',
    ...(io === undefined ? {} : { io }),
  };
}

async function lockExists(chatsDir: string): Promise<boolean> {
  const entries = await readdir(chatsDir);
  return entries.some((entry) => entry.endsWith('.lock'));
}

async function jsonlCount(chatsDir: string): Promise<number> {
  const entries = await readdir(chatsDir);
  return entries.filter((entry) => entry.startsWith('session-')).length;
}

describe('P05c child journal lifecycle @plan:PLAN-20260917-ISSUE854.P05c', () => {
  it('materializes a locked child journal under its own file', async () => {
    const chatsDir = await makeChatsDir();
    const journal = await createChildSessionJournal(journalOptions(chatsDir));
    journal.recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'child work' }],
    });
    await journal.recording.flush();
    const filePath = journal.recording.getFilePath();
    expect(filePath).not.toBeNull();
    expect(existsSync(filePath as string)).toBe(true);
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
    expect(await jsonlCount(chatsDir)).toBe(0);
    expect(await lockExists(chatsDir)).toBe(false);
  });

  it('dispose is idempotent', async () => {
    const chatsDir = await makeChatsDir();
    const journal = await createChildSessionJournal(journalOptions(chatsDir));
    await journal.dispose();
    await expect(journal.dispose()).resolves.toBeUndefined();
  });

  it('an init failure leaves no journal or lock behind', async () => {
    const chatsDir = await makeChatsDir();
    const io = gatedWriterIo(0);
    let error: unknown = null;
    try {
      await createChildSessionJournal(journalOptions(chatsDir, io));
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(await jsonlCount(chatsDir)).toBe(0);
    expect(await lockExists(chatsDir)).toBe(false);
  });

  it('a mid-life write failure still cleans up on dispose', async () => {
    const chatsDir = await makeChatsDir();
    const io = gatedWriterIo(1);
    const journal = await createChildSessionJournal(
      journalOptions(chatsDir, io),
    );
    io.failNow();
    await journal.dispose();
    expect(await jsonlCount(chatsDir)).toBe(0);
    expect(await lockExists(chatsDir)).toBe(false);
  });

  it('the parent journal stays one task group, isolated from children', async () => {
    const chatsDir = await makeChatsDir();
    const parent = await SessionRecordingService.createLocked({
      sessionId: randomUUID(),
      projectHash: PROJECT_HASH,
      chatsDir,
      workspaceDirs: ['/w'],
      provider: 'anthropic',
      model: 'claude-4',
    });
    parent.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'parent work' }],
    });
    await parent.flush();
    const journal = await createChildSessionJournal(journalOptions(chatsDir));
    journal.recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'child work' }],
    });
    await journal.recording.flush();
    const parentPath = parent.getFilePath();
    expect(parentPath).not.toBeNull();
    const raw = await readFile(parentPath as string, 'utf8');
    expect(raw).not.toContain('child work');
    expect(journal.recording.getFilePath()).not.toBe(parentPath);
    await journal.dispose();
    await parent.dispose();
  });
});
