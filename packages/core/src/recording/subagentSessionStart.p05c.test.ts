/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05c target contract: the `session_start` payload is extended with
 * `kind: 'main' | 'subagent'` plus an optional `parentSessionId` (present
 * only on child journals); replay normalizes legacy absence to `main`; and
 * the existing lock/filename machinery holds for fs-safe child ids while
 * rejecting today's `::`/`#` orchestrator ids.
 *
 * RED on assertion: every import below exists at HEAD; the `kind` and
 * `parentSessionId` fields do not, so the first three tests fail until the
 * green session extends the payload and the replay metadata view. The lock
 * grammar tests pin behavior that already works (signal, expected green).
 *
 * @plan:PLAN-20260917-ISSUE854.P05c
 * @requirement:G7
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  SessionRecordingService,
  type SessionRecordingServiceConfig,
} from './SessionRecordingService.js';
import { SessionLockManager } from './SessionLockManager.js';
import { replaySession } from './ReplayEngine.js';
import { sessionStartLine } from './replay-test-helpers.js';

/**
 * Proposed P05c extension of the recording config (tmp/verify854/p05c/api_sketch.md).
 * At HEAD these fields are ignored by the constructor — asserting on them is
 * the red.
 */
type SubagentRecordingConfig = SessionRecordingServiceConfig & {
  kind?: 'main' | 'subagent';
  parentSessionId?: string;
};

const PROJECT_HASH = 'p05c-start-hash';

let fixtureDir: string | null = null;

afterEach(async () => {
  if (fixtureDir !== null) {
    await rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = null;
  }
});

async function makeChatsDir(): Promise<string> {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'p05c-start-'));
  return path.join(fixtureDir, 'chats');
}

function baseConfig(
  chatsDir: string,
  sessionId: string,
): SubagentRecordingConfig {
  return {
    sessionId,
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/w'],
    provider: 'anthropic',
    model: 'claude-4',
  };
}

function observedStartPayload(raw: string): Record<string, unknown> {
  const firstLine = raw.split('\n')[0] ?? '';
  const parsed: unknown = JSON.parse(firstLine);
  expect(typeof parsed).toBe('object');
  const envelope = parsed as { payload?: Record<string, unknown> };
  const payload = envelope.payload;
  expect(typeof payload).toBe('object');
  return payload as Record<string, unknown>;
}

async function readStartPayload(
  recording: SessionRecordingService,
): Promise<Record<string, unknown>> {
  const filePath = recording.getFilePath();
  expect(filePath).not.toBeNull();
  const raw = await readFile(filePath as string, 'utf8');
  return observedStartPayload(raw);
}

async function materializedRecording(
  config: SubagentRecordingConfig,
): Promise<SessionRecordingService> {
  const recording = await SessionRecordingService.createLocked(config);
  recording.recordContent({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'seed' }],
  });
  await recording.flush();
  return recording;
}

describe('P05c session_start payload extension @plan:PLAN-20260917-ISSUE854.P05c', () => {
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

  it('replay exposes kind and parentSessionId from a child journal', async () => {
    const chatsDir = await makeChatsDir();
    const parentId = randomUUID();
    const childId = randomUUID();
    const childStart = JSON.stringify({
      v: 1,
      seq: 1,
      ts: '2026-02-11T16:00:00.000Z',
      type: 'session_start',
      payload: {
        sessionId: childId,
        projectHash: PROJECT_HASH,
        workspaceDirs: ['/w'],
        provider: 'anthropic',
        model: 'claude-4',
        startTime: '2026-02-11T16:00:00.000Z',
        kind: 'subagent',
        parentSessionId: parentId,
      },
    });
    const filePath = path.join(chatsDir, `session-${childId}.jsonl`);
    await mkdir(chatsDir, { recursive: true });
    await appendFile(filePath, `${childStart}\n`, 'utf8');
    const replay = await replaySession(filePath, PROJECT_HASH, {});
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.metadata.kind).toBe('subagent');
    expect(replay.metadata.parentSessionId).toBe(parentId);
  });

  it('replay reads legacy journals without kind as main', async () => {
    const chatsDir = await makeChatsDir();
    await mkdir(chatsDir, { recursive: true });
    const legacyId = randomUUID();
    const filePath = path.join(chatsDir, `session-${legacyId}.jsonl`);
    await appendFile(
      filePath,
      `${sessionStartLine(1, { sessionId: legacyId, projectHash: PROJECT_HASH })}\n`,
      'utf8',
    );
    const replay = await replaySession(filePath, PROJECT_HASH, {});
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.metadata.kind).toBe('main');
  });
});

describe('P05c lock grammar and filename bucketing @plan:PLAN-20260917-ISSUE854.P05c', () => {
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
    expect(existsSync(firstPath as string)).toBe(true);
    expect(existsSync(secondPath as string)).toBe(true);
    await first.dispose();
    await second.dispose();
  });

  it('refuses a second recording over an id that is still locked', async () => {
    const chatsDir = await makeChatsDir();
    const sessionId = randomUUID();
    const first = await SessionRecordingService.createLocked(
      baseConfig(chatsDir, sessionId),
    );
    let secondError: unknown = null;
    try {
      await SessionRecordingService.createLocked(
        baseConfig(chatsDir, sessionId),
      );
    } catch (error: unknown) {
      secondError = error;
    }
    expect(secondError).toBeInstanceOf(Error);
    expect((secondError as Error).name).toBe('SessionLockedError');
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
