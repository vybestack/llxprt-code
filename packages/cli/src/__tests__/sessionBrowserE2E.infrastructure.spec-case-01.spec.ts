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

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import { readRecordedFacts, readRecordedRows } from './journal-recording.js';
import {
  PROJECT_HASH,
  cleanupSessionBrowserTestState,
  createSessionBrowserTestState,
  createTestSession,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('Test infrastructure verification #1', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  it('createTestSession creates real journal files', async () => {
    const { filePath, sessionId } = await createTestSession(state.chatsDir, {
      messages: [
        { speaker: 'user', text: 'Hello world' },
        { speaker: 'model', text: 'Hi there!' },
      ],
    });

    // Verify file exists
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);

    const facts = await readRecordedFacts(filePath);
    expect(facts.sessionId).toBe(sessionId);
    expect(facts.start.projectHash).toBe(PROJECT_HASH);
    const rows = await readRecordedRows(filePath);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Hello world' }],
    });
    expect(rows[1]).toMatchObject({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hi there!' }],
    });
  });
});
