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
 * History conversion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { performResume } from '../services/performResume.js';
import {
  cleanupSessionBrowserTestState,
  createSessionBrowserTestState,
  createTestSession,
  makeContent,
  makeResumeContext,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('History conversion #2', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  /**
   * Test 10: IContent to HistoryItem conversion
   * @requirement REQ-CV-002
   */

  /**
   * Test 11: Resume returns correct history
   * @requirement REQ-CV-001
   */
  it('resume returns correct history @requirement:REQ-CV-001', async () => {
    const targetId = 'session-with-history';
    await createTestSession(state.chatsDir, {
      sessionId: targetId,
      contents: [
        makeContent('first question', 'human'),
        makeContent('first answer', 'ai'),
        makeContent('second question', 'human'),
        makeContent('second answer', 'ai'),
      ],
    });

    const context = makeResumeContext(state.chatsDir, {
      currentSessionId: 'other-session',
    });

    const result = await performResume(targetId, context);

    expect(result.ok).toBe(true);
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!result.ok) throw new Error('unreachable: narrowing failed');
    expect(result.history).toHaveLength(4);
    expect(result.history[0].speaker).toBe('human');
    expect(result.history[0].blocks[0]).toMatchObject({
      type: 'text',
      text: 'first question',
    });
    expect(result.history[1].speaker).toBe('ai');
    expect(result.history[1].blocks[0]).toMatchObject({
      type: 'text',
      text: 'first answer',
    });
    expect(result.history[2].speaker).toBe('human');
    expect(result.history[2].blocks[0]).toMatchObject({
      type: 'text',
      text: 'second question',
    });
    expect(result.history[3].speaker).toBe('ai');
    expect(result.history[3].blocks[0]).toMatchObject({
      type: 'text',
      text: 'second answer',
    });

    const newLock = context.recordingCallbacks.getCurrentLockHandle();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (newLock) state.lockHandles.push(newLock);
  });
});
