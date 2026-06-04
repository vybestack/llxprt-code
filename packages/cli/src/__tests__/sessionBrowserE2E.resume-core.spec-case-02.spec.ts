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
 * Core resume flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { performResume } from '../services/performResume.js';
import {
  cleanupSessionBrowserTestState,
  createSessionBrowserTestState,
  createTestSession,
  delay,
  makeResumeContext,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Core resume flow #2', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  /**
   * Test 1: performResume resolves "latest" to newest unlocked session
   * @requirement REQ-EN-002, REQ-PR-001
   */

  /**
   * Test 2: performResume resolves numeric index
   * @requirement REQ-EN-004, REQ-PR-001
   */
  it('performResume resolves numeric index @requirement:REQ-EN-004,REQ-PR-001', async () => {
    // Create session 1 (will be index 2 since newest first)
    await createTestSession(state.chatsDir, {
      messages: [{ speaker: 'user', text: 'first session' }],
    });
    await delay(50);

    // Create session 2 (will be index 1)
    const { sessionId: newestSessionId } = await createTestSession(
      state.chatsDir,
      {
        messages: [{ speaker: 'user', text: 'second session' }],
      },
    );

    const context = makeResumeContext(state.chatsDir, {
      currentSessionId: 'different-session',
    });

    const result = await performResume('1', context);

    expect(result.ok).toBe(true);
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!result.ok) throw new Error('unreachable: narrowing failed');
    expect(result.metadata.sessionId).toBe(newestSessionId);
    expect(result.history[0].blocks[0]).toMatchObject({
      type: 'text',
      text: 'second session',
    });

    const newLock = context.recordingCallbacks.getCurrentLockHandle();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (newLock) state.lockHandles.push(newLock);
  });
});
