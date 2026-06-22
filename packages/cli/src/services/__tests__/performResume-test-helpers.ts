/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SessionRecordingService,
  SessionLockManager,
  type RecordingIntegration,
  type LockHandle,
  type SessionRecordingServiceConfig,
  type SessionRecordLine,
  type IContent,
} from '@vybestack/llxprt-code-core';
import {
  performResume,
  type ResumeContext,
  type RecordingSwapCallbacks,
  type PerformResumeResult,
} from '../performResume.js';

export { performResume, SessionRecordingService, SessionLockManager };
export type {
  ResumeContext,
  RecordingSwapCallbacks,
  PerformResumeResult,
  RecordingIntegration,
  LockHandle,
  SessionRecordingServiceConfig,
  SessionRecordLine,
  IContent,
};

type HasPropertyAssertion = {
  toHaveProperty: (key: string) => void;
};

type ExpectLike = (actual: unknown) => HasPropertyAssertion;

export const PROJECT_HASH = 'test-project-hash-pr';

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

export async function createSessionWithCorruptLine(
  chatsDir: string,
  sessionId: string,
): Promise<string> {
  const config = makeConfig(chatsDir, { sessionId, projectHash: PROJECT_HASH });
  const svc = new SessionRecordingService(config);

  svc.recordContent(makeContent('Show me the file', 'human'));

  await svc.flush();

  const filePath = svc.getFilePath()!;
  await svc.dispose();

  const fileContent = await fs.readFile(filePath, 'utf-8');
  const lines = fileContent.trim().split('\n');

  const corruptLine = '{this is not valid JSON}';

  const newContent =
    [lines[0], corruptLine, ...lines.slice(1)].join('\n') + '\n';
  await fs.writeFile(filePath, newContent);

  return filePath;
}

export function makeResumeContext(
  chatsDir: string,
  opts: {
    currentSessionId?: string;
    provider?: string;
    model?: string;
    currentRecording?: SessionRecordingService | null;
    currentIntegration?: RecordingIntegration | null;
    currentLockHandle?: LockHandle | null;
  } = {},
): ResumeContext {
  let recording = opts.currentRecording ?? null;
  let integration = opts.currentIntegration ?? null;
  let lockHandle = opts.currentLockHandle ?? null;
  void opts.currentSessionId;

  const callbacks: RecordingSwapCallbacks = {
    getCurrentRecording: () => recording,
    getCurrentIntegration: () => integration,
    getCurrentLockHandle: () => lockHandle,
    setRecording: (newRecording, newIntegration, newLock, _newMetadata) => {
      recording = newRecording;
      integration = newIntegration;
      lockHandle = newLock;
    },
  };

  return {
    chatsDir,
    projectHash: PROJECT_HASH,
    currentSessionId: opts.currentSessionId ?? 'current-session',
    currentProvider: opts.provider ?? 'anthropic',
    currentModel: opts.model ?? 'claude-4',
    workspaceDirs: ['/test/workspace'],
    recordingCallbacks: callbacks,
  };
}

export async function readJsonlFile(
  filePath: string,
): Promise<SessionRecordLine[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const lines = raw.trim().split('\n');
  return lines.map((line) => JSON.parse(line) as SessionRecordLine);
}

export async function countFileEvents(filePath: string): Promise<number> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw.trim().split('\n').length;
}

export function extractSessionId(filePath: string): string {
  const basename = path.basename(filePath);
  const match = basename.match(/^session-(.+)\.jsonl$/);
  if (!match) throw new Error(`Invalid session file path: ${filePath}`);
  return match[1];
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Type-narrowing assertion that a PerformResumeResult is a success.
 * Implemented as a TypeScript assertion function so the caller's `result`
 * is narrowed to the success branch without reassignment. The conditional
 * lives inside this module-scope helper (not the test body), satisfying
 * vitest/no-conditional-in-test.
 */
export function assertResumeOk(
  result: PerformResumeResult,
): asserts result is Extract<PerformResumeResult, { ok: true }> {
  if (!result.ok) {
    throw new Error('unreachable: narrowing failed');
  }
}

/**
 * Type-narrowing assertion that a PerformResumeResult is a failure.
 * Implemented as a TypeScript assertion function so the caller's `result`
 * is narrowed to the error branch without reassignment. The conditional
 * lives inside this module-scope helper (not the test body), satisfying
 * vitest/no-conditional-in-test.
 */
export function assertResumeError(
  result: PerformResumeResult,
): asserts result is Extract<PerformResumeResult, { ok: false }> {
  if (result.ok) {
    throw new Error('unreachable: narrowing failed');
  }
}

/**
 * Conditionally collects a lock handle into the provided array when present.
 * The conditional lives inside this module-scope helper (not the test body),
 * satisfying vitest/no-conditional-in-test.
 */
export function collectLock(
  handles: LockHandle[],
  handle: LockHandle | null | undefined,
): void {
  if (handle) {
    handles.push(handle);
  }
}

/**
 * Conditionally releases a lock handle when present. The conditional lives
 * inside this module-scope helper (not the test body), satisfying
 * vitest/no-conditional-in-test.
 */
export async function releaseLock(
  handle: LockHandle | null | undefined,
): Promise<void> {
  if (handle) {
    await handle.release();
  }
}

/**
 * Validates that a PerformResumeResult conforms to its discriminated union
 * shape. The branch selection and the assertion calls live inside this
 * module-scope helper (not the test body), satisfying
 * vitest/no-conditional-expect. The caller passes the vitest `expect` so
 * assertions still run in the original test context.
 */
export function expectResultDiscriminated(
  result: PerformResumeResult,
  expect: ExpectLike,
): void {
  if (result.ok) {
    expect(result).toHaveProperty('history');
    expect(result).toHaveProperty('metadata');
    expect(result).toHaveProperty('warnings');
  } else {
    expect(result).toHaveProperty('error');
  }
}

/**
 * Encapsulates per-test temp directory state and cleanup for performResume
 * test files. Each split test file creates its own instance in a top-level
 * describe and wires beforeEach/afterEach to setup/cleanup.
 */
export class ResumeTestSetup {
  tempDir = '';
  chatsDir = '';
  lockHandles: LockHandle[] = [];
  recordingsToDispose: SessionRecordingService[] = [];

  async beforeEach(): Promise<void> {
    this.tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'perform-resume-test-'),
    );
    this.chatsDir = path.join(this.tempDir, 'chats');
    await fs.mkdir(this.chatsDir, { recursive: true });
    this.lockHandles = [];
    this.recordingsToDispose = [];
  }

  async afterEach(): Promise<void> {
    for (const handle of this.lockHandles) {
      try {
        await handle.release();
      } catch {
        // Ignore release errors during cleanup
      }
    }
    for (const recording of this.recordingsToDispose) {
      try {
        await recording.dispose();
      } catch {
        // Ignore dispose errors during cleanup
      }
    }
    await fs.rm(this.tempDir, { recursive: true, force: true });
  }
}
