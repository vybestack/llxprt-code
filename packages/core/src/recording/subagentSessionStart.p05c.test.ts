/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from './journalRecordingService.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import { JournalSession } from '../services/history/journalSession.js';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { SessionLockManager } from './SessionLockManager.js';

const PROJECT_HASH = 'p05c-start-hash';

let fixtureDir: string | null = null;

async function makeChatsDir(): Promise<string> {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'p05c-start-'));
  return path.join(fixtureDir, 'chats');
}

function baseConfig(
  chatsDir: string,
  sessionId: string,
): JournalRecordingConfig {
  return {
    sessionId,
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/w'],
    provider: 'anthropic',
    model: 'claude-4',
  };
}

async function readStartPayload(recording: JournalRecordingService) {
  const filePath = recording.getFilePath();
  expect(filePath).not.toBeNull();
  if (filePath === null) throw new Error('Missing child journal');
  const facts = await readJournalFileFacts(filePath);
  if (facts === undefined) throw new Error('Missing child session facts');
  return facts.facts.start;
}

async function materializedRecording(
  config: JournalRecordingConfig,
): Promise<JournalRecordingService> {
  const recording = await JournalRecordingService.createLocked(config);
  await (
    await recording.session()
  ).append([
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'seed' }],
    },
  ]);
  await recording.flush();
  return recording;
}

async function cleanupFixture(): Promise<void> {
  if (fixtureDir !== null) {
    await rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = null;
  }
}

describe('P05c session_start payload extension @plan:PLAN-20260917-ISSUE854.P05c', () => {
  afterEach(cleanupFixture);

  it('stamps kind=subagent and parentSessionId onto child journals', async () => {
    const chatsDir = await makeChatsDir();
    const parentId = randomUUID();
    const childId = randomUUID();
    const recording = await materializedRecording({
      ...baseConfig(chatsDir, childId),
      kind: 'subagent',
      parentSessionId: parentId,
    });
    const payload = await readStartPayload(recording);
    await recording.dispose();
    expect(payload['kind']).toBe('subagent');
    expect(payload['parentSessionId']).toBe(parentId);
  });

  it('stamps kind=main onto ordinary sessions', async () => {
    const chatsDir = await makeChatsDir();
    const recording = await materializedRecording(
      baseConfig(chatsDir, randomUUID()),
    );
    const payload = await readStartPayload(recording);
    await recording.dispose();
    expect(payload['kind']).toBe('main');
    expect('parentSessionId' in payload).toBe(false);
  });

  it('reads kind and parentSessionId from a child journal', async () => {
    const chatsDir = await makeChatsDir();
    const parentId = randomUUID();
    const childId = randomUUID();
    const recording = await materializedRecording({
      ...baseConfig(chatsDir, childId),
      kind: 'subagent',
      parentSessionId: parentId,
    });
    try {
      const metadata = await readStartPayload(recording);
      expect(metadata.kind).toBe('subagent');
      expect(metadata.parentSessionId).toBe(parentId);
    } finally {
      await recording.dispose();
    }
  });

  it('refuses retired journals without kind rather than normalizing them as main', async () => {
    const chatsDir = await makeChatsDir();
    await mkdir(chatsDir, { recursive: true });
    const filePath = path.join(chatsDir, 'session-retired.jsonl');
    await writeFile(
      filePath,
      JSON.stringify({
        v: 1,
        seq: 1,
        type: 'session_start',
        payload: { sessionId: randomUUID(), projectHash: PROJECT_HASH },
      }),
    );
    await expect(JournalSession.open(filePath)).rejects.toThrow(
      retiredJournalMessage(filePath),
    );
  });
});

describe('P05c lock grammar and filename bucketing @plan:PLAN-20260917-ISSUE854.P05c', () => {
  afterEach(cleanupFixture);

  it('rejects the `::`/`#` child ids the orchestrator builds today', async () => {
    const chatsDir = await makeChatsDir();
    const parent = 'primary-session';
    const todayShape = `${parent}::${parent}#helper#abcd1234`;
    expect(() => SessionLockManager.getLockPath(chatsDir, todayShape)).toThrow(
      /Unsafe session ID/,
    );
  });

  it('gives two fs-safe child ids distinct files and locks in one bucket', async () => {
    const chatsDir = await makeChatsDir();
    const first = await materializedRecording(
      baseConfig(chatsDir, randomUUID()),
    );
    const second = await materializedRecording(
      baseConfig(chatsDir, randomUUID()),
    );
    const firstPath = first.getFilePath();
    const secondPath = second.getFilePath();
    expect(firstPath).not.toBeNull();
    expect(secondPath).not.toBeNull();
    expect(firstPath).not.toBe(secondPath);
    if (firstPath === null || secondPath === null)
      throw new Error('Missing child recording');
    expect(existsSync(firstPath)).toBe(true);
    expect(existsSync(secondPath)).toBe(true);
    await first.dispose();
    await second.dispose();
  });

  it('refuses a second recording over an id that is still locked', async () => {
    const chatsDir = await makeChatsDir();
    const sessionId = randomUUID();
    const first = await JournalRecordingService.createLocked(
      baseConfig(chatsDir, sessionId),
    );
    let secondError: unknown = null;
    try {
      await JournalRecordingService.createLocked(
        baseConfig(chatsDir, sessionId),
      );
    } catch (error: unknown) {
      secondError = error;
    }
    expect(secondError).toBeInstanceOf(Error);
    if (!(secondError instanceof Error)) throw new Error('Missing lock error');
    expect(secondError.name).toBe('SessionLockedError');
    await first.dispose();
  });

  it('releases the lock when a child recording is disposed', async () => {
    const chatsDir = await makeChatsDir();
    const sessionId = randomUUID();
    const recording = await materializedRecording(
      baseConfig(chatsDir, sessionId),
    );
    expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(true);
    await recording.dispose();
    expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(false);
  });
});
