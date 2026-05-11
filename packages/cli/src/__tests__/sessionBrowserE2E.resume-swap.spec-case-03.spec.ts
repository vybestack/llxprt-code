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
import * as fs from 'node:fs/promises';
import { performResume } from '../services/performResume.js';
import {
  cleanupSessionBrowserTestState,
  createSessionBrowserTestState,
  createTestSession,
  makeContent,
  makeResumeContext,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Two-phase swap #3', () => {
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
   * Test 9: After successful swap events go to new session
   * @requirement REQ-SW-006, REQ-SW-007
   */
  it('after successful swap events go to new session @requirement:REQ-SW-006,REQ-SW-007', async () => {
    // Create target session
    const targetId = 'target-for-new-events';
    const { filePath: targetFilePath } = await createTestSession(
      state.chatsDir,
      {
        sessionId: targetId,
        messages: [{ speaker: 'user', text: 'original target content' }],
      },
    );

    const context = makeResumeContext(state.chatsDir, {
      currentSessionId: 'some-other-session',
    });

    const result = await performResume(targetId, context);
    expect(result.ok).toBe(true);

    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!result.ok) throw new Error('unreachable: narrowing failed');
    // Get the new recording from callbacks
    const newRecording = context.recordingCallbacks.getCurrentRecording();
    expect(newRecording).not.toBeNull();
    state.recordingsToDispose.push(newRecording!);

    // Record new event
    newRecording!.recordContent(makeContent('new event after resume'));
    await newRecording!.flush();

    // Verify the content is in the file
    const fileContent = await fs.readFile(targetFilePath, 'utf-8');
    expect(fileContent).toContain('new event after resume');

    const newLock = context.recordingCallbacks.getCurrentLockHandle();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (newLock) state.lockHandles.push(newLock);
  });
});
