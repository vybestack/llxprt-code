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
 * Two-phase swap
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionRecordingService } from '@vybestack/llxprt-code-core';
import { performResume } from '../services/performResume.js';
import {
  PROJECT_HASH,
  cleanupSessionBrowserTestState,
  createSessionBrowserTestState,
  createTestSession,
  makeConfig,
  makeContent,
  makeResumeContext,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Two-phase swap #1', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  /**
   * Test 7: New session acquired before old disposed
   * @requirement REQ-SW-001
   */

  /**
   * Test 7: New session acquired before old disposed
   * @requirement REQ-SW-001
   */
  it('new session acquired before old disposed @requirement:REQ-SW-001', async () => {
    // Create old session (the "current" one)
    const oldConfig = makeConfig(state.chatsDir, {
      sessionId: 'old-current-session',
      projectHash: PROJECT_HASH,
    });
    const oldRecording = new SessionRecordingService(oldConfig);
    oldRecording.recordContent(makeContent('old message'));
    await oldRecording.flush();
    state.recordingsToDispose.push(oldRecording);

    // Create target session
    const targetId = 'target-for-swap-test';
    await createTestSession(state.chatsDir, {
      sessionId: targetId,
      messages: [{ speaker: 'user', text: 'target content' }],
    });

    const context = makeResumeContext(state.chatsDir, {
      currentSessionId: 'old-current-session',
      currentRecording: oldRecording,
    });

    // Before resume, old recording should be active
    expect(oldRecording.isActive()).toBe(true);

    const result = await performResume(targetId, context);

    expect(result.ok).toBe(true);
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!result.ok) throw new Error('unreachable: narrowing failed');
    // New recording should be installed
    const newRecording = context.recordingCallbacks.getCurrentRecording();
    expect(newRecording).not.toBeNull();
    expect(newRecording!.isActive()).toBe(true);
    state.recordingsToDispose.push(newRecording!);

    const newLock = context.recordingCallbacks.getCurrentLockHandle();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (newLock) state.lockHandles.push(newLock);
  });
});
