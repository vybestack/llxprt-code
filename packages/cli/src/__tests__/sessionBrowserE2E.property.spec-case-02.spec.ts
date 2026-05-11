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

describe('Property-based tests #2', () => {
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
   * Test 18: Any session ID prefix resolves if unique
   * @requirement REQ-PR-001
   */
  it('any session ID prefix resolves if unique @requirement:REQ-PR-001', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 5, maxLength: 15 }),
        async (rawId) => {
          // Sanitize to valid session ID
          const sessionId = `unique-${rawId.replace(/[^a-zA-Z0-9-]/g, 'x')}`;

          const localTempDir = await fs.mkdtemp(
            path.join(os.tmpdir(), 'prop-prefix-e2e-'),
          );
          const localChatsDir = path.join(localTempDir, 'chats');
          await fs.mkdir(localChatsDir, { recursive: true });

          try {
            await createTestSession(localChatsDir, {
              sessionId,
              projectHash: PROJECT_HASH,
              messages: [{ speaker: 'user', text: 'content' }],
            });

            const context = makeResumeContext(localChatsDir, {
              currentSessionId: 'other-session',
            });

            // Use the unique prefix "unique-"
            const result = await performResume('unique-', context);

            expect(result.ok).toBe(true);
            if (!result.ok) throw new Error('unreachable: narrowing failed');
            expect(result.metadata.sessionId).toBe(sessionId);

            const newLock = context.recordingCallbacks.getCurrentLockHandle();
            if (newLock) await newLock.release();
          } finally {
            await fs.rm(localTempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 5 },
    );
  });
});
