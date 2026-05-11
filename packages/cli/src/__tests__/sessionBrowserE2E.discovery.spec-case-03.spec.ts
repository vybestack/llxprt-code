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
  delay,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Session discovery #3', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  it('sorts sessions by modification time (newest first)', async () => {
    const { sessionId: olderId } = await createTestSession(state.chatsDir, {
      messages: [{ speaker: 'user', text: 'Older' }],
    });
    await delay(50);
    const { sessionId: newerId } = await createTestSession(state.chatsDir, {
      messages: [{ speaker: 'user', text: 'Newer' }],
    });

    const sessions = await SessionDiscovery.listSessions(
      state.chatsDir,
      PROJECT_HASH,
    );

    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBe(newerId);
    expect(sessions[1].sessionId).toBe(olderId);
  });
});
