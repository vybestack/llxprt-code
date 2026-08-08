/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import type React from 'react';
import type {
  ThinkingBlock,
  ThoughtSummary,
} from '@vybestack/llxprt-code-core';
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

function applyThought(
  args: ReturnType<typeof createArgs>,
  thoughtSummary: ThoughtSummary,
): void {
  applyThoughtToState(
    thoughtSummary,
    args.sanitizeContent,
    args.getContentPrefixIdentity,
    args.thinkingBlocksRef,
    args.setLastAgentActivityTime,
    args.setThought,
    args.setPendingHistoryItem,
  );
}

function pendingResult(
  args: ReturnType<typeof createArgs>,
  callIndex: number,
  existing: HistoryItemWithoutId | null,
): HistoryItemAi | null {
  const call = args.setPendingHistoryItem.mock.calls[callIndex] as
    | [(item: HistoryItemWithoutId | null) => HistoryItemWithoutId | null]
    | undefined;
  if (call === undefined) {
    return null;
  }
  const updater = call[0];
  return updater(existing) as HistoryItemAi | null;
}

describe('applyThoughtToState content-prefix identity', () => {
  it('threads profileName:modelName into the pending AI item', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => 'work:gpt-4',
    });

    applyThought(args, args.thoughtSummary);

    expect(pendingResult(args, 0, null)?.profileName).toBe('work:gpt-4');
  });

  it('omits profileName when getContentPrefixIdentity returns null', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThought(args, args.thoughtSummary);

    expect(pendingResult(args, 0, null)?.profileName).toBeUndefined();
  });

  it('preserves an existing identity when getContentPrefixIdentity returns null', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThought(args, args.thoughtSummary);

    const result = pendingResult(args, 0, {
      type: 'gemini',
      text: 'partial',
      profileName: 'work:gpt-4',
    });

    expect(result?.profileName).toBe('work:gpt-4');
  });

  it('prefers live identity over existing profileName on the pending item', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => 'new:claude-3',
    });

    applyThought(args, args.thoughtSummary);

    const result = pendingResult(args, 0, {
      type: 'gemini',
      text: 'partial',
      profileName: 'old:gpt-4',
    });

    expect(result?.profileName).toBe('new:claude-3');
  });
});

describe('applyThoughtToState identity-aware streaming updates', () => {
  it('replaces real incremental updates for the same stream id immutably', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThought(args, {
      subject: '',
      description: 'Let me think',
      streamId: 'thinking:0',
      streamStatus: 'delta',
    });
    const firstBlock = args.thinkingBlocksRef.current[0];

    applyThought(args, {
      subject: '',
      description: 'Let me think about this',
      streamId: 'thinking:0',
      streamStatus: 'complete',
    });

    expect(args.thinkingBlocksRef.current).toStrictEqual([
      {
        type: 'thinking',
        thought: 'Let me think about this',
        sourceField: 'thought',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      },
    ]);
    expect(args.thinkingBlocksRef.current[0]).not.toBe(firstBlock);
  });

  it('renders distinct prefix-sharing blocks separately when stream ids differ', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThought(args, {
      subject: '',
      description: 'I think',
      streamId: 'thinking:0',
      streamStatus: 'complete',
    });
    applyThought(args, {
      subject: '',
      description: 'I think this belongs to a later block',
      streamId: 'thinking:1',
      streamStatus: 'complete',
    });

    expect(
      args.thinkingBlocksRef.current.map((block) => block.thought),
    ).toStrictEqual(['I think', 'I think this belongs to a later block']);
  });

  it('does not collapse prefix-sharing thought text without explicit stream identity', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThought(args, { subject: '', description: 'Plan' });
    applyThought(args, { subject: '', description: 'Plan the answer' });

    expect(
      args.thinkingBlocksRef.current.map((block) => block.thought),
    ).toStrictEqual(['Plan', 'Plan the answer']);
  });

  it('updates pending item with accumulated thinking and current content-prefix identity', () => {
    const identities = ['profile:old', 'profile:new'];
    const args = createArgs({
      getContentPrefixIdentity: () => identities.shift() ?? null,
    });

    applyThought(args, {
      subject: '',
      description: 'Start',
      streamId: 'thinking:0',
      streamStatus: 'delta',
    });
    applyThought(args, {
      subject: '',
      description: 'Start thinking',
      streamId: 'thinking:0',
      streamStatus: 'complete',
    });

    const result = pendingResult(args, 1, null);

    expect(result?.profileName).toBe('profile:new');
    expect(result?.thinkingBlocks).toStrictEqual([
      {
        type: 'thinking',
        thought: 'Start thinking',
        sourceField: 'thought',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      },
    ]);
  });

  it('preserves existing text when a same-stream update has empty sanitized content', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThought(args, {
      subject: '',
      description: 'Keep this text',
      streamId: 'thinking:0',
      streamStatus: 'delta',
    });
    applyThought(args, {
      subject: '',
      description: '',
      streamId: 'thinking:0',
      streamStatus: 'complete',
    });

    expect(args.thinkingBlocksRef.current).toStrictEqual([
      {
        type: 'thinking',
        thought: 'Keep this text',
        sourceField: 'thought',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      },
    ]);
  });

  it('preserves stream status when a same-stream update omits it', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThought(args, {
      subject: '',
      description: 'Start',
      streamId: 'thinking:0',
      streamStatus: 'delta',
    });
    applyThought(args, {
      subject: '',
      description: 'Continue',
      streamId: 'thinking:0',
    });

    expect(args.thinkingBlocksRef.current[0]?.streamStatus).toBe('delta');
  });

  it('suppresses exact duplicate thoughts only when providers omit stream ids', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThought(args, { subject: '', description: 'Duplicate' });
    applyThought(args, { subject: '', description: 'Duplicate' });
    applyThought(args, {
      subject: '',
      description: 'Duplicate',
      streamId: 'thinking:0',
      streamStatus: 'complete',
    });

    expect(
      args.thinkingBlocksRef.current.map((block) => ({
        thought: block.thought,
        streamId: block.streamId,
      })),
    ).toStrictEqual([
      { thought: 'Duplicate', streamId: undefined },
      { thought: 'Duplicate', streamId: 'thinking:0' },
    ]);
  });

  it('does not create a visible thought block for empty thinking text', () => {
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThought(args, {
      subject: '',
      description: '',
      streamId: 'thinking:0',
      streamStatus: 'complete',
    });

    expect(args.thinkingBlocksRef.current).toStrictEqual([]);
    expect(args.setPendingHistoryItem).not.toHaveBeenCalled();
  });

  it('appends a new block when a different stream id follows a complete block (issue #3128)', () => {
    // Models iterate within one user turn. Iteration 1 completes its reasoning
    // (streamId A); iteration 2 begins reasoning under a distinct streamId B.
    // The ref must hold BOTH blocks in order and preserve A verbatim — the bug
    // was that providers reused the same id, so B replaced A.
    const args = createArgs({
      getContentPrefixIdentity: () => null,
    });

    applyThought(args, {
      subject: '',
      description: 'Why I called the first tool',
      streamId: 'anthropic-thinking:aaa:0:block-0',
      streamStatus: 'complete',
    });
    applyThought(args, {
      subject: '',
      description: 'Now reasoning about the result',
      streamId: 'anthropic-thinking:bbb:0:block-0',
      streamStatus: 'delta',
    });

    expect(args.thinkingBlocksRef.current).toHaveLength(2);
    expect(
      args.thinkingBlocksRef.current.map((block) => block.thought),
    ).toStrictEqual([
      'Why I called the first tool',
      'Now reasoning about the result',
    ]);
    expect(
      args.thinkingBlocksRef.current.map((block) => block.streamId),
    ).toStrictEqual([
      'anthropic-thinking:aaa:0:block-0',
      'anthropic-thinking:bbb:0:block-0',
    ]);
    expect(args.thinkingBlocksRef.current[0]?.streamStatus).toBe('complete');
    expect(args.thinkingBlocksRef.current[1]?.streamStatus).toBe('delta');
  });
});
