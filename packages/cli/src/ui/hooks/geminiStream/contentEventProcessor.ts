/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure functions for processing content stream events.
 * Extracted from useStreamEventHandlers to keep each function ≤80 lines.
 * None of these functions call React hooks.
 */

import type React from 'react';
import {
  type Config,
  type ServerGeminiContentEvent as ContentEvent,
  type ThinkingBlock,
} from '@vybestack/llxprt-code-core';
import {
  type HistoryItemWithoutId,
  type HistoryItemGemini,
  type HistoryItemGeminiContent,
  MessageType,
} from '../../types.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import {
  getCurrentProfileName,
  buildSplitContent,
  buildFullSplitItem,
} from './streamUtils.js';

export interface ContentEventDeps {
  config: Config;
  addItem: UseHistoryManagerReturn['addItem'];
  sanitizeContent: (text: string) => {
    text: string;
    blocked: boolean;
    feedback?: string;
  };
  flushPendingHistoryItem: (timestamp: number) => void;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>;
  turnCancelledRef: React.MutableRefObject<boolean>;
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >;
}

function ensureGeminiPendingItem(
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  flushPendingHistoryItem: (timestamp: number) => void,
  liveProfileName: string | null,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
  userMessageTimestamp: number,
): void {
  if (
    pendingHistoryItemRef.current?.type !== 'gemini' &&
    pendingHistoryItemRef.current?.type !== 'gemini_content'
  ) {
    if (pendingHistoryItemRef.current)
      flushPendingHistoryItem(userMessageTimestamp);
    setPendingHistoryItem({
      type: 'gemini',
      text: '',
      ...(liveProfileName != null ? { profileName: liveProfileName } : {}),
      ...(thinkingBlocksRef.current.length > 0
        ? { thinkingBlocks: [...thinkingBlocksRef.current] }
        : {}),
    });
  }
}

function applySplitResult(
  beforeText: string,
  pendingType: 'gemini' | 'gemini_content',
  liveProfileName: string | null,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  addItem: UseHistoryManagerReturn['addItem'],
  afterItem: HistoryItemGeminiContent,
  userMessageTimestamp: number,
): string {
  if (beforeText) {
    addItem(
      {
        type: pendingType,
        text: beforeText,
        ...(liveProfileName != null ? { profileName: liveProfileName } : {}),
        ...(thinkingBlocksRef.current.length > 0
          ? { thinkingBlocks: [...thinkingBlocksRef.current] }
          : {}),
      },
      userMessageTimestamp,
    );
    thinkingBlocksRef.current = [];
  }
  setPendingHistoryItem(afterItem);
  return afterItem.text;
}

function processBlockedContent(
  currentGeminiMessageBuffer: string,
  userMessageTimestamp: number,
  deps: ContentEventDeps,
): string {
  const { addItem } = deps;
  addItem(
    {
      type: MessageType.ERROR,
      text: '[Error: Response blocked due to emoji detection]',
    },
    userMessageTimestamp,
  );
  return currentGeminiMessageBuffer;
}

function getPendingGeminiType(
  item: HistoryItemWithoutId | null,
): 'gemini' | 'gemini_content' {
  return item?.type === 'gemini_content' ? 'gemini_content' : 'gemini';
}

export function processContentEvent(
  eventValue: ContentEvent['value'],
  currentGeminiMessageBuffer: string,
  userMessageTimestamp: number,
  deps: ContentEventDeps,
): string {
  if (deps.turnCancelledRef.current) {
    return '';
  }

  const liveProfileName = getCurrentProfileName(deps.config);
  const pendingType = getPendingGeminiType(deps.pendingHistoryItemRef.current);
  const combined = currentGeminiMessageBuffer + eventValue;
  const {
    text: sanitizedCombined,
    feedback,
    blocked,
  } = deps.sanitizeContent(combined);

  if (blocked) {
    const buffer = processBlockedContent(
      currentGeminiMessageBuffer,
      userMessageTimestamp,
      deps,
    );
    if (feedback)
      deps.addItem(
        { type: MessageType.INFO, text: feedback },
        userMessageTimestamp,
      );
    return buffer;
  }
  if (feedback)
    deps.addItem(
      { type: MessageType.INFO, text: feedback },
      userMessageTimestamp,
    );

  ensureGeminiPendingItem(
    deps.pendingHistoryItemRef,
    deps.setPendingHistoryItem,
    deps.flushPendingHistoryItem,
    liveProfileName,
    deps.thinkingBlocksRef,
    userMessageTimestamp,
  );

  const existingProfileName = (
    deps.pendingHistoryItemRef.current as
      | HistoryItemGemini
      | HistoryItemGeminiContent
      | undefined
  )?.profileName;
  const { splitPoint, beforeText, afterItem } = buildSplitContent(
    sanitizedCombined,
    liveProfileName,
    existingProfileName ?? null,
    deps.thinkingBlocksRef.current,
    pendingType,
  );

  if (splitPoint === sanitizedCombined.length) {
    deps.setPendingHistoryItem((item) =>
      buildFullSplitItem(
        item,
        sanitizedCombined,
        liveProfileName,
        deps.thinkingBlocksRef.current,
      ),
    );
    return sanitizedCombined;
  }

  return applySplitResult(
    beforeText,
    pendingType,
    liveProfileName,
    deps.thinkingBlocksRef,
    deps.setPendingHistoryItem,
    deps.addItem,
    afterItem,
    userMessageTimestamp,
  );
}
