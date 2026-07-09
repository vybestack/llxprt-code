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

/**
 * #1723: Determines whether an incoming thought text is an incremental
 * extension of the last thinking block (i.e. the last block's thought text
 * is a proper prefix of the incoming text — longer, not identical). This
 * allows the UI to grow a single thinking block as deltas stream in rather
 * than creating a new block per chunk.
 *
 * A proper-prefix check (not startsWith) avoids merging two distinct blocks
 * that happen to share a textual prefix: if incoming text equals the last
 * block's text, it is treated as a duplicate (handled by buildThinkingBlock's
 * dedup) rather than an incremental update.
 */
function isIncrementalUpdate(
  incomingText: string,
  lastBlock: ThinkingBlock | undefined,
): boolean {
  if (!lastBlock || lastBlock.thought === '') return false;
  return (
    incomingText.startsWith(lastBlock.thought) &&
    incomingText.length > lastBlock.thought.length
  );
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
  let thoughtText = [thoughtSummary.subject, thoughtSummary.description]
    .filter(Boolean)
    .join(': ');
  const sanitized = sanitizeContent(thoughtText);
  thoughtText = sanitized.blocked ? '' : sanitized.text;

  const lastBlock =
    thinkingBlocksRef.current[thinkingBlocksRef.current.length - 1];

  if (thoughtText && isIncrementalUpdate(thoughtText, lastBlock)) {
    thinkingBlocksRef.current = [
      ...thinkingBlocksRef.current.slice(0, -1),
      { ...lastBlock, thought: thoughtText },
    ];
    updatePendingWithThinking(
      getContentPrefixIdentity,
      thinkingBlocksRef,
      setPendingHistoryItem,
    );
    return;
  }

  const thinkingBlock = buildThinkingBlock(
    thoughtText,
    thinkingBlocksRef.current,
  );
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
  existingBlocks: ThinkingBlock[],
): ThinkingBlock | null {
  if (!thoughtText) {
    return null;
  }
  const alreadyHasThought = existingBlocks.some(
    (tb) => tb.thought === thoughtText,
  );
  if (alreadyHasThought) {
    return null;
  }
  return {
    type: 'thinking',
    thought: thoughtText,
    sourceField: 'thought',
  };
}
