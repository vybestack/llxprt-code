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
 * Session discovery
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionDiscovery } from '@vybestack/llxprt-code-core';
import {
  PROJECT_HASH,
  cleanupSessionBrowserTestState,
  createSessionBrowserTestState,
  createTestSession,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Session discovery #1', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  it('discovers JSONL session files', async () => {
    // Create multiple session files
    await createTestSession(state.chatsDir, {
      messages: [{ speaker: 'user', text: 'Session 1' }],
    });
    await createTestSession(state.chatsDir, {
      messages: [{ speaker: 'user', text: 'Session 2' }],
    });
    await createTestSession(state.chatsDir, {
      messages: [{ speaker: 'user', text: 'Session 3' }],
    });

    const sessions = await SessionDiscovery.listSessions(
      state.chatsDir,
      PROJECT_HASH,
    );

    expect(sessions).toHaveLength(3);
    expect(sessions.every((s) => s.filePath.endsWith('.jsonl'))).toBe(true);
  });
});
