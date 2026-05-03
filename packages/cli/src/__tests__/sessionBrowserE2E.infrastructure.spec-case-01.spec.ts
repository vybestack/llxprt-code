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

  it('createTestSession creates real JSONL files', async () => {
    const { filePath, sessionId } = await createTestSession(state.chatsDir, {
      messages: [
        { speaker: 'user', text: 'Hello world' },
        { speaker: 'model', text: 'Hi there!' },
      ],
    });

    // Verify file exists
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);

    // Verify file has content
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    // Should have session_start + 2 content events = 3 lines
    expect(lines.length).toBe(3);

    // First line should be session_start
    const firstLine = JSON.parse(lines[0]);
    expect(firstLine.type).toBe('session_start');
    expect(firstLine.payload.sessionId).toBe(sessionId);
    expect(firstLine.payload.projectHash).toBe(PROJECT_HASH);

    // Second line should be human content
    const secondLine = JSON.parse(lines[1]);
    expect(secondLine.type).toBe('content');
    expect(secondLine.payload.content.speaker).toBe('human');
    expect(secondLine.payload.content.blocks[0].text).toBe('Hello world');

    // Third line should be ai content
    const thirdLine = JSON.parse(lines[2]);
    expect(thirdLine.type).toBe('content');
    expect(thirdLine.payload.content.speaker).toBe('ai');
    expect(thirdLine.payload.content.blocks[0].text).toBe('Hi there!');
  });
});
