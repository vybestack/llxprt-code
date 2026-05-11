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

describe('Two-phase swap #4', () => {
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
   * Test 9a: Swap completes without write errors
   * @requirement REQ-SW-003
   */
  it('swap completes without write errors @requirement:REQ-SW-003', async () => {
    const targetId = 'target-no-write-errors';
    const { filePath: targetFilePath } = await createTestSession(
      state.chatsDir,
      {
        sessionId: targetId,
        messages: [{ speaker: 'user', text: 'initial content' }],
      },
    );

    const context = makeResumeContext(state.chatsDir, {
      currentSessionId: 'other-session',
    });

    const result = await performResume(targetId, context);
    expect(result.ok).toBe(true);

    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!result.ok) throw new Error('unreachable: narrowing failed');
    const newRecording = context.recordingCallbacks.getCurrentRecording();
    expect(newRecording).not.toBeNull();
    state.recordingsToDispose.push(newRecording!);

    // Write multiple events to verify no write errors
    for (let i = 0; i < 5; i++) {
      newRecording!.recordContent(makeContent(`message ${i}`));
    }
    await newRecording!.flush();

    // Verify all events were written
    const fileContent = await fs.readFile(targetFilePath, 'utf-8');
    for (let i = 0; i < 5; i++) {
      expect(fileContent).toContain(`message ${i}`);
    }

    const newLock = context.recordingCallbacks.getCurrentLockHandle();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (newLock) state.lockHandles.push(newLock);
  });
});
