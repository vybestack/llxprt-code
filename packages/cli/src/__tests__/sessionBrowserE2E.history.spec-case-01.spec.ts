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
 * History conversion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type IContent } from '@vybestack/llxprt-code-core';
import { MessageType } from '../ui/types.js';
import {
  cleanupSessionBrowserTestState,
  convertIContentToHistoryItems,
  createSessionBrowserTestState,
  makeContent,
  SessionBrowserTestState,
} from './sessionBrowserE2E.helpers.js';

describe('History conversion #1', () => {
  let state: SessionBrowserTestState;

  beforeEach(async () => {
    state = await createSessionBrowserTestState();
  });

  afterEach(async () => {
    await cleanupSessionBrowserTestState(state);
  });

  /**
   * Test 10: IContent to HistoryItem conversion
   * @requirement REQ-CV-002
   */

  /**
   * Test 10: IContent to HistoryItem conversion
   * @requirement REQ-CV-002
   */
  it('IContent to HistoryItem conversion @requirement:REQ-CV-002', async () => {
    const contents: IContent[] = [
      makeContent('user question', 'human'),
      makeContent('ai response', 'ai'),
    ];

    // Test direct conversion
    const historyItems = convertIContentToHistoryItems(contents);

    expect(historyItems).toHaveLength(2);
    expect(historyItems[0].type).toBe(MessageType.USER);
    expect(historyItems[0].text).toBe('user question');
    expect(historyItems[1].type).toBe(MessageType.GEMINI);
    expect(historyItems[1].text).toBe('ai response');
  });
});
