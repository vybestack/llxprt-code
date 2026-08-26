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
  type ServerContentEvent as ContentEvent,
  type ThinkingBlock,
} from '@vybestack/llxprt-code-core';
import {
  type HistoryItemWithoutId,
  type HistoryItemAi,
  type HistoryItemAiContent,
  MessageType,
} from '../../types.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import { buildFullSplitItem } from './streamUtils.js';
import type { PendingResponseBuffer } from './pendingResponseBuffer.js';

export interface ContentEventDeps {
  addItem: UseHistoryManagerReturn['addItem'];
  pendingResponse: PendingResponseBuffer;
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
  getContentPrefixIdentity: () => string | null;
}

function ensureAiPendingItem(
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  flushPendingHistoryItem: (timestamp: number) => void,
  liveProfileName: string | null,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
  userMessageTimestamp: number,
  pendingResponse: PendingResponseBuffer,
): void {
  if (
    pendingHistoryItemRef.current?.type !== 'gemini' &&
    pendingHistoryItemRef.current?.type !== 'gemini_content'
  ) {
    if (pendingHistoryItemRef.current)
      flushPendingHistoryItem(userMessageTimestamp);
    pendingResponse.beginCommittedSegments();
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

function buildAfterItem(
  text: string,
  liveProfileName: string | null,
  existingProfileName: string | null | undefined,
): HistoryItemAiContent {
  const profileName = liveProfileName ?? existingProfileName ?? null;
  return {
    type: 'gemini_content',
    text,
    ...(profileName != null ? { profileName } : {}),
  };
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
  afterItem: HistoryItemAiContent,
  userMessageTimestamp: number,
  pendingResponse: PendingResponseBuffer,
): string {
  if (beforeText) {
    const committedId = addItem(
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
    pendingResponse.recordCommittedSegment(committedId);
    thinkingBlocksRef.current = [];
  }
  setPendingHistoryItem(afterItem);
  return afterItem.text;
}

function processBlockedContent(
  currentAiMessageBuffer: string,
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
  return currentAiMessageBuffer;
}

function getPendingAiType(
  item: HistoryItemWithoutId | null,
): 'gemini' | 'gemini_content' {
  return item?.type === 'gemini_content' ? 'gemini_content' : 'gemini';
}

function handleSanitizeFeedback(
  feedback: string | undefined,
  blocked: boolean,
  currentAiMessageBuffer: string,
  userMessageTimestamp: number,
  deps: ContentEventDeps,
): string | null {
  if (blocked) {
    const buffer = processBlockedContent(
      currentAiMessageBuffer,
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
  return null;
}

export function processContentEvent(
  eventValue: ContentEvent['value'],
  currentAiMessageBuffer: string,
  userMessageTimestamp: number,
  deps: ContentEventDeps,
): string {
  if (deps.turnCancelledRef.current) {
    return '';
  }

  // Normalize empty/whitespace to null so downstream `!= null` checks treat
  // it as absent — consistent with resolveContentPrefixIdentity's cleaned()
  // behavior (issue #2263).
  const rawIdentity = deps.getContentPrefixIdentity();
  const liveProfileIdentity = rawIdentity === '' ? null : rawIdentity;
  const pendingType = getPendingAiType(deps.pendingHistoryItemRef.current);
  const { feedback, blocked } = deps.pendingResponse.push(eventValue);

  const blockedResult = handleSanitizeFeedback(
    feedback,
    blocked,
    currentAiMessageBuffer,
    userMessageTimestamp,
    deps,
  );
  if (blockedResult !== null) {
    deps.pendingResponse.reset();
    return blockedResult;
  }

  ensureAiPendingItem(
    deps.pendingHistoryItemRef,
    deps.setPendingHistoryItem,
    deps.flushPendingHistoryItem,
    liveProfileIdentity,
    deps.thinkingBlocksRef,
    userMessageTimestamp,
    deps.pendingResponse,
  );

  const existingProfileName = (
    deps.pendingHistoryItemRef.current as
      | HistoryItemAi
      | HistoryItemAiContent
      | undefined
  )?.profileName;
  const stableText = deps.pendingResponse.stableText;
  const splitPoint = deps.pendingResponse.getSplitPoint();

  if (splitPoint === stableText.length) {
    const displayText = deps.pendingResponse.displayText;
    deps.setPendingHistoryItem((item) =>
      buildFullSplitItem(
        item,
        displayText,
        liveProfileIdentity,
        deps.thinkingBlocksRef.current,
      ),
    );
    return displayText;
  }

  const { committedText: beforeText } =
    deps.pendingResponse.consume(splitPoint);
  const afterItem = buildAfterItem(
    deps.pendingResponse.displayText,
    liveProfileIdentity,
    existingProfileName ?? null,
  );

  return applySplitResult(
    beforeText,
    pendingType,
    liveProfileIdentity,
    deps.thinkingBlocksRef,
    deps.setPendingHistoryItem,
    deps.addItem,
    afterItem,
    userMessageTimestamp,
    deps.pendingResponse,
  );
}
