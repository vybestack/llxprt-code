/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AgentEvent dispatch logic: the switch/case dispatcher that maps a single
 * public AgentEvent (from agent.stream()) to the appropriate React state
 * update. Consumes the public AgentEvent union and reuses the same per-event
 * handlers so rendered behavior is identical.
 *
 * None of these functions call React hooks.
 */

import { FinishReason } from '@google/genai';
import type {
  ServerContentEvent as ContentEvent,
  ServerErrorEvent as ErrorEvent,
  ServerChatCompressedEvent,
  ThoughtSummary,
  ThinkingBlock,
  ModelInfo,
} from '@vybestack/llxprt-code-core';
import { uiTelemetryService } from '@vybestack/llxprt-code-core';
import type {
  AgentEvent,
  AgentStopInfo,
  FinishedValue,
} from '@vybestack/llxprt-code-agents';
import type React from 'react';
import type { HistoryItemWithoutId } from '../../types.js';
import type { StreamProcessingStatus } from './types.js';
import { applyThoughtToState } from './thoughtState.js';
import { firstNonEmptyString } from '../../../utils/coalesce.js';
import {
  buildRefusalNoticeMessage,
  buildFinishReasonMessage,
} from './streamUtils.js';

export interface AgentEventDeps {
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
  lastModelIdentityRef: React.MutableRefObject<string | null>;
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >;
  setLastAgentActivityTime: React.Dispatch<React.SetStateAction<number>>;
  setThought: React.Dispatch<React.SetStateAction<ThoughtSummary | null>>;
  getContentPrefixIdentity: () => string | null;
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
    eventValue: ServerChatCompressedEvent['value'],
    timestamp: number,
  ) => void;
  /**
   * Renders a finish/refusal notice. null means no notice.
   */
  handleFinishedNotice: (message: string | null, timestamp: number) => void;
  handleMaxSessionTurnsEvent: () => void;
  handleContextWindowWillOverflowEvent: (
    estimatedRequestTokenCount: number,
    remainingTokenCount: number,
  ) => void;
  handleCitationEvent: (text: string, timestamp: number) => void;
}

type DispatchResult = {
  agentMessageBuffer: string;
  processingResult?: StreamProcessingStatus;
};

/**
 * Events that should reset the accumulated content buffer after dispatch.
 */
const BUFFER_RESET_AGENT_EVENTS = new Set<AgentEvent['type']>([
  'done',
  'error',
  'idle-timeout',
  'loop-detected',
  'context-warning',
  'hook-blocked',
]);

function shouldResetBuffer(eventType: AgentEvent['type']): boolean {
  return BUFFER_RESET_AGENT_EVENTS.has(eventType);
}

function resetBufferAfterTerminal(
  eventType: AgentEvent['type'],
  result: DispatchResult,
): DispatchResult {
  if (!shouldResetBuffer(eventType)) {
    return result;
  }
  return { ...result, agentMessageBuffer: '' };
}

function flushPendingAiContent(
  deps: AgentEventDeps,
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

function flushPendingAiContentForContextClear(
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
  flushPendingAiContent(deps, userMessageTimestamp);
  deps.thinkingBlocksRef.current = [];
  deps.setThought(null);
}

function dispatchStopInfo(
  info: AgentStopInfo,
  prefix: string,
  deps: AgentEventDeps,
  agentMessageBuffer: string,
  userMessageTimestamp: number,
): DispatchResult {
  if (info.contextCleared === true)
    flushPendingAiContentForContextClear(deps, userMessageTimestamp);

  deps.addItem(
    {
      type: 'info',
      text: `${prefix}${firstNonEmptyString(
        info.systemMessage?.trim(),
        info.reason,
      )}`,
    },
    userMessageTimestamp,
  );
  if (info.contextCleared === true) {
    deps.addItem(
      {
        type: 'info',
        text: 'Conversation context has been cleared.',
      },
      userMessageTimestamp,
    );
    return { agentMessageBuffer: '' };
  }
  return { agentMessageBuffer };
}

function computeModelIdentity(info: ModelInfo): string {
  return JSON.stringify([
    info.providerName ?? '',
    info.profileName ?? '',
    info.model,
  ]);
}

function handleModelInfoEvent(
  deps: AgentEventDeps,
  info: ModelInfo,
  userMessageTimestamp: number,
): void {
  const displayLabel = info.displayLabel ?? info.model;
  const identity = computeModelIdentity(info);
  const previousIdentity = deps.lastModelIdentityRef.current;
  deps.lastModelInfoRef.current = displayLabel;
  deps.lastModelIdentityRef.current = identity;

  if (previousIdentity !== null && previousIdentity === identity) {
    return;
  }

  deps.addItem(
    {
      type: 'profile_change',
      profileName: displayLabel,
    },
    userMessageTimestamp,
  );
}

/**
 * Type-safely narrows a string to FinishReason by checking membership in the
 * enum's values. Returns undefined for unknown values so buildFinishReasonMessage
 * is never called with an out-of-range key.
 */
function narrowFinishReason(reason: string): FinishReason | undefined {
  const values = Object.values(FinishReason) as string[];
  return values.includes(reason) ? (reason as FinishReason) : undefined;
}

/**
 * Computes the finish/refusal notice message from a FinishedValue.
 * Returns null when there is no finished value; undefined when no notice.
 */
function computeFinishNotice(
  finished: FinishedValue | undefined,
): string | null | undefined {
  if (!finished) return null;
  const refusal = buildRefusalNoticeMessage(finished.stopReason);
  if (refusal) return refusal;
  if (!finished.reason) return undefined;
  return buildFinishReasonMessage(
    narrowFinishReason(finished.reason) ??
      FinishReason.FINISH_REASON_UNSPECIFIED,
  );
}

function dispatchDoneEvent(
  event: Extract<AgentEvent, { type: 'done' }>,
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): DispatchResult {
  switch (event.reason) {
    case 'stop':
    case 'refusal': {
      flushPendingAiContent(deps, userMessageTimestamp);
      const message = computeFinishNotice(event.finished);
      deps.handleFinishedNotice(message ?? null, userMessageTimestamp);
      return { agentMessageBuffer: '' };
    }
    case 'aborted': {
      deps.handleUserCancelledEvent(userMessageTimestamp);
      return { agentMessageBuffer: '' };
    }
    case 'max-turns': {
      deps.handleMaxSessionTurnsEvent();
      return { agentMessageBuffer: '' };
    }
    case 'hook-stopped': {
      if (event.stop) {
        return dispatchStopInfo(
          event.stop,
          'Execution stopped by hook: ',
          deps,
          '',
          userMessageTimestamp,
        );
      }
      return { agentMessageBuffer: '' };
    }
    case 'loop-detected': {
      deps.loopDetectedRef.current = true;
      return { agentMessageBuffer: '' };
    }
    case 'context-overflow':
    case 'error':
      // No additional item — the preceding context-warning/error event
      // already rendered the user-visible message.
      return { agentMessageBuffer: '' };
    default:
      return { agentMessageBuffer: '' };
  }
}

/**
 * Dispatches a single public AgentEvent to the appropriate React state update.
 */
export function dispatchAgentEvent(
  event: AgentEvent,
  deps: AgentEventDeps,
  agentMessageBuffer: string,
  userMessageTimestamp: number,
): DispatchResult {
  switch (event.type) {
    case 'text':
      return dispatchTextEvent(
        event,
        deps,
        agentMessageBuffer,
        userMessageTimestamp,
      );
    case 'thinking':
      return dispatchThinkingEvent(event, deps, agentMessageBuffer);
    case 'usage':
      return dispatchUsageEvent(event, deps, agentMessageBuffer);
    case 'model-info':
      handleModelInfoEvent(deps, event.info, userMessageTimestamp);
      return { agentMessageBuffer };
    case 'compression':
      deps.handleChatCompressionEvent(event.info, userMessageTimestamp);
      return resetBufferAfterTerminal(event.type, { agentMessageBuffer });
    case 'context-warning':
      deps.handleContextWindowWillOverflowEvent(
        event.estimatedRequestTokenCount,
        event.remainingTokenCount,
      );
      return resetBufferAfterTerminal(event.type, { agentMessageBuffer });
    case 'citation':
      deps.handleCitationEvent(event.citation, userMessageTimestamp);
      return { agentMessageBuffer };
    case 'loop-detected':
      deps.loopDetectedRef.current = true;
      return resetBufferAfterTerminal(event.type, { agentMessageBuffer });
    case 'idle-timeout':
      return dispatchIdleTimeoutEvent(
        event,
        deps,
        agentMessageBuffer,
        userMessageTimestamp,
      );
    case 'hook-blocked':
      return resetBufferAfterTerminal(
        event.type,
        dispatchStopInfo(
          event.info,
          'Execution blocked by hook: ',
          deps,
          agentMessageBuffer,
          userMessageTimestamp,
        ),
      );
    case 'error':
      return dispatchErrorEvent(
        event,
        deps,
        agentMessageBuffer,
        userMessageTimestamp,
      );
    case 'done':
      return resetBufferAfterTerminal(
        event.type,
        dispatchDoneEvent(event, deps, userMessageTimestamp),
      );
    case 'tool-call':
    case 'tool-result':
    case 'tool-confirmation':
    case 'tool-status':
    case 'retry':
    case 'invalid-stream':
    case 'notice':
      // No state change — display flows through displayCallbacks or is
      // handled by the loop internally.
      return { agentMessageBuffer };
    default:
      return { agentMessageBuffer };
  }
}

function dispatchTextEvent(
  event: Extract<AgentEvent, { type: 'text' }>,
  deps: AgentEventDeps,
  agentMessageBuffer: string,
  userMessageTimestamp: number,
): DispatchResult {
  deps.setLastAgentActivityTime(Date.now());
  return {
    agentMessageBuffer: deps.handleContentEvent(
      event.text,
      agentMessageBuffer,
      userMessageTimestamp,
    ),
  };
}

function dispatchThinkingEvent(
  event: Extract<AgentEvent, { type: 'thinking' }>,
  deps: AgentEventDeps,
  agentMessageBuffer: string,
): DispatchResult {
  applyThoughtToState(
    event.thought,
    deps.sanitizeContent,
    deps.getContentPrefixIdentity,
    deps.thinkingBlocksRef,
    deps.setLastAgentActivityTime,
    deps.setThought,
    deps.setPendingHistoryItem,
  );
  return { agentMessageBuffer };
}

function dispatchUsageEvent(
  event: Extract<AgentEvent, { type: 'usage' }>,
  deps: AgentEventDeps,
  agentMessageBuffer: string,
): DispatchResult {
  if (event.usage.promptTokenCount !== undefined) {
    uiTelemetryService.setLastPromptTokenCount(event.usage.promptTokenCount);
  }
  return { agentMessageBuffer };
}

function dispatchIdleTimeoutEvent(
  event: Extract<AgentEvent, { type: 'idle-timeout' }>,
  deps: AgentEventDeps,
  agentMessageBuffer: string,
  userMessageTimestamp: number,
): DispatchResult {
  const errorValue: ErrorEvent['value'] = { error: event.error };
  deps.handleErrorEvent(errorValue, userMessageTimestamp, {
    clearQueue: false,
  });
  return resetBufferAfterTerminal(event.type, { agentMessageBuffer });
}

function dispatchErrorEvent(
  event: Extract<AgentEvent, { type: 'error' }>,
  deps: AgentEventDeps,
  agentMessageBuffer: string,
  userMessageTimestamp: number,
): DispatchResult {
  const errorValue: ErrorEvent['value'] = { error: event.error };
  deps.handleErrorEvent(errorValue, userMessageTimestamp);
  return resetBufferAfterTerminal(event.type, { agentMessageBuffer });
}
