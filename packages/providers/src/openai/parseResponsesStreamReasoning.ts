/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure reasoning-state helpers extracted from parseResponsesStream.ts.
 *
 * These functions transform {@link DispatchState} without touching the SSE
 * reader, liveness listener, or retry semantics, so the response-state
 * transitions remain unit-testable in isolation.
 */

import type {
  DispatchState,
  ReasoningDeltaSource,
} from './parseResponsesStreamTypes.js';

export const OPENAI_REASONING_STREAM_ID_PREFIX = 'openai-responses-reasoning';

export function appendReasoningDelta(current: string, delta: string): string {
  if (!delta) {
    return current;
  }
  if (!current) {
    return delta;
  }
  const lastChar = current[current.length - 1];
  const nextChar = delta[0];
  const needsSpace =
    /[\w)]/.test(lastChar) && /[\w(]/.test(nextChar) && !/\s/.test(nextChar);
  return needsSpace ? `${current} ${delta}` : `${current}${delta}`;
}

export function allocateReasoningStreamId(state: DispatchState): {
  state: DispatchState;
  streamId: string;
} {
  if (state.currentReasoningStreamId !== undefined) {
    return { state, streamId: state.currentReasoningStreamId };
  }

  const streamId = `${OPENAI_REASONING_STREAM_ID_PREFIX}:${state.nextReasoningStreamIndex}`;
  return {
    state: {
      ...state,
      currentReasoningStreamId: streamId,
      nextReasoningStreamIndex: state.nextReasoningStreamIndex + 1,
    },
    streamId,
  };
}

export function closeReasoningStream(state: DispatchState): DispatchState {
  return {
    ...state,
    currentReasoningStreamId: undefined,
    lastEmittedReasoningDelta: undefined,
  };
}

export function chooseVisibleReasoningText(
  visibleReasoningSource: ReasoningDeltaSource | undefined,
  reasoningText: string,
  reasoningSummaryText: string,
): string {
  if (visibleReasoningSource === 'reasoning_summary_text') {
    return reasoningSummaryText || reasoningText;
  }
  return reasoningText || reasoningSummaryText;
}

export function shouldEmitReasoningDelta(
  source: ReasoningDeltaSource,
  text: string,
  state: DispatchState,
): boolean {
  if (text.trim().length === 0) {
    return false;
  }
  if (source === 'reasoning_text') {
    return (
      state.visibleReasoningSource !== 'reasoning_summary_text' &&
      state.visibleReasoningSource !== 'output_item'
    );
  }
  return (
    state.visibleReasoningSource === undefined ||
    state.visibleReasoningSource === 'reasoning_summary_text'
  );
}

export function updateReasoningDeltaState(
  source: ReasoningDeltaSource,
  text: string,
  shouldEmitDelta: boolean,
  state: DispatchState,
  nextState: DispatchState,
): DispatchState {
  return {
    ...nextState,
    hasEmittedVisibleThinking: shouldEmitDelta
      ? true
      : state.hasEmittedVisibleThinking,
    ...(source === 'reasoning_text'
      ? { reasoningText: text }
      : { reasoningSummaryText: text }),
    visibleReasoningSource: text.trim()
      ? (nextState.visibleReasoningSource ?? source)
      : nextState.visibleReasoningSource,
    lastEmittedReasoningDelta: shouldEmitDelta
      ? text
      : state.lastEmittedReasoningDelta,
  };
}
