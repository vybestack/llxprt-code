/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extracted stream event dispatch logic from processGeminiStreamEvents.
 * Contains the switch/case event dispatcher and post-loop tool call scheduling.
 * Keeps processGeminiStreamEvents under 80 lines.
 * None of these functions call React hooks.
 */

import {
  GeminiEventType as ServerGeminiEventType,
  type ServerGeminiStreamEvent as GeminiEvent,
  type ServerGeminiContentEvent as ContentEvent,
  type ServerGeminiChatCompressedEvent,
  type ServerGeminiFinishedEvent,
  type ServerGeminiErrorEvent as ErrorEvent,
  type ToolCallRequestInfo,
  DEFAULT_AGENT_ID,
  type Config,
  type ThoughtSummary,
  type ThinkingBlock,
  uiTelemetryService,
} from '@vybestack/llxprt-code-core';
import type React from 'react';
import { type HistoryItemWithoutId, MessageType } from '../../types.js';
import { deduplicateToolCallRequests } from './streamUtils.js';
import { StreamProcessingStatus } from './types.js';
import { applyThoughtToState } from './thoughtState.js';

export interface StreamEventDeps {
  config: Config;
  addItem: (item: HistoryItemWithoutId, timestamp: number) => void;
  sanitizeContent: (text: string) => {
    text: string;
    blocked: boolean;
    feedback?: string;
  };
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>;
  turnCancelledRef: React.MutableRefObject<boolean>;
  loopDetectedRef: React.MutableRefObject<boolean>;
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >;
  setLastGeminiActivityTime: React.Dispatch<React.SetStateAction<number>>;
  setThought: React.Dispatch<React.SetStateAction<ThoughtSummary | null>>;
  handleContentEvent: (
    eventValue: ContentEvent['value'],
    currentBuffer: string,
    timestamp: number,
  ) => string;
  handleUserCancelledEvent: (timestamp: number) => void;
  handleErrorEvent: (
    eventValue: ErrorEvent['value'],
    timestamp: number,
    options?: { clearQueue?: boolean },
  ) => void;
  handleChatCompressionEvent: (
    eventValue: ServerGeminiChatCompressedEvent['value'],
    timestamp: number,
  ) => void;
  handleFinishedEvent: (
    event: ServerGeminiFinishedEvent,
    timestamp: number,
  ) => void;
  handleMaxSessionTurnsEvent: () => void;
  handleContextWindowWillOverflowEvent: (
    estimatedRequestTokenCount: number,
    remainingTokenCount: number,
  ) => void;
  handleCitationEvent: (text: string, timestamp: number) => void;
  scheduleToolCalls: (
    requests: ToolCallRequestInfo[],
    signal: AbortSignal,
  ) => Promise<void>;
}

type AgentExecEvent = GeminiEvent & {
  systemMessage?: string;
  reason: string;
  contextCleared?: boolean;
};

type DispatchResult = {
  geminiMessageBuffer: string;
  processingResult?: StreamProcessingStatus;
};

function dispatchAgentExecutionEvent(
  event: AgentExecEvent,
  prefix: string,
  addItem: (item: HistoryItemWithoutId, timestamp: number) => void,
  userMessageTimestamp: number,
): void {
  addItem(
    {
      type: MessageType.INFO,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty system message should fall back to reason
      text: `${prefix}${event.systemMessage?.trim() || event.reason}`,
    },
    userMessageTimestamp,
  );
  if (event.contextCleared === true) {
    addItem(
      {
        type: MessageType.INFO,
        text: 'Conversation context has been cleared.',
      },
      userMessageTimestamp,
    );
  }
}

function handleEarlyReturnEvent(
  event: GeminiEvent,
  eventType: ServerGeminiEventType,
  deps: StreamEventDeps,
  toolCallRequests: ToolCallRequestInfo[],
  userMessageTimestamp: number,
  geminiMessageBuffer: string,
): {
  geminiMessageBuffer: string;
  processingResult: StreamProcessingStatus;
} | null {
  if (eventType === ServerGeminiEventType.UserCancelled) {
    toolCallRequests.length = 0;
    deps.handleUserCancelledEvent(userMessageTimestamp);
    return {
      geminiMessageBuffer,
      processingResult: StreamProcessingStatus.UserCancelled,
    };
  }
  if (eventType === ServerGeminiEventType.StreamIdleTimeout) {
    toolCallRequests.length = 0;
    const errorEvent = event as Extract<
      GeminiEvent,
      { type: typeof ServerGeminiEventType.StreamIdleTimeout }
    >;
    deps.handleErrorEvent(errorEvent.value, userMessageTimestamp, {
      clearQueue: false,
    });
    return {
      geminiMessageBuffer,
      processingResult: StreamProcessingStatus.Error,
    };
  }
  if (eventType === ServerGeminiEventType.Error) {
    toolCallRequests.length = 0;
    const errorEvent = event as Extract<
      GeminiEvent,
      { type: typeof ServerGeminiEventType.Error }
    >;
    deps.handleErrorEvent(errorEvent.value, userMessageTimestamp);
    return {
      geminiMessageBuffer,
      processingResult: StreamProcessingStatus.Error,
    };
  }
  return null;
}

export function dispatchStreamEvent(
  event: GeminiEvent,
  deps: StreamEventDeps,
  geminiMessageBuffer: string,
  toolCallRequests: ToolCallRequestInfo[],
  userMessageTimestamp: number,
): DispatchResult {
  const earlyReturn = handleEarlyReturnEvent(
    event,
    event.type,
    deps,
    toolCallRequests,
    userMessageTimestamp,
    geminiMessageBuffer,
  );
  if (earlyReturn) return earlyReturn;

  if (
    handleCoreStreamEvent(event, deps, toolCallRequests, userMessageTimestamp)
  ) {
    return { geminiMessageBuffer };
  }

  if (handleNotificationStreamEvent(event, deps, userMessageTimestamp)) {
    return { geminiMessageBuffer };
  }

  return handleContentLikeStreamEvent(
    event,
    deps,
    geminiMessageBuffer,
    userMessageTimestamp,
  );
}

function handleCoreStreamEvent(
  event: GeminiEvent,
  deps: StreamEventDeps,
  toolCallRequests: ToolCallRequestInfo[],
  userMessageTimestamp: number,
): boolean {
  switch (event.type) {
    case ServerGeminiEventType.ToolCallRequest:
      toolCallRequests.push({
        ...event.value,
        agentId: event.value.agentId ?? DEFAULT_AGENT_ID,
      });
      return true;
    case ServerGeminiEventType.LoopDetected:
      deps.loopDetectedRef.current = true;
      toolCallRequests.length = 0;
      return true;
    case ServerGeminiEventType.AgentExecutionStopped:
      dispatchAgentExecutionEvent(
        event as AgentExecEvent,
        'Execution stopped by hook: ',
        deps.addItem,
        userMessageTimestamp,
      );
      return true;
    case ServerGeminiEventType.AgentExecutionBlocked:
      dispatchAgentExecutionEvent(
        event as AgentExecEvent,
        'Execution blocked by hook: ',
        deps.addItem,
        userMessageTimestamp,
      );
      return true;
    default:
      return false;
  }
}

function handleNotificationStreamEvent(
  event: GeminiEvent,
  deps: StreamEventDeps,
  userMessageTimestamp: number,
): boolean {
  switch (event.type) {
    case ServerGeminiEventType.ChatCompressed:
      deps.handleChatCompressionEvent(event.value, userMessageTimestamp);
      return true;
    case ServerGeminiEventType.MaxSessionTurns:
      deps.handleMaxSessionTurnsEvent();
      return true;
    case ServerGeminiEventType.ContextWindowWillOverflow:
      deps.handleContextWindowWillOverflowEvent(
        event.value.estimatedRequestTokenCount,
        event.value.remainingTokenCount,
      );
      return true;
    case ServerGeminiEventType.Finished:
      deps.handleFinishedEvent(event, userMessageTimestamp);
      return true;
    case ServerGeminiEventType.Citation:
      deps.handleCitationEvent(event.value, userMessageTimestamp);
      return true;
    case ServerGeminiEventType.UsageMetadata:
      if (event.value.promptTokenCount !== undefined)
        uiTelemetryService.setLastPromptTokenCount(
          event.value.promptTokenCount,
        );
      return true;
    default:
      return false;
  }
}

function handleContentLikeStreamEvent(
  event: GeminiEvent,
  deps: StreamEventDeps,
  geminiMessageBuffer: string,
  userMessageTimestamp: number,
): DispatchResult {
  switch (event.type) {
    case ServerGeminiEventType.Thought:
      applyThoughtToState(
        event.value,
        deps.sanitizeContent,
        deps.config,
        deps.thinkingBlocksRef,
        deps.setLastGeminiActivityTime,
        deps.setThought,
        deps.setPendingHistoryItem,
      );
      return { geminiMessageBuffer };
    case ServerGeminiEventType.Content:
      deps.setLastGeminiActivityTime(Date.now());
      return {
        geminiMessageBuffer: deps.handleContentEvent(
          event.value,
          geminiMessageBuffer,
          userMessageTimestamp,
        ),
      };
    default:
      return { geminiMessageBuffer };
  }
}

function shouldSkipToolScheduling(
  processingResult: StreamProcessingStatus,
  signal: AbortSignal,
  turnCancelledRef: React.MutableRefObject<boolean>,
  loopDetectedRef: React.MutableRefObject<boolean>,
  toolCallRequests: ToolCallRequestInfo[],
): boolean {
  if (processingResult !== StreamProcessingStatus.Completed) return true;
  if (signal.aborted) return true;
  if (turnCancelledRef.current) return true;
  if (loopDetectedRef.current) return true;
  return toolCallRequests.length === 0;
}

export async function scheduleDedupedToolCalls(
  toolCallRequests: ToolCallRequestInfo[],
  processingResult: StreamProcessingStatus,
  signal: AbortSignal,
  turnCancelledRef: React.MutableRefObject<boolean>,
  loopDetectedRef: React.MutableRefObject<boolean>,
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>,
  addItem: (item: HistoryItemWithoutId, timestamp: number) => void,
  userMessageTimestamp: number,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  scheduleToolCalls: (
    requests: ToolCallRequestInfo[],
    signal: AbortSignal,
  ) => Promise<void>,
): Promise<void> {
  if (
    shouldSkipToolScheduling(
      processingResult,
      signal,
      turnCancelledRef,
      loopDetectedRef,
      toolCallRequests,
    )
  ) {
    return;
  }
  const deduped = deduplicateToolCallRequests(toolCallRequests);
  if (deduped.length > 0) {
    if (pendingHistoryItemRef.current) {
      addItem(pendingHistoryItemRef.current, userMessageTimestamp);
      setPendingHistoryItem(null);
    }
    await scheduleToolCalls(deduped, signal);
  }
}
