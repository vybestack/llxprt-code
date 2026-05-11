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
  makeResumeContext,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Core resume flow #6', () => {
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
   * Test 6: performResume returns error for current session
   * @requirement REQ-PR-003
   */
  it('performResume returns error for current session @requirement:REQ-PR-003', async () => {
    const sessionId = 'current-active-session';
    await createTestSession(state.chatsDir, {
      sessionId,
      messages: [{ speaker: 'user', text: 'current content' }],
    });

    const context = makeResumeContext(state.chatsDir, {
      currentSessionId: sessionId,
    });

    const result = await performResume(sessionId, context);

    expect(result.ok).toBe(false);
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (result.ok) throw new Error('unreachable: narrowing failed');
    expect(result.error).toBe('That session is already active.');
  });
});
