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
  type HistoryItemGemini,
  type HistoryItemGeminiContent,
  type HistoryItemWithoutId,
} from '../../types.js';

export function applyThoughtToState(
  thoughtSummary: ThoughtSummary,
  sanitizeContent: (text: string) => {
    text: string;
    blocked: boolean;
    feedback?: string;
  },
  getContentPrefixIdentity: () => string | null,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
  setLastGeminiActivityTime: (t: number) => void,
  setThought: (t: ThoughtSummary | null) => void,
  setPendingHistoryItem: (
    updater: (item: HistoryItemWithoutId | null) => HistoryItemWithoutId | null,
  ) => void,
): void {
  setLastGeminiActivityTime(Date.now());
  setThought(thoughtSummary);
  let thoughtText = [thoughtSummary.subject, thoughtSummary.description]
    .filter(Boolean)
    .join(': ');
  const sanitized = sanitizeContent(thoughtText);
  thoughtText = sanitized.blocked ? '' : sanitized.text;
  const thinkingBlock = buildThinkingBlock(
    thoughtText,
    thinkingBlocksRef.current,
  );
  if (thinkingBlock) {
    thinkingBlocksRef.current.push(thinkingBlock);
    const rawIdentity = getContentPrefixIdentity();
    const liveProfileName = rawIdentity === '' ? null : rawIdentity;
    setPendingHistoryItem((item) => {
      const existingProfileName = (
        item as HistoryItemGemini | HistoryItemGeminiContent | undefined
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
