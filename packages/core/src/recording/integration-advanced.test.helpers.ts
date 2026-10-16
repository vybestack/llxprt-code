/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { it, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { CONTINUE_LATEST, type ResumeRequest } from './resumeSession.js';
import type {
  ReplayResult,
  SessionRecordingServiceConfig,
  SessionRecordLine,
} from './types.js';
import type { IContent } from '../services/history/IContent.js';

// Polyfill it.prop for Bun compatibility
type ItPropOverload = {
  <T extends Array<fc.Arbitrary<unknown>>>(
    arbitraries: T,
    options?: { numRuns?: number },
  ): (
    name: string,
    callback: (
      ...args: {
        [K in keyof T]: T[K] extends fc.Arbitrary<infer U> ? U : never;
      }
    ) => Promise<void> | void,
  ) => void;
  <T extends Array<fc.Arbitrary<unknown>>>(
    arbitraries: T,
  ): (
    name: string,
    callback: (
      ...args: {
        [K in keyof T]: T[K] extends fc.Arbitrary<infer U> ? U : never;
      }
    ) => Promise<void> | void,
  ) => void;
};

export const itProp: ItPropOverload =
  (arbitraries: Array<fc.Arbitrary<unknown>>, options?: { numRuns?: number }) =>
  (
    name: string,
    callback: (...args: unknown[]) => Promise<void> | void,
  ): void => {
    const testFn = it;
    testFn(name, async () => {
      await fc.assert(
        fc.asyncProperty(fc.tuple(...arbitraries), async (args) => {
          await callback(...args);
        }),
        options,
      );
    });
  };

// NOTE: it.prop is replaced by itProp throughout this file for Bun
// compatibility (Bun's `it` function is frozen and cannot be extended).

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROJECT_HASH = 'integration-test-project';

type ReplayOkResult = Extract<ReplayResult, { ok: true }>;
export function assertReplayOk(
  result: ReplayResult,
): asserts result is ReplayOkResult {
  expect(result.ok).toBe(true);
}

export function assertReplayError<T extends { ok: boolean }>(
  result: T,
): asserts result is Extract<T, { ok: false }> {
  expect(result.ok).toBe(false);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

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

/**
 * Alternating human/ai speaker for index-based content generation.
 */
export function alternatingSpeaker(i: number): 'human' | 'ai' {
  return i % 2 === 0 ? 'human' : 'ai';
}

/**
 * Create a real session file, flush, dispose, and return file path + session ID.
 */
export async function createAndRecordSession(
  chatsDir: string,
  opts: {
    sessionId?: string;
    projectHash?: string;
    provider?: string;
    model?: string;
    contents: IContent[];
  },
): Promise<{ filePath: string; sessionId: string }> {
  const sid = opts.sessionId ?? crypto.randomUUID();
  const svc = new SessionRecordingService(
    makeConfig(chatsDir, {
      sessionId: sid,
      projectHash: opts.projectHash,
      provider: opts.provider,
      model: opts.model,
    }),
  );
  for (const c of opts.contents) {
    svc.recordContent(c);
  }
  await svc.flush();
  const fp = svc.getFilePath()!;
  await svc.dispose();
  return { filePath: fp, sessionId: sid };
}

/**
 * Read a JSONL file and parse all lines.
 */
export async function readJsonlLines(
  filePath: string,
): Promise<SessionRecordLine[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((line) => JSON.parse(line) as SessionRecordLine);
}

export function makeResumeRequest(
  chatsDir: string,
  continueRef: string | typeof CONTINUE_LATEST = CONTINUE_LATEST,
  overrides: Partial<ResumeRequest> = {},
): ResumeRequest {
  return {
    continueRef,
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir,
    currentProvider: overrides.currentProvider ?? 'anthropic',
    currentModel: overrides.currentModel ?? 'claude-4',
    workspaceDirs: overrides.workspaceDirs ?? ['/test/workspace'],
  };
}

export function useIntegrationDirs(): { readonly chatsDir: string } {
  let tempDir = '';
  let chatsDir = '';
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  return {
    get chatsDir() {
      return chatsDir;
    },
  };
}
