/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import {
  type ThinkingBlock,
  type ThoughtSummary,
} from '@vybestack/llxprt-code-core';
import {
  type HistoryItemAi,
  type HistoryItemAiContent,
  type HistoryItemWithoutId,
} from '../../types.js';

function findStreamBlockIndex(
  blocks: ThinkingBlock[],
  streamId: string | undefined,
): number {
  if (streamId === undefined) {
    return -1;
  }
  return blocks.findIndex((block) => block.streamId === streamId);
}

function hasDuplicateNoStreamThought(
  blocks: ThinkingBlock[],
  thoughtText: string,
  streamId: string | undefined,
): boolean {
  return (
    streamId === undefined &&
    thoughtText !== '' &&
    blocks.some(
      (block) => block.streamId === undefined && block.thought === thoughtText,
    )
  );
}

function buildThoughtText(thoughtSummary: ThoughtSummary): string {
  return [thoughtSummary.subject, thoughtSummary.description]
    .filter(Boolean)
    .join(': ');
}

export function applyThoughtToState(
  thoughtSummary: ThoughtSummary,
  sanitizeContent: (text: string) => {
    text: string;
    blocked: boolean;
    feedback?: string;
  },
  getContentPrefixIdentity: () => string | null,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
  setLastAgentActivityTime: (t: number) => void,
  setThought: (t: ThoughtSummary | null) => void,
  setPendingHistoryItem: (
    updater: (item: HistoryItemWithoutId | null) => HistoryItemWithoutId | null,
  ) => void,
): void {
  setLastAgentActivityTime(Date.now());
  setThought(thoughtSummary);
  let thoughtText = buildThoughtText(thoughtSummary);
  const sanitized = sanitizeContent(thoughtText);
  thoughtText = sanitized.blocked ? '' : sanitized.text;

  const streamBlockIndex = findStreamBlockIndex(
    thinkingBlocksRef.current,
    thoughtSummary.streamId,
  );

  if (streamBlockIndex >= 0) {
    const existingBlock = thinkingBlocksRef.current[streamBlockIndex];
    const updatedThought = thoughtText || existingBlock.thought;
    thinkingBlocksRef.current = thinkingBlocksRef.current.map((block, index) =>
      index === streamBlockIndex
        ? {
            ...existingBlock,
            thought: updatedThought,
            streamStatus: thoughtSummary.streamStatus,
          }
        : block,
    );
    updatePendingWithThinking(
      getContentPrefixIdentity,
      thinkingBlocksRef,
      setPendingHistoryItem,
    );
    return;
  }

  if (
    hasDuplicateNoStreamThought(
      thinkingBlocksRef.current,
      thoughtText,
      thoughtSummary.streamId,
    )
  ) {
    return;
  }

  const thinkingBlock = buildThinkingBlock(thoughtText, thoughtSummary);
  if (thinkingBlock) {
    thinkingBlocksRef.current = [...thinkingBlocksRef.current, thinkingBlock];
    updatePendingWithThinking(
      getContentPrefixIdentity,
      thinkingBlocksRef,
      setPendingHistoryItem,
    );
  }
}

function updatePendingWithThinking(
  getContentPrefixIdentity: () => string | null,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
  setPendingHistoryItem: (
    updater: (item: HistoryItemWithoutId | null) => HistoryItemWithoutId | null,
  ) => void,
): void {
  const rawIdentity = getContentPrefixIdentity();
  const liveProfileName = rawIdentity === '' ? null : rawIdentity;
  setPendingHistoryItem((item) => {
    const existingProfileName = (
      item as HistoryItemAi | HistoryItemAiContent | undefined
    )?.profileName;
    const profileName = liveProfileName ?? existingProfileName;
    const itemType =
      item?.type === 'gemini_content' ? 'gemini_content' : 'gemini';
    return {
      type: itemType,
      text: item?.text ?? '',
      ...(profileName != null ? { profileName } : {}),
      thinkingBlocks: [...thinkingBlocksRef.current],
    };
  });
}

function buildThinkingBlock(
  thoughtText: string,
  thoughtSummary: ThoughtSummary,
): ThinkingBlock | null {
  if (!thoughtText) {
    return null;
  }
  return {
    type: 'thinking',
    thought: thoughtText,
    sourceField: 'thought',
    ...(thoughtSummary.streamId !== undefined
      ? { streamId: thoughtSummary.streamId }
      : {}),
    ...(thoughtSummary.streamStatus !== undefined
      ? { streamStatus: thoughtSummary.streamStatus }
      : {}),
  };
}
