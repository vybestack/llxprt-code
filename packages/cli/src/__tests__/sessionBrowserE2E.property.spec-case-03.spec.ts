/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P30
 * @plan PLAN-20260214-SESSIONBROWSER.P31
 * @requirement REQ-SW-001, REQ-SW-002, REQ-SW-003, REQ-SW-006, REQ-SW-007
 * @requirement REQ-EN-001, REQ-EN-002, REQ-EN-004
 * @requirement REQ-EH-001, REQ-EH-004
 * @requirement REQ-CV-001, REQ-CV-002
 * @requirement REQ-PR-001, REQ-PR-003
 * Property-based tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { performResume } from '../services/performResume.js';
import {
  PROJECT_HASH,
  cleanupSessionBrowserTestState,
  createSessionBrowserTestState,
  createTestSession,
  makeResumeContext,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

async function createPropertySession(ref: string): Promise<{
  localTempDir: string;
  result: Awaited<ReturnType<typeof performResume>>;
  context: ReturnType<typeof makeResumeContext>;
}> {
  const localTempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'prop-union-e2e-'),
  );
  const localChatsDir = path.join(localTempDir, 'chats');
  await fs.mkdir(localChatsDir, { recursive: true });

  await createTestSession(localChatsDir, {
    projectHash: PROJECT_HASH,
    messages: [{ speaker: 'user', text: 'test content' }],
  });

  const context = makeResumeContext(localChatsDir, {
    currentSessionId: 'other-session',
  });

  return {
    localTempDir,
    result: await performResume(ref, context),
    context,
  };
}

function expectDiscriminatedResumeResult(
  result: Awaited<ReturnType<typeof performResume>>,
): void {
  expect(typeof result.ok).toBe('boolean');
  expect(result).toHaveProperty('ok');

  if (result.ok) {
    expect(result).toHaveProperty('history');
    expect(result).toHaveProperty('metadata');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.history)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    return;
  }

  expect(result).toHaveProperty('error');
  expect(typeof result.error).toBe('string');
  expect(result.error.length).toBeGreaterThan(0);
}

describe('Property-based tests #3', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  /**
   * Test 17: Any valid session index resolves correctly
   * @requirement REQ-EN-004
   */

  /**
   * Test 19: performResume always returns discriminated union
   * @requirement REQ-PR-003
   */
  it('performResume always returns discriminated union @requirement:REQ-PR-003', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant('latest'),
          fc.constant('1'),
          fc.constant('999'),
          fc.string({ minLength: 1, maxLength: 20 }),
        ),
        async (ref) => {
          const { context, localTempDir, result } =
            await createPropertySession(ref);

          try {
            expectDiscriminatedResumeResult(result);

            const newLock = context.recordingCallbacks.getCurrentLockHandle();
            if (newLock) await newLock.release();
          } finally {
            await fs.rm(localTempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});
