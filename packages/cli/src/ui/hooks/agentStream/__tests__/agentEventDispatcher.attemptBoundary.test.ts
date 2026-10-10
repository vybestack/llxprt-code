/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3840, interactive path. Continuation attempts inside one prompt used
 * to render into the same pending assistant message. The message component
 * draws a message's thinking above its text, so a later attempt's thinking
 * appeared above the earlier attempt's reply. The `attempt-boundary` event must
 * finish the current assistant message so each attempt renders in order.
 *
 * Drives the real `dispatchAgentEvent` with the real `processContentEvent`,
 * `applyThoughtToState` and `PendingResponseBuffer` (exactly how
 * `useStreamEventHandlers` wires them); only the React state setters are
 * replaced by plain holders. Items are listed the way `AiMessage` draws them:
 * an item's visible thinking first, then its text.
 */

import { describe, it, expect, vi } from 'bun:test';
import type React from 'react';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import type { HistoryItemWithoutId } from '../../../types.js';
import {
  dispatchAgentEvent,
  type AgentEventDeps,
} from '../agentEventDispatcher.js';
import { processContentEvent } from '../contentEventProcessor.js';
import type { UseHistoryManagerReturn } from '../../useHistoryManager.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';

interface Rendered {
  readonly deps: AgentEventDeps;
  /** What the user sees top to bottom: committed items, then the pending one. */
  readonly renderedOrder: () => string[];
}

function isThinkingBlock(value: unknown): value is ThinkingBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'thinking'
  );
}

/** Omit<HistoryItem, 'id'> flattens the union, so read thinking structurally. */
function thinkingBlocksOf(item: object): ThinkingBlock[] {
  return 'thinkingBlocks' in item && Array.isArray(item.thinkingBlocks)
    ? item.thinkingBlocks.filter(isThinkingBlock)
    : [];
}

function drawItem(
  item: { text: string; thinkingBlocks?: readonly ThinkingBlock[] },
  into: string[],
): void {
  for (const block of item.thinkingBlocks ?? []) {
    into.push(`thinking:${block.thought}`);
  }
  if (item.text !== '') {
    into.push(`text:${item.text}`);
  }
}

function createRendered(): Rendered {
  let pending: HistoryItemWithoutId | null = null;
  const committed: Array<{
    text: string;
    thinkingBlocks?: readonly ThinkingBlock[];
  }> = [];
  const pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null> =
    {
      get current() {
        return pending;
      },
      set current(value: HistoryItemWithoutId | null) {
        pending = value;
      },
    };
  const setPendingHistoryItem: AgentEventDeps['setPendingHistoryItem'] = (
    updater,
  ) => {
    pending = typeof updater === 'function' ? updater(pending) : updater;
  };
  let nextItemId = 1;
  const commit = (
    text: string,
    thinkingBlocks: readonly ThinkingBlock[],
  ): number => {
    committed.push({ text, thinkingBlocks });
    return nextItemId++;
  };
  const addItem: UseHistoryManagerReturn['addItem'] = (item) => {
    // Omit<HistoryItem, 'id'> flattens the union, so narrow on the text itself.
    if (
      (item.type === 'gemini' || item.type === 'gemini_content') &&
      typeof item.text === 'string'
    ) {
      return commit(item.text, thinkingBlocksOf(item));
    }
    return nextItemId++;
  };
  const pendingResponse = new PendingResponseBuffer(undefined);
  const thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]> = {
    current: [],
  };
  // Same commit as the production flush: text from the response buffer,
  // thinking from the shared ref, both reset for the next message.
  const flushPendingHistoryItem: AgentEventDeps['flushPendingHistoryItem'] =
    () => {
      if (
        pending !== null &&
        (pending.type === 'gemini' || pending.type === 'gemini_content')
      ) {
        const { text } = pendingResponse.materialize();
        pendingResponse.reset();
        const thinkingBlocks = thinkingBlocksRef.current;
        thinkingBlocksRef.current = [];
        commit(text, thinkingBlocks);
      }
      pending = null;
    };
  const turnCancelledRef = { current: false };
  const sanitizeContent = (text: string) => ({ text, blocked: false });

  const deps: AgentEventDeps = {
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
    handleStreamAttemptDiscarded: vi.fn(),
  };

  return {
    deps,
    renderedOrder: () => {
      const order: string[] = [];
      for (const item of committed) {
        drawItem(item, order);
      }
      if (pending?.type === 'gemini' || pending?.type === 'gemini_content') {
        drawItem(pending, order);
      }
      return order;
    },
  };
}

function dispatchAll(events: readonly AgentEvent[], rendered: Rendered): void {
  let buffer = '';
  const timestamp = Date.now();
  for (const event of events) {
    buffer = dispatchAgentEvent(
      event,
      rendered.deps,
      buffer,
      timestamp,
    ).agentMessageBuffer;
  }
}

const think = (subject: string, description: string): AgentEvent => ({
  type: 'thinking',
  thought: { subject, description },
});

describe('dispatchAgentEvent attempt boundaries (issue #3840)', () => {
  // PLAN #3840 test 11
  it('renders each continuation attempt as its own message, in order', () => {
    const rendered = createRendered();

    dispatchAll(
      [
        { type: 'text', text: 'attempt1' },
        { type: 'attempt-boundary' },
        { type: 'text', text: 'attempt2' },
        { type: 'attempt-boundary' },
        { type: 'text', text: 'attempt3' },
      ],
      rendered,
    );

    expect(rendered.renderedOrder()).toStrictEqual([
      'text:attempt1',
      'text:attempt2',
      'text:attempt3',
    ]);
  });

  // Review finding: thinking sits above its message's text, so a later
  // attempt's thinking used to land above the earlier attempt's reply.
  it('renders the later attempt thinking after the earlier attempt reply', () => {
    const rendered = createRendered();

    dispatchAll(
      [
        { type: 'text', text: 'READY' },
        { type: 'attempt-boundary' },
        think('wait', 'second thoughts'),
        { type: 'text', text: 'next' },
      ],
      rendered,
    );

    expect(rendered.renderedOrder()).toStrictEqual([
      'text:READY',
      'thinking:wait: second thoughts',
      'text:next',
    ]);
  });

  it('keeps consecutive thinking-only attempts apart and in order', () => {
    const rendered = createRendered();

    dispatchAll(
      [
        { type: 'text', text: 'READY' },
        { type: 'attempt-boundary' },
        think('second', 'attempt'),
        { type: 'attempt-boundary' },
        think('third', 'attempt'),
      ],
      rendered,
    );

    expect(rendered.renderedOrder()).toStrictEqual([
      'text:READY',
      'thinking:second: attempt',
      'thinking:third: attempt',
    ]);
  });

  it('leaves a single attempt untouched', () => {
    const rendered = createRendered();

    dispatchAll(
      [
        think('plan', 'look'),
        { type: 'text', text: 'only ' },
        { type: 'text', text: 'answer' },
      ],
      rendered,
    );

    expect(rendered.renderedOrder()).toStrictEqual([
      'thinking:plan: look',
      'text:only answer',
    ]);
  });

  it('adds nothing when no assistant message is open yet', () => {
    const rendered = createRendered();

    dispatchAll(
      [{ type: 'attempt-boundary' }, { type: 'text', text: 'attempt2' }],
      rendered,
    );

    expect(rendered.renderedOrder()).toStrictEqual(['text:attempt2']);
  });
});
