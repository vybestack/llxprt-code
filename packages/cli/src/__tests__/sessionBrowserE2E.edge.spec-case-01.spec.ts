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
 * Edge cases
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

describe('Edge cases #1', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  it('handles empty sessions (no content events)', async () => {
    // Create empty session
    await createEmptySession(state.chatsDir, 'empty-session');
    await delay(50);

    // Create session with content
    const { sessionId: contentSessionId } = await createTestSession(
      state.chatsDir,
      {
        messages: [{ speaker: 'user', text: 'has content' }],
      },
    );

    const context = makeResumeContext(state.chatsDir, {
      currentSessionId: 'different-session',
    });

    const result = await performResume('latest', context);

    expect(result.ok).toBe(true);
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!result.ok) throw new Error('unreachable: narrowing failed');
    // Should skip empty and pick the one with content
    expect(result.metadata.sessionId).toBe(contentSessionId);

    const newLock = context.recordingCallbacks.getCurrentLockHandle();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (newLock) state.lockHandles.push(newLock);
  });
});
