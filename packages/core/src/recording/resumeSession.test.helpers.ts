/**
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { type LockHandle } from './SessionLockManager.js';
import { CONTINUE_LATEST, type ResumeRequest } from './resumeSession.js';
import {
  type SessionRecordingServiceConfig,
  type SessionRecordLine,
} from './types.js';
import { type IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const PROJECT_HASH = 'test-project-hash-resume';

export function makeConfig(
  chatsDir: string,
  overrides: Partial<SessionRecordingServiceConfig> = {},
): SessionRecordingServiceConfig {
  return {
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir,
    workspaceDirs: overrides.workspaceDirs ?? ['/test/workspace'],
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-4',
  };
}

export function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

/**
 * Alternating human/ai speaker for index-based content generation.
 */
export function alternatingSpeaker(i: number): 'human' | 'ai' {
  return i % 2 === 0 ? 'human' : 'ai';
}

/**
 * True when the warning describes a JSON/parse problem.
 */
export function isParseWarning(w: string): boolean {
  return w.includes('parse') || w.includes('JSON');
}

/**
 * Create a real session file using SessionRecordingService, flush it,
 * and return its file path and sessionId.
 */
export async function createTestSession(
  chatsDir: string,
  opts: {
    sessionId?: string;
    projectHash?: string;
    provider?: string;
    model?: string;
    contents?: IContent[];
  } = {},
): Promise<{
  filePath: string;
  sessionId: string;
  service: SessionRecordingService;
}> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const config = makeConfig(chatsDir, {
    sessionId,
    projectHash: opts.projectHash,
    provider: opts.provider,
    model: opts.model,
  });
  const svc = new SessionRecordingService(config);

  const contents = opts.contents ?? [makeContent('hello')];
  for (const content of contents) {
    svc.recordContent(content);
  }
  await svc.flush();

  const filePath = svc.getFilePath()!;
  await svc.dispose();
  return { filePath, sessionId, service: svc };
}

/**
 * Build a ResumeRequest for the given chatsDir.
 */
export function makeResumeRequest(
  chatsDir: string,
  overrides: Partial<ResumeRequest> = {},
): ResumeRequest {
  return {
    continueRef: overrides.continueRef ?? CONTINUE_LATEST,
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir,
    currentProvider: overrides.currentProvider ?? 'anthropic',
    currentModel: overrides.currentModel ?? 'claude-4',
    workspaceDirs: overrides.workspaceDirs ?? ['/test/workspace'],
  };
}

/**
 * Read a JSONL file and parse each line into a SessionRecordLine.
 */
export async function readJsonlFile(
  filePath: string,
): Promise<SessionRecordLine[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const lines = raw.trim().split('\n');
  return lines.map((line) => JSON.parse(line) as SessionRecordLine);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Asserts the result is the success variant and returns it narrowed.
 * Couples the runtime check to the type narrowing so a caller cannot
 * reach the success fields without the assertion having passed.
 */
export function expectOk<T extends { ok: boolean }>(
  result: T,
): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  return result as Extract<T, { ok: true }>;
}

/**
 * Asserts the result is the failure variant and returns it narrowed.
 * Couples the runtime check to the type narrowing so a caller cannot
 * reach the failure fields without the assertion having passed.
 */
export function expectNotOk<T extends { ok: boolean }>(
  result: T,
): Extract<T, { ok: false }> {
  expect(result.ok).toBe(false);
  return result as Extract<T, { ok: false }>;
}

export async function collectBootRows(
  rows: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

export function useResumeFixture(): {
  chatsDir: () => string;
  lockHandles: LockHandle[];
} {
  let tempDir = '';
  const lockHandles: LockHandle[] = [];
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-session-test-'));
    await fs.mkdir(path.join(tempDir, 'chats'), { recursive: true });
  });
  afterEach(async () => {
    for (const handle of lockHandles.splice(0)) await handle.release();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  return { chatsDir: () => path.join(tempDir, 'chats'), lockHandles };
}
