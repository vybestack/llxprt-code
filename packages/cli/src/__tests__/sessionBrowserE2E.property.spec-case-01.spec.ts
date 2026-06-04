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
  delay,
  makeResumeContext,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Property-based tests #1', () => {
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
   * Test 17: Any valid session index resolves correctly
   * @requirement REQ-EN-004
   */
  it('any valid session index resolves correctly @requirement:REQ-EN-004', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (sessionCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-index-e2e-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          // Create N sessions
          const sessionIds: string[] = [];
          for (let i = 0; i < sessionCount; i++) {
            const { sessionId } = await createTestSession(localChatsDir, {
              projectHash: PROJECT_HASH,
              messages: [{ speaker: 'user', text: `session ${i + 1}` }],
            });
            sessionIds.push(sessionId);
            await delay(20);
          }

          // Pick a random valid index
          const validIndex = Math.floor(Math.random() * sessionCount) + 1;

          const context = makeResumeContext(localChatsDir, {
            currentSessionId: 'other-session',
          });

          const result = await performResume(String(validIndex), context);

          expect(result.ok).toBe(true);
          if (!result.ok) throw new Error('unreachable: narrowing failed');
          // Index is 1-based, newest first
          const expectedSessionId = sessionIds[sessionCount - validIndex];
          expect(result.metadata.sessionId).toBe(expectedSessionId);

          const newLock = context.recordingCallbacks.getCurrentLockHandle();
          if (newLock) await newLock.release();
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 5 },
    );
  });
});
