/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for applyThoughtToState:
 * - content-prefix identity threading (issue #2263)
 * - incremental thinking accumulation for true UI streaming (issue #1723)
 */

import { describe, it, expect, vi } from 'vitest';
import type React from 'react';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import type { HistoryItemAi, HistoryItemWithoutId } from '../../../types.js';
import { applyThoughtToState } from '../thoughtState.js';

function createArgs(overrides: {
  getContentPrefixIdentity: () => string | null;
}) {
  return {
    thoughtSummary: { subject: 'Analyzing', description: 'the request' },
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    getContentPrefixIdentity: overrides.getContentPrefixIdentity,
    thinkingBlocksRef: {
      current: [],
    } as React.MutableRefObject<ThinkingBlock[]>,
    setLastAgentActivityTime: vi.fn(),
    setThought: vi.fn(),
    setPendingHistoryItem: vi.fn(),
  };
}

describe('applyThoughtToState content-prefix identity (issue #2263)', () => {
  it('threads profileName:modelName into the pending AI item', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => 'work:gpt-4',
    });

    applyThoughtToState(
      args.thoughtSummary,
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    expect(args.setPendingHistoryItem).toHaveBeenCalledTimes(1);
    const updater = args.setPendingHistoryItem.mock.calls[0][0] as (
      item: HistoryItemWithoutId | null,
    ) => HistoryItemWithoutId | null;
    const result = updater(null) as HistoryItemAi | null;
    expect(result?.type).toBe('gemini');
    expect(result?.profileName).toBe('work:gpt-4');
  });

  it('omits profileName when getContentPrefixIdentity returns null', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThoughtToState(
      args.thoughtSummary,
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    const updater = args.setPendingHistoryItem.mock.calls[0][0] as (
      item: HistoryItemWithoutId | null,
    ) => HistoryItemWithoutId | null;
    const result = updater(null) as HistoryItemAi | null;
    expect(result?.profileName).toBeUndefined();
  });

  it('preserves an existing identity when getContentPrefixIdentity returns null', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThoughtToState(
      args.thoughtSummary,
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    const updater = args.setPendingHistoryItem.mock.calls[0][0] as (
      item: HistoryItemWithoutId | null,
    ) => HistoryItemWithoutId | null;
    const result = updater({
      type: 'gemini',
      text: 'partial',
      profileName: 'work:gpt-4',
    }) as HistoryItemAi | null;
    expect(result?.profileName).toBe('work:gpt-4');
  });

  it('prefers live identity over existing profileName on the pending item', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => 'new:claude-3',
    });

    applyThoughtToState(
      args.thoughtSummary,
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    const updater = args.setPendingHistoryItem.mock.calls[0][0] as (
      item: HistoryItemWithoutId | null,
    ) => HistoryItemWithoutId | null;
    const result = updater({
      type: 'gemini',
      text: 'partial',
      profileName: 'old:gpt-4',
    }) as HistoryItemAi | null;
    expect(result?.profileName).toBe('new:claude-3');
  });
});

describe('applyThoughtToState incremental thinking streaming (issue #1723)', () => {
  it('updates the last block when incoming text extends it', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThoughtToState(
      { subject: '', description: 'Let me think' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    expect(args.thinkingBlocksRef.current).toHaveLength(1);
    expect(args.thinkingBlocksRef.current[0].thought).toBe('Let me think');

    applyThoughtToState(
      { subject: '', description: 'Let me think about this' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    expect(args.thinkingBlocksRef.current).toHaveLength(1);
    expect(args.thinkingBlocksRef.current[0].thought).toBe(
      'Let me think about this',
    );
  });

  it('creates a new block when incoming text is completely different', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThoughtToState(
      { subject: 'Analyzing', description: 'the request' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    expect(args.thinkingBlocksRef.current).toHaveLength(1);

    applyThoughtToState(
      { subject: 'Planning', description: 'the response' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    expect(args.thinkingBlocksRef.current).toHaveLength(2);
    expect(args.thinkingBlocksRef.current[0].thought).toBe(
      'Analyzing: the request',
    );
    expect(args.thinkingBlocksRef.current[1].thought).toBe(
      'Planning: the response',
    );
  });

  it('does not create a duplicate block when the same text arrives', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThoughtToState(
      { subject: '', description: 'Same thought' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    applyThoughtToState(
      { subject: '', description: 'Same thought' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    expect(args.thinkingBlocksRef.current).toHaveLength(1);
    expect(args.thinkingBlocksRef.current[0].thought).toBe('Same thought');
    // Dedup should prevent a second pending item update.
    expect(args.setPendingHistoryItem).toHaveBeenCalledTimes(1);
  });

  it('merges when a new thought extends the last block text (incremental) @issue:1723', () => {
    // With streaming thinking deltas, the agent emits Thought events whose
    // text grows incrementally. The UI should merge prefix-extensions into
    // the same block. A genuinely new thought that merely starts with the
    // same prefix but is much longer is a separate concern (see the
    // "completely different" test above) — the startsWith heuristic is the
    // documented behavior and the trade-off is explained in thoughtState.ts.
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThoughtToState(
      { subject: 'I think', description: '' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    // An incremental extension (prefix + small delta) merges into the block.
    applyThoughtToState(
      { subject: 'I think about', description: '' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    expect(args.thinkingBlocksRef.current).toHaveLength(1);
    expect(args.thinkingBlocksRef.current[0].thought).toBe('I think about');
  });

  it('threads profileName through incremental thinking updates @issue:1723', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => 'my-profile',
    });

    applyThoughtToState(
      { subject: '', description: 'Start' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    applyThoughtToState(
      { subject: '', description: 'Start thinking' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    expect(args.setPendingHistoryItem).toHaveBeenCalledTimes(2);

    const lastUpdater = args.setPendingHistoryItem.mock.calls[1][0] as (
      item: HistoryItemWithoutId | null,
    ) => HistoryItemWithoutId | null;
    const result = lastUpdater(null) as HistoryItemAi | null;
    expect(result?.profileName).toBe('my-profile');
    expect(result?.thinkingBlocks).toHaveLength(1);
    expect(result?.thinkingBlocks?.[0].thought).toBe('Start thinking');
  });

  it('accumulates multiple deltas into a single growing block', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    const deltas = [
      'I',
      'I need',
      'I need to',
      'I need to think',
      'I need to think carefully',
    ];

    for (const delta of deltas) {
      applyThoughtToState(
        { subject: '', description: delta },
        args.sanitizeContent,
        args.getContentPrefixIdentity,
        args.thinkingBlocksRef,
        args.setLastAgentActivityTime,
        args.setThought,
        args.setPendingHistoryItem,
      );
    }

    expect(args.thinkingBlocksRef.current).toHaveLength(1);
    expect(args.thinkingBlocksRef.current[0].thought).toBe(
      'I need to think carefully',
    );
  });

  it('updates pending item with accumulated thinking blocks on each delta', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThoughtToState(
      { subject: '', description: 'Start' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    applyThoughtToState(
      { subject: '', description: 'Start thinking' },
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastAgentActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    expect(args.setPendingHistoryItem).toHaveBeenCalledTimes(2);

    const lastUpdater = args.setPendingHistoryItem.mock.calls[1][0] as (
      item: HistoryItemWithoutId | null,
    ) => HistoryItemWithoutId | null;
    const result = lastUpdater(null) as HistoryItemAi | null;
    expect(result?.thinkingBlocks).toHaveLength(1);
    expect(result?.thinkingBlocks?.[0].thought).toBe('Start thinking');
  });
});
