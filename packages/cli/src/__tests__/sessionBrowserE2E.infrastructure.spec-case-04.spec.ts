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
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Test infrastructure verification #4', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  it('sessions have correct provider and model in header', async () => {
    const { filePath } = await createTestSession(state.chatsDir, {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ speaker: 'user', text: 'test' }],
    });

    const content = await fs.readFile(filePath, 'utf-8');
    const firstLine = JSON.parse(content.split('\n')[0]);

    expect(firstLine.payload.provider).toBe('openai');
    expect(firstLine.payload.model).toBe('gpt-4');
  });
});
