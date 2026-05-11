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
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Test infrastructure verification #2', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  it('setupChatsDir creates proper directory structure', async () => {
    // state.chatsDir was already created in beforeEach
    const stat = await fs.stat(state.chatsDir);
    expect(stat.isDirectory()).toBe(true);
    expect(state.chatsDir).toContain('chats');
  });
});
