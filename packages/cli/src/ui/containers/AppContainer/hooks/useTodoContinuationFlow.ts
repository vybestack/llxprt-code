/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @hook useTodoContinuationFlow
 * @description Todo continuation detection and prompts
 * @inputs config, streamingState, history, pendingHistoryItems, todoContinuation
 * @outputs todoContinuationRef
 * @sideEffects Effect watching streaming state
 * @cleanup N/A
 * @strictMode Safe - effect deps are stable
 * @subscriptionStrategy Resubscribe
 */

import { useEffect, useRef } from 'react';
import {
  StreamingState,
  type HistoryItem,
  type HistoryItemWithoutId,
} from '../../../types.js';
import { type Config } from '@vybestack/llxprt-code-core';
import {
  useTodoContinuation,
  type TodoContinuationHook,
} from '../../../hooks/useTodoContinuation.js';

export type { TodoContinuationHook };

interface UseTodoContinuationFlowOptions {
  config: Config;
  streamingState: StreamingState;
  history: HistoryItem[];
  pendingHistoryItems: HistoryItemWithoutId[];
  setDebugMessage: (message: string) => void;
}

export interface UseTodoContinuationFlowResult {
  todoContinuationRef: React.MutableRefObject<Pick<
    TodoContinuationHook,
    'handleTodoPause' | 'clearPause'
  > | null>;
  hadToolCallsRef: React.MutableRefObject<boolean>;
}

export function useTodoContinuationFlow({
  config,
  streamingState,
  history,
  pendingHistoryItems,
  setDebugMessage,
}: UseTodoContinuationFlowOptions): UseTodoContinuationFlowResult {
  const todoContinuationRef = useRef<Pick<
    TodoContinuationHook,
    'handleTodoPause' | 'clearPause'
  > | null>(null);

  /**
   * @plan PLAN-20260129-TODOPERSIST.P12
   * Wire up todo continuation detection to trigger continuation prompts
   * when streams complete without tool calls and active TODOs exist.
   */
  const geminiClientForContinuation = config.getGeminiClient();
  const todoContinuation = useTodoContinuation(
    geminiClientForContinuation,
    config,
    streamingState === StreamingState.Responding ||
      streamingState === StreamingState.WaitingForConfirmation,
    setDebugMessage,
  );

  todoContinuationRef.current = todoContinuation;

  // Track previous streaming state to detect turn completion
  const prevStreamingStateRef = useRef<StreamingState>(streamingState);

  /**
   * @plan PLAN-20260129-TODOPERSIST.P12
   * Track whether tool calls were made during the turn for continuation decision.
   * Tool calls signal the AI made progress, so we don't need continuation.
   */
  const hadToolCallsRef = useRef<boolean>(false);

  /**
   * @plan PLAN-20260129-TODOPERSIST.P12
   * Track tool calls by detecting tool_group items in history and pending items.
   */
  useEffect(() => {
    const hasToolCalls =
      history.some((item) => item.type === 'tool_group') ||
      pendingHistoryItems.some((item) => item.type === 'tool_group');

    if (
      hasToolCalls &&
      (streamingState === StreamingState.Responding ||
        streamingState === StreamingState.WaitingForConfirmation)
    ) {
      hadToolCallsRef.current = true;
    }
  }, [history, pendingHistoryItems, streamingState]);

  // Detect turn completion (streaming goes idle) for continuation logic
  useEffect(() => {
    const wasActive =
      prevStreamingStateRef.current === StreamingState.Responding ||
      prevStreamingStateRef.current === StreamingState.WaitingForConfirmation;
    const isNowIdle = streamingState === StreamingState.Idle;
    prevStreamingStateRef.current = streamingState;

    if (!wasActive || !isNowIdle) {
      return;
    }

    /**
     * @plan PLAN-20260129-TODOPERSIST.P12
     * Notify continuation logic that stream completed.
     * Pass hadToolCalls to determine if continuation is needed.
     */
    todoContinuation.handleStreamCompleted(hadToolCallsRef.current);

    // Reset for next turn
    hadToolCallsRef.current = false;
  }, [streamingState, todoContinuation]);

  return {
    todoContinuationRef,
    hadToolCallsRef,
  };
}
