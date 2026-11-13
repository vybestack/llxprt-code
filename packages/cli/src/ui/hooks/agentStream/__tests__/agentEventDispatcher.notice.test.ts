/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036, interactive path. A refusal-recovery `notice` event (retry
 * progress, the summary when recovery gives up) must reach the user as an info
 * item. Notices that carry no source, such as an MCP discovery failure, keep
 * their existing behavior and render nothing.
 *
 * Drives the real `dispatchAgentEvent` with the real `processContentEvent` and
 * `PendingResponseBuffer`; only the React state setters are plain holders.
 */

import { describe, expect, it, vi } from 'bun:test';
import type React from 'react';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import type { HistoryItemWithoutId } from '../../../types.js';
import {
  dispatchAgentEvent,
  type AgentEventDeps,
} from '../agentEventDispatcher.js';
import { processContentEvent } from '../contentEventProcessor.js';
import type { UseHistoryManagerReturn } from '../../useHistoryManager.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';

/** The history as the user sees it, top to bottom. */
function render(events: readonly AgentEvent[]): string[] {
  const shown: string[] = [];
  let pending: HistoryItemWithoutId | null = null;
  const pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null> =
    {
      get current() {
        return pending;
      },
      set current(value: HistoryItemWithoutId | null) {
        pending = value;
      },
    };
  let nextItemId = 1;
  const addItem: UseHistoryManagerReturn['addItem'] = (item) => {
    if (item.type === 'info') shown.push(`info:${item.text}`);
    if (item.type === 'gemini' || item.type === 'gemini_content')
      shown.push(`text:${item.text}`);
    return nextItemId++;
  };
  const pendingResponse = new PendingResponseBuffer(undefined);
  const thinkingBlocksRef = { current: [] };
  const turnCancelledRef = { current: false };
  const setPendingHistoryItem: AgentEventDeps['setPendingHistoryItem'] = (
    updater,
  ) => {
    pending = typeof updater === 'function' ? updater(pending) : updater;
  };
  const flushPendingHistoryItem: AgentEventDeps['flushPendingHistoryItem'] =
    () => {
      if (pending !== null) {
        shown.push(`text:${pendingResponse.materialize().text}`);
        pendingResponse.reset();
      }
      pending = null;
    };
  const sanitizeContent = (text: string) => ({ text, blocked: false });
  const deps: AgentEventDeps = {
    observeAssistantMessageCommitted: () => {},
    setLastPromptTokenCount: () => {},
    addItem,
    sanitizeContent,
    flushPendingHistoryItem,
    pendingResponse,
    pendingHistoryItemRef,
    thinkingBlocksRef,
    turnCancelledRef,
    loopDetectedRef: { current: false },
    lastModelInfoRef: { current: null },
    lastModelIdentityRef: { current: null },
    setPendingHistoryItem,
    setLastAgentActivityTime: vi.fn(),
    setThought: vi.fn(),
    getContentPrefixIdentity: () => null,
    handleContentEvent: (value, buffer, timestamp) =>
      processContentEvent(value, buffer, timestamp, {
        addItem,
        pendingResponse,
        sanitizeContent,
        flushPendingHistoryItem,
        pendingHistoryItemRef,
        thinkingBlocksRef,
        turnCancelledRef,
        setPendingHistoryItem,
        getContentPrefixIdentity: () => null,
      }),
    handleUserCancelledEvent: vi.fn(),
    handleErrorEvent: vi.fn(),
    handleChatCompressionEvent: vi.fn(),
    handleFinishedNotice: vi.fn(),
    handleMaxSessionTurnsEvent: vi.fn(),
    handleContextWindowWillOverflowEvent: vi.fn(),
    handleCitationEvent: vi.fn(),
    handleStreamAttemptDiscarded: () => {
      pending = null;
      pendingResponse.reset();
    },
  };
  let buffer = '';
  for (const event of events) {
    buffer = dispatchAgentEvent(event, deps, buffer, 1).agentMessageBuffer;
  }
  return shown;
}

describe('dispatchAgentEvent refusal-recovery notices (issue #4036)', () => {
  it('shows a retry notice as an info item', () => {
    const shown = render([
      {
        type: 'notice',
        source: 'refusal-recovery',
        message:
          'Model m refused the request; retrying in 15 s (retry 1 of 2).',
      },
    ]);

    expect(shown).toStrictEqual([
      'info:Model m refused the request; retrying in 15 s (retry 1 of 2).',
    ]);
  });

  it('shows the notice after the refused attempt text was discarded', () => {
    const shown = render([
      { type: 'text', text: 'I cannot help with that.' },
      { type: 'retry' },
      { type: 'notice', source: 'refusal-recovery', message: 'retrying' },
      { type: 'text', text: 'the answer' },
    ]);

    expect(shown).toStrictEqual(['info:retrying']);
  });

  it('commits visible refused text before a stop summary notice', () => {
    const shown = render([
      { type: 'text', text: 'I cannot help with that.' },
      { type: 'notice', source: 'refusal-recovery', message: 'Stopping.' },
    ]);

    expect(shown).toStrictEqual([
      'text:I cannot help with that.',
      'info:Stopping.',
    ]);
  });

  it('ignores notices without a source, as before', () => {
    const shown = render([
      { type: 'notice', message: "MCP server 'x' discovery failed: boom" },
    ]);

    expect(shown).toStrictEqual([]);
  });
});
