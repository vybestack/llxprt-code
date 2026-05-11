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
import {
  SessionRecordingService,
  SessionLockManager,
} from '@vybestack/llxprt-code-core';
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

describe('Two-phase swap #2', () => {
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
   * Test 8: Failed resume preserves old session
   * @requirement REQ-SW-002, REQ-EH-004
   */
  it('failed resume preserves old session @requirement:REQ-SW-002,REQ-EH-004', async () => {
    // Create old session (the "current" one)
    const oldConfig = makeConfig(state.chatsDir, {
      sessionId: 'old-preserved-session',
      projectHash: PROJECT_HASH,
    });
    const oldRecording = new SessionRecordingService(oldConfig);
    oldRecording.recordContent(makeContent('old message'));
    await oldRecording.flush();
    const oldFilePath = oldRecording.getFilePath()!;
    state.recordingsToDispose.push(oldRecording);

    // Create target session and lock it so resume will fail
    const targetId = 'target-locked-session';
    await createTestSession(state.chatsDir, {
      sessionId: targetId,
      messages: [{ speaker: 'user', text: 'target content' }],
    });
    const targetLock = await SessionLockManager.acquire(
      state.chatsDir,
      targetId,
    );
    state.lockHandles.push(targetLock);

    const context = makeResumeContext(state.chatsDir, {
      currentSessionId: 'old-preserved-session',
      currentRecording: oldRecording,
    });

    // Attempt resume - should fail
    const result = await performResume(targetId, context);
    expect(result.ok).toBe(false);

    // Old recording should still be functional
    expect(oldRecording.isActive()).toBe(true);
    oldRecording.recordContent(makeContent('new message after failed resume'));
    await oldRecording.flush();

    // Verify the content was written
    const fileContent = await fs.readFile(oldFilePath, 'utf-8');
    expect(fileContent).toContain('new message after failed resume');
  });
});
