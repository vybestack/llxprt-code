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

import type {
  ServerErrorEvent as ErrorEvent,
  ServerChatCompressedEvent,
  ThoughtSummary,
  ModelInfo,
  CanonicalFinishReason,
} from '@vybestack/llxprt-code-core';
import { isCanonicalFinishReason } from '@vybestack/llxprt-code-core';
import type {
  AgentEvent,
  AgentStopInfo,
  FinishedValue,
} from '@vybestack/llxprt-code-agents';
import type React from 'react';
import type { HistoryItemWithoutId } from '../../types.js';
import { firstNonEmptyString } from '../../../utils/coalesce.js';
import {
  buildRefusalNoticeMessage,
  buildFinishReasonMessage,
} from './streamUtils.js';

export interface AgentEventDeps {
  setLastPromptTokenCount: (count: number) => void;
  addItem: (item: HistoryItemWithoutId, timestamp: number) => void;
  flushPendingHistoryItem: (timestamp: number) => void;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  loopDetectedRef: React.MutableRefObject<boolean>;
  lastModelInfoRef: React.MutableRefObject<string | null>;
  lastModelIdentityRef: React.MutableRefObject<string | null>;
  setLastAgentActivityTime: React.Dispatch<React.SetStateAction<number>>;
  setThought: React.Dispatch<React.SetStateAction<ThoughtSummary | null>>;
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
  /**
   * Discards the abandoned attempt's render state on retry (issue #3048).
   */
  handleStreamAttemptDiscarded: () => void;
}

function flushPendingAiContent(
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
  if (deps.pendingHistoryItemRef.current !== null)
    deps.flushPendingHistoryItem(userMessageTimestamp);
}

function flushPendingAiContentForContextClear(
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
  flushPendingAiContent(deps, userMessageTimestamp);
  deps.setThought(null);
}

function dispatchStopInfo(
  info: AgentStopInfo,
  prefix: string,
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
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
    return;
  }
  return;
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
 * Narrows the FinishedValue.reason string to a CanonicalFinishReason.
 * Returns undefined for unknown values so buildFinishReasonMessage treats
 * them as a normal/other case.
 */
function toCanonicalFinishReason(
  reason: string,
): CanonicalFinishReason | undefined {
  return isCanonicalFinishReason(reason) ? reason : undefined;
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
    toCanonicalFinishReason(finished.reason),
    finished.stopReason,
  );
}

function dispatchDoneEvent(
  event: Extract<AgentEvent, { type: 'done' }>,
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
  switch (event.reason) {
    case 'stop':
    case 'refusal': {
      flushPendingAiContent(deps, userMessageTimestamp);
      const message = computeFinishNotice(event.finished);
      deps.handleFinishedNotice(message ?? null, userMessageTimestamp);
      return;
    }
    case 'aborted': {
      deps.handleUserCancelledEvent(userMessageTimestamp);
      return;
    }
    case 'max-turns': {
      deps.handleMaxSessionTurnsEvent();
      return;
    }
    case 'hook-stopped': {
      if (event.stop) {
        return dispatchStopInfo(
          event.stop,
          'Execution stopped by hook: ',
          deps,
          userMessageTimestamp,
        );
      }
      return;
    }
    case 'loop-detected': {
      deps.loopDetectedRef.current = true;
      return;
    }
    case 'context-overflow':
    case 'error':
      // No additional item — the preceding context-warning/error event
      // already rendered the user-visible message.
      return;
    default:
      return;
  }
}

/**
 * Dispatches a single public AgentEvent to the appropriate React state update.
 */
export function dispatchAgentEvent(
  event: AgentEvent,
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
  switch (event.type) {
    case 'text':
      return dispatchTextEvent(deps);
    case 'thinking':
      return dispatchThinkingEvent(deps);
    case 'usage':
      return dispatchUsageEvent(event, deps);
    case 'model-info':
    case 'compression':
    case 'context-warning':
    case 'citation':
      return dispatchInformationalEvent(event, deps, userMessageTimestamp);
    case 'loop-detected':
      deps.loopDetectedRef.current = true;
      return;
    case 'idle-timeout':
      return dispatchIdleTimeoutEvent(event, deps, userMessageTimestamp);
    case 'hook-blocked':
      return dispatchHookBlockedEvent(event, deps, userMessageTimestamp);
    case 'error':
      return dispatchErrorEvent(event, deps, userMessageTimestamp);
    case 'done':
      return dispatchDoneEvent(event, deps, userMessageTimestamp);
    case 'retry':
      deps.handleStreamAttemptDiscarded();
      return;
    case 'attempt-boundary':
      return dispatchAttemptBoundary(deps, userMessageTimestamp);
    case 'tool-call':
    case 'tool-result':
    case 'tool-confirmation':
    case 'tool-status':
    case 'invalid-stream':
    case 'notice':
      // No state change — display flows through displayCallbacks or is
      // handled by the loop internally.
      return;
    default:
      return;
  }
}

/**
 * Continuation attempts of one prompt used to stream into the same pending
 * assistant message (issue #3840). A message draws its thinking above its text,
 * so a later attempt's thinking rendered above the earlier attempt's reply, and
 * its first words ran onto the earlier last line. The boundary finishes the
 * open assistant message, the same commit that precedes any non-assistant item,
 * so the next attempt's thinking and text open a new message below it. Separate
 * messages are separated by construction, so no text is inserted.
 */
function dispatchAttemptBoundary(
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
  const pending = deps.pendingHistoryItemRef.current;
  if (pending?.type !== 'gemini' && pending?.type !== 'gemini_content') {
    return;
  }
  flushPendingAiContent(deps, userMessageTimestamp);
  return;
}

function dispatchInformationalEvent(
  event: Extract<
    AgentEvent,
    { type: 'model-info' | 'compression' | 'context-warning' | 'citation' }
  >,
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
  if (event.type === 'model-info') {
    handleModelInfoEvent(deps, event.info, userMessageTimestamp);
    return;
  }
  if (event.type === 'compression') {
    deps.handleChatCompressionEvent(event.info, userMessageTimestamp);
    return;
  }
  if (event.type === 'context-warning') {
    deps.handleContextWindowWillOverflowEvent(
      event.estimatedRequestTokenCount,
      event.remainingTokenCount,
    );
    return;
  }
  deps.handleCitationEvent(event.citation, userMessageTimestamp);
  return;
}

function dispatchHookBlockedEvent(
  event: Extract<AgentEvent, { type: 'hook-blocked' }>,
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
  dispatchStopInfo(
    event.info,
    'Execution blocked by hook: ',
    deps,
    userMessageTimestamp,
  );
}

function dispatchTextEvent(deps: AgentEventDeps): void {
  deps.setLastAgentActivityTime(Date.now());
  return;
}

function dispatchThinkingEvent(deps: AgentEventDeps): void {
  deps.setLastAgentActivityTime(Date.now());
  return;
}

function dispatchUsageEvent(
  event: Extract<AgentEvent, { type: 'usage' }>,
  deps: AgentEventDeps,
): void {
  if (event.usage.promptTokenCount !== undefined) {
    deps.setLastPromptTokenCount(event.usage.promptTokenCount);
  }
  return;
}

function dispatchIdleTimeoutEvent(
  event: Extract<AgentEvent, { type: 'idle-timeout' }>,
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
  const errorValue: ErrorEvent['value'] = { error: event.error };
  deps.handleErrorEvent(errorValue, userMessageTimestamp, {
    clearQueue: false,
  });
  return;
}

function dispatchErrorEvent(
  event: Extract<AgentEvent, { type: 'error' }>,
  deps: AgentEventDeps,
  userMessageTimestamp: number,
): void {
  const errorValue: ErrorEvent['value'] = { error: event.error };
  deps.handleErrorEvent(errorValue, userMessageTimestamp);
  return;
}
