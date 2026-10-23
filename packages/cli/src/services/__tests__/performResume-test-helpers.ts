/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readRecordedRows } from '../../__tests__/journal-recording.js';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createSessionRecorder,
  type SessionRecordingPort,
  SessionLockManager,
  type RecordingIntegration,
  type LockHandle,
  type SessionRecordingServiceConfig,
  type IContent,
} from '@vybestack/llxprt-code-core';
import {
  performResume,
  type ResumeContext,
  type RecordingSwapCallbacks,
  type PerformResumeResult,
} from '../performResume.js';

export { performResume, createSessionRecorder, SessionLockManager };
export type {
  ResumeContext,
  RecordingSwapCallbacks,
  PerformResumeResult,
  RecordingIntegration,
  SessionRecordingPort,
  LockHandle,
  SessionRecordingServiceConfig,
  IContent,
};

type HasPropertyAssertion = {
  toHaveProperty: (key: string) => void;
};

type ExpectLike = (actual: unknown) => HasPropertyAssertion;

const resumedRecordings = new Set<SessionRecordingPort>();
const resumedIntegrations = new Set<RecordingIntegration>();

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
  service: SessionRecordingPort;
}> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const config = makeConfig(chatsDir, {
    sessionId,
    projectHash: opts.projectHash,
    provider: opts.provider,
    model: opts.model,
  });
  const svc = createSessionRecorder(config);

  const contents = opts.contents ?? [makeContent('hello')];
  for (const content of contents) {
    await recordRowsForTest(svc, [content]);
  }
  await svc.flush();

  const filePath = svc.getFilePath()!;
  await svc.dispose();
  return { filePath, sessionId, service: svc };
}

export function makeResumeContext(
  chatsDir: string,
  opts: {
    currentSessionId?: string;
    provider?: string;
    model?: string;
    currentRecording?: SessionRecordingPort | null;
    currentIntegration?: RecordingIntegration | null;
    currentLockHandle?: LockHandle | null;
  } = {},
): ResumeContext {
  let recording = opts.currentRecording ?? null;
  let integration = opts.currentIntegration ?? null;
  let lockHandle = opts.currentLockHandle ?? null;
  let metadata: ReturnType<RecordingSwapCallbacks['getCurrentMetadata']> = null;
  void opts.currentSessionId;

  const callbacks: RecordingSwapCallbacks = {
    getCurrentRecording: () => recording,
    getCurrentIntegration: () => integration,
    getCurrentLockHandle: () => lockHandle,
    getCurrentMetadata: () => metadata,
    setRecording: (newRecording, newIntegration, newLock, newMetadata) => {
      if (newRecording !== null) resumedRecordings.add(newRecording);
      if (newIntegration !== null) resumedIntegrations.add(newIntegration);
      recording = newRecording;
      integration = newIntegration;
      lockHandle = newLock;
      metadata = newMetadata;
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

export async function countFileEvents(filePath: string): Promise<number> {
  return (await readRecordedRows(filePath)).length;
}

export function extractSessionId(filePath: string): string {
  const basename = path.basename(filePath);
  const match = basename.match(/^session-(.+)\.llxj$/);
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
  recordingsToDispose: SessionRecordingPort[] = [];

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
    for (const integration of resumedIntegrations) await integration.dispose();
    resumedIntegrations.clear();
    for (const recording of resumedRecordings) await recording.dispose();
    resumedRecordings.clear();
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
