/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stream event dispatch logic: the switch/case event dispatcher that maps a
 * single ServerGeminiStreamEvent to the appropriate React state update. Used by
 * the single-event router (processStreamEvent) that the AgenticLoop drives.
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
  type Config,
  type ThoughtSummary,
  type ThinkingBlock,
  type ModelInfo,
  uiTelemetryService,
} from '@vybestack/llxprt-code-core';
import type React from 'react';
import { type HistoryItemWithoutId, MessageType } from '../../types.js';
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
  flushPendingHistoryItem: (timestamp: number) => void;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>;
  turnCancelledRef: React.MutableRefObject<boolean>;
  loopDetectedRef: React.MutableRefObject<boolean>;
  lastModelInfoRef: React.MutableRefObject<string | null>;
  /**
   * Composite identity (provider|profile|model) tracked across ModelInfo
   * events so that same-displayLabel but different provider/model/profile
   * changes still produce an inline notification.
   */
  lastModelIdentityRef: React.MutableRefObject<string | null>;
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
  deps: StreamEventDeps,
  geminiMessageBuffer: string,
  userMessageTimestamp: number,
): DispatchResult {
  if (event.contextCleared === true)
    flushPendingGeminiContentForContextClear(deps, userMessageTimestamp);

  deps.addItem(
    {
      type: MessageType.INFO,
      text: `${prefix}${event.systemMessage?.trim() || event.reason}`,
    },
    userMessageTimestamp,
  );
  if (event.contextCleared === true) {
    deps.addItem(
      {
        type: MessageType.INFO,
        text: 'Conversation context has been cleared.',
      },
      userMessageTimestamp,
    );
    return { geminiMessageBuffer: '' };
  }

  return { geminiMessageBuffer };
}

function flushPendingGeminiContent(
  deps: StreamEventDeps,
  userMessageTimestamp: number,
): void {
  if (
    deps.pendingHistoryItemRef.current?.type === 'gemini' ||
    deps.pendingHistoryItemRef.current?.type === 'gemini_content'
  ) {
    deps.flushPendingHistoryItem(userMessageTimestamp);
    deps.setPendingHistoryItem(null);
  }
}

function flushPendingGeminiContentForContextClear(
  deps: StreamEventDeps,
  userMessageTimestamp: number,
): void {
  flushPendingGeminiContent(deps, userMessageTimestamp);

  deps.thinkingBlocksRef.current = [];
  deps.setThought(null);
}

function handleEarlyReturnEvent(
  event: GeminiEvent,
  eventType: ServerGeminiEventType,
  deps: StreamEventDeps,
  userMessageTimestamp: number,
  geminiMessageBuffer: string,
): {
  geminiMessageBuffer: string;
  processingResult: StreamProcessingStatus;
} | null {
  if (eventType === ServerGeminiEventType.UserCancelled) {
    deps.handleUserCancelledEvent(userMessageTimestamp);
    return {
      geminiMessageBuffer,
      processingResult: StreamProcessingStatus.UserCancelled,
    };
  }
  if (eventType === ServerGeminiEventType.StreamIdleTimeout) {
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
  userMessageTimestamp: number,
): DispatchResult {
  const earlyReturn = handleEarlyReturnEvent(
    event,
    event.type,
    deps,
    userMessageTimestamp,
    geminiMessageBuffer,
  );
  if (earlyReturn) return resetBufferAfterTerminal(event.type, earlyReturn);

  const coreResult = handleCoreStreamEvent(
    event,
    deps,
    userMessageTimestamp,
    geminiMessageBuffer,
  );
  if (coreResult) return resetBufferAfterTerminal(event.type, coreResult);

  if (handleNotificationStreamEvent(event, deps, userMessageTimestamp)) {
    return resetBufferAfterTerminal(event.type, { geminiMessageBuffer });
  }

  return handleContentLikeStreamEvent(
    event,
    deps,
    geminiMessageBuffer,
    userMessageTimestamp,
  );
}

function resetBufferAfterTerminal(
  eventType: ServerGeminiEventType,
  result: DispatchResult,
): DispatchResult {
  if (!shouldResetGeminiMessageBuffer(eventType)) {
    return result;
  }
  return { ...result, geminiMessageBuffer: '' };
}

const BUFFER_RESET_EVENTS = new Set<ServerGeminiEventType>([
  ServerGeminiEventType.Finished,
  ServerGeminiEventType.Error,
  ServerGeminiEventType.StreamIdleTimeout,
  ServerGeminiEventType.UserCancelled,
  ServerGeminiEventType.LoopDetected,
  ServerGeminiEventType.MaxSessionTurns,
  ServerGeminiEventType.ContextWindowWillOverflow,
  ServerGeminiEventType.AgentExecutionStopped,
  ServerGeminiEventType.AgentExecutionBlocked,
]);

function shouldResetGeminiMessageBuffer(
  eventType: ServerGeminiEventType,
): boolean {
  return BUFFER_RESET_EVENTS.has(eventType);
}

function handleCoreStreamEvent(
  event: GeminiEvent,
  deps: StreamEventDeps,
  userMessageTimestamp: number,
  geminiMessageBuffer: string,
): DispatchResult | null {
  switch (event.type) {
    case ServerGeminiEventType.ToolCallRequest:
      return { geminiMessageBuffer };
    case ServerGeminiEventType.LoopDetected:
      deps.loopDetectedRef.current = true;
      return { geminiMessageBuffer };
    case ServerGeminiEventType.AgentExecutionStopped:
      return dispatchAgentExecutionEvent(
        event as AgentExecEvent,
        'Execution stopped by hook: ',
        deps,
        geminiMessageBuffer,
        userMessageTimestamp,
      );
    case ServerGeminiEventType.AgentExecutionBlocked:
      return dispatchAgentExecutionEvent(
        event as AgentExecEvent,
        'Execution blocked by hook: ',
        deps,
        geminiMessageBuffer,
        userMessageTimestamp,
      );
    default:
      return null;
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
      flushPendingGeminiContent(deps, userMessageTimestamp);
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
    case ServerGeminiEventType.ModelInfo:
      handleModelInfoEvent(deps, event.value, userMessageTimestamp);
      return true;
    default:
      return false;
  }
}

function handleModelInfoEvent(
  deps: StreamEventDeps,
  info: ModelInfo,
  userMessageTimestamp: number,
): void {
  const displayLabel = info.displayLabel ?? info.model;
  const identity = computeModelIdentity(info);
  const previousLabel = deps.lastModelInfoRef.current;
  const previousIdentity = deps.lastModelIdentityRef.current;
  deps.lastModelInfoRef.current = displayLabel;
  deps.lastModelIdentityRef.current = identity;

  // Baseline behavior: always show a "Responding with: {label}" notification
  // on the first assistant response (previousIdentity === null) so users see
  // model/profile context for every prompt. Suppress duplicates when the
  // composite identity is unchanged across retries/continuations.
  if (previousIdentity !== null && previousIdentity === identity) {
    return;
  }

  void previousLabel; // tracked for diagnostics; identity is the dedup key

  deps.addItem(
    {
      type: 'profile_change',
      profileName: displayLabel,
    },
    userMessageTimestamp,
  );
}

/**
 * Computes a collision-safe composite identity string from provider, profile,
 * and model so that deduplication distinguishes changes even when the
 * displayLabel is the same (e.g. two profiles named identically on different
 * providers).
 *
 * Uses JSON.stringify to guarantee unambiguous delimiting — a pipe-joined
 * approach can collide when a field value itself contains the delimiter.
 */
function computeModelIdentity(info: ModelInfo): string {
  return JSON.stringify([
    info.providerName ?? '',
    info.profileName ?? '',
    info.model,
  ]);
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
