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
 * Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { performResume } from '../services/performResume.js';
import {
  cleanupSessionBrowserTestState,
  createEmptySession,
  createSessionBrowserTestState,
  createTestSession,
  delay,
  makeResumeContext,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Error handling #2', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  /**
   * Test 15: Discovery failure produces error state
   * @requirement REQ-EH-001
   */

  /**
   * Test 16: performResume "latest" skips empty sessions
   * @requirement REQ-EN-002
   */
  it('performResume "latest" skips empty sessions @requirement:REQ-EN-002', async () => {
    // Create an empty session (newest)
    await createEmptySession(state.chatsDir, 'empty-session-newest');
    await delay(50);

    // Create a session with content (older)
    const { sessionId: contentSessionId } = await createTestSession(
      state.chatsDir,
      {
        messages: [{ speaker: 'user', text: 'has content' }],
      },
    );
    await delay(50);

    // Create another empty session (oldest)
    await createEmptySession(state.chatsDir, 'empty-session-oldest');

    const context = makeResumeContext(state.chatsDir, {
      currentSessionId: 'different-session',
    });

    const result = await performResume('latest', context);

    expect(result.ok).toBe(true);
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!result.ok) throw new Error('unreachable: narrowing failed');
    // Should have skipped the empty session and picked the one with content
    expect(result.metadata.sessionId).toBe(contentSessionId);
    expect(result.history[0].blocks[0]).toMatchObject({
      type: 'text',
      text: 'has content',
    });

    const newLock = context.recordingCallbacks.getCurrentLockHandle();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (newLock) state.lockHandles.push(newLock);
  });
});
