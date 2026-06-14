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
  type ModelInfo,
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
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty system message should fall back to reason
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

function flushPendingGeminiContentForContextClear(
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

  deps.thinkingBlocksRef.current = [];
  deps.setThought(null);
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

  const coreResult = handleCoreStreamEvent(
    event,
    deps,
    toolCallRequests,
    userMessageTimestamp,
    geminiMessageBuffer,
  );
  if (coreResult) return coreResult;

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
  geminiMessageBuffer: string,
): DispatchResult | null {
  switch (event.type) {
    case ServerGeminiEventType.ToolCallRequest:
      toolCallRequests.push({
        ...event.value,
        agentId: event.value.agentId ?? DEFAULT_AGENT_ID,
      });
      return { geminiMessageBuffer };
    case ServerGeminiEventType.LoopDetected:
      deps.loopDetectedRef.current = true;
      toolCallRequests.length = 0;
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
