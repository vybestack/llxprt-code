/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for applyThoughtToState's content-prefix identity threading
 * (issue #2263).
 *
 * When a Thought event arrives before content, the thinking block is appended to
 * the same pending gemini item that carries the response prefix. The
 * `profileName` field must hold the full `profileName:modelName` identity — not
 * just the bare profile name — so the prefix shown above thinking blocks is
 * consistent with the content prefix.
 */

import { describe, it, expect, vi } from 'vitest';
import type React from 'react';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import type {
  HistoryItemGemini,
  HistoryItemWithoutId,
} from '../../../types.js';
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
    setLastGeminiActivityTime: vi.fn(),
    setThought: vi.fn(),
    setPendingHistoryItem: vi.fn(),
  };
}

describe('applyThoughtToState content-prefix identity (issue #2263)', () => {
  it('threads profileName:modelName into the pending gemini item', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => 'work:gpt-4',
    });

    applyThoughtToState(
      args.thoughtSummary,
      args.sanitizeContent,
      args.getContentPrefixIdentity,
      args.thinkingBlocksRef,
      args.setLastGeminiActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    expect(args.setPendingHistoryItem).toHaveBeenCalledTimes(1);
    const updater = args.setPendingHistoryItem.mock.calls[0][0] as (
      item: HistoryItemWithoutId | null,
    ) => HistoryItemWithoutId | null;
    const result = updater(null) as HistoryItemGemini | null;
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
      args.setLastGeminiActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    const updater = args.setPendingHistoryItem.mock.calls[0][0] as (
      item: HistoryItemWithoutId | null,
    ) => HistoryItemWithoutId | null;
    const result = updater(null) as HistoryItemGemini | null;
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
      args.setLastGeminiActivityTime,
      args.setThought,
      args.setPendingHistoryItem,
    );

    const updater = args.setPendingHistoryItem.mock.calls[0][0] as (
      item: HistoryItemWithoutId | null,
    ) => HistoryItemWithoutId | null;
    // Simulate an existing pending item that already has the identity.
    const result = updater({
      type: 'gemini',
      text: 'partial',
      profileName: 'work:gpt-4',
    }) as HistoryItemGemini | null;
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
      args.setLastGeminiActivityTime,
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
    }) as HistoryItemGemini | null;
    expect(result?.profileName).toBe('new:claude-3');
  });
});
