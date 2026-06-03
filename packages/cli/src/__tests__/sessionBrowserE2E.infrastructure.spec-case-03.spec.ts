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
 * Test infrastructure verification
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  cleanupSessionBrowserTestState,
  createSessionBrowserTestState,
  createTestSession,
  delay,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Test infrastructure verification #3', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  it('multiple sessions get unique files', async () => {
    const session1 = await createTestSession(state.chatsDir, {
      sessionId: 'session-1',
      messages: [{ speaker: 'user', text: 'First session' }],
    });

    await delay(10);

    const session2 = await createTestSession(state.chatsDir, {
      sessionId: 'session-2',
      messages: [{ speaker: 'user', text: 'Second session' }],
    });

    expect(session1.filePath).not.toBe(session2.filePath);
    expect(session1.sessionId).toBe('session-1');
    expect(session2.sessionId).toBe('session-2');

    // Both files should exist
    await expect(fs.stat(session1.filePath)).resolves.toBeDefined();
    await expect(fs.stat(session2.filePath)).resolves.toBeDefined();
  });
});
