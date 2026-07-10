/**
 * Parses OpenAI Responses API server-sent events (SSE) and yields IContent messages.
 * Handles text output, tool calls, reasoning/thinking content, and usage metadata.
 *
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */

import {
  type ContentBlock,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createStreamInterruptionError } from '@vybestack/llxprt-code-core/utils/retry.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { mapFinishReasonToStopReason } from './finishReasonMapping.js';
import type {
  DispatchResult,
  DispatchState,
  FunctionCallState,
  ReasoningDeltaSource,
  ResponsesApiError,
  ResponsesEvent,
} from './parseResponsesStreamTypes.js';

const logger = new DebugLogger('llxprt:providers:openai-responses:sse');
const OPENAI_REASONING_STREAM_ID_PREFIX = 'openai-responses-reasoning';

function appendReasoningDelta(current: string, delta: string): string {
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

/**
 * Options for parseResponsesStream.
 */
export interface ParseResponsesStreamOptions {
  /**
   * Whether to emit ThinkingBlock content in the output stream.
   * When false, reasoning content is still accumulated but not yielded.
   * Defaults to true.
   */
  includeThinkingInResponse?: boolean;
}

/**
 * Handle a text delta event.
 */
function* handleTextDelta(event: ResponsesEvent): Generator<IContent> {
  if (event.delta) {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: event.delta }],
    };
  }
}

/**
 * Yield a thinking block, tracking emitted state to prevent duplicates.
 * Delta callers manage the map entry because only the latest delta should be
 * retained for bounded duplicate suppression until a complete block arrives.
 */
function allocateReasoningStreamId(state: DispatchState): {
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

function closeReasoningStream(state: DispatchState): DispatchState {
  return {
    ...state,
    currentReasoningStreamId: undefined,
    lastEmittedReasoningDelta: undefined,
  };
}

function chooseVisibleReasoningText(
  visibleReasoningSource: ReasoningDeltaSource | undefined,
  reasoningText: string,
  reasoningSummaryText: string,
): string {
  if (visibleReasoningSource === 'reasoning_summary_text') {
    return reasoningSummaryText || reasoningText;
  }
  return reasoningText || reasoningSummaryText;
}

function* yieldThinkingBlock(
  thoughtText: string,
  includeThinkingInResponse: boolean,
  shouldHide: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
  streamId: string | undefined,
  streamStatus?: 'delta' | 'complete',
): Generator<IContent> {
  yield {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: thoughtText,
        sourceField: 'reasoning_content',
        isHidden: shouldHide,
        ...(streamId !== undefined && streamStatus !== undefined
          ? { streamId, streamStatus }
          : {}),
      },
    ],
  };
  if (streamStatus !== 'delta') {
    emittedThoughts.set(thoughtText, { hasEncrypted: false });
  }
}

/**
 * Handle reasoning_text.done and reasoning_summary_text.done events.
 */
function* handleReasoningDone(
  event: ResponsesEvent,
  reasoningSource: string,
  includeThinkingInResponse: boolean,
  hasEmittedVisibleThinking: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<
  IContent,
  { hasEmittedVisibleThinking: boolean; reasoningCleared: string }
> {
  const content = (event.text ?? reasoningSource).trim();
  if (content && !emittedThoughts.has(content) && !hasEmittedVisibleThinking) {
    yield* yieldThinkingBlock(
      content,
      includeThinkingInResponse,
      !includeThinkingInResponse,
      emittedThoughts,
      undefined,
    );
    return {
      hasEmittedVisibleThinking: true,
      reasoningCleared: '',
    };
  }
  return { hasEmittedVisibleThinking, reasoningCleared: '' };
}

/**
 * Handle an output_item.added event for function calls.
 */
function handleOutputItemAdded(
  event: ResponsesEvent,
  functionCalls: Map<string, FunctionCallState>,
): void {
  if (event.item?.type === 'function_call' && event.item.id) {
    functionCalls.set(event.item.id, {
      id: event.item.id,
      call_id: event.item.call_id,
      name: event.item.name ?? '',
      arguments: event.item.arguments ?? '',
    });
  }
}

/**
 * Handle function_call_arguments.delta event.
 */
function handleArgumentsDelta(
  event: ResponsesEvent,
  functionCalls: Map<string, FunctionCallState>,
): void {
  if (event.item_id && event.delta) {
    const call = functionCalls.get(event.item_id);
    if (call) {
      call.arguments += event.delta;
    }
  }
}

/**
 * Extract thought text from a reasoning item.
 */
function extractThoughtText(
  event: ResponsesEvent,
  reasoningText: string,
  reasoningSummaryText: string,
): string {
  let thoughtText =
    event.item?.summary
      ?.map((s: { text?: string }) => s.text)
      .filter(Boolean)
      .join(' ') ?? '';

  if (!thoughtText && event.item?.content) {
    thoughtText = event.item.content
      .map((c: { text?: string }) => c.text)
      .filter(Boolean)
      .join(' ');
  }

  const itemText = thoughtText.trim();

  if (!itemText) {
    if (reasoningSummaryText.trim()) {
      thoughtText = reasoningSummaryText.trim();
    } else if (reasoningText.trim()) {
      thoughtText = reasoningText.trim();
    }
  }

  return thoughtText.trim();
}

/**
 * Handle a reasoning item from output_item.done event.
 */
function* handleReasoningItem(
  event: ResponsesEvent,
  includeThinkingInResponse: boolean,
  hasEmittedVisibleThinking: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<
  IContent,
  {
    hasEmittedVisibleThinking: boolean;
    reasoningCleared: string;
    summaryCleared: string;
  }
> {
  const finalThought = extractThoughtText(event, '', '');
  const hasEncryptedContent = Boolean(event.item?.encrypted_content);
  const prior = emittedThoughts.get(finalThought);

  // Emit if:
  // 1. Never emitted this thought before, OR
  // 2. Previously emitted WITHOUT encrypted_content, but now we have it
  const shouldEmit =
    finalThought !== '' &&
    (prior === undefined ||
      (hasEncryptedContent && prior.hasEncrypted !== true));

  if (shouldEmit) {
    const shouldHide = !includeThinkingInResponse || Boolean(prior);

    const newHasEmittedVisible = hasEmittedVisibleThinking || !shouldHide;

    const baseReasoningBlock: ContentBlock = {
      type: 'thinking',
      thought: finalThought,
      sourceField: 'reasoning_content',
      isHidden: shouldHide,
    };
    const reasoningBlock: ContentBlock = hasEncryptedContent
      ? {
          ...baseReasoningBlock,
          encryptedContent: event.item?.encrypted_content,
        }
      : baseReasoningBlock;

    yield {
      speaker: 'ai',
      blocks: [reasoningBlock],
    };

    // Update tracking
    emittedThoughts.set(finalThought, {
      hasEncrypted: Boolean(prior?.hasEncrypted) || hasEncryptedContent,
    });

    return {
      hasEmittedVisibleThinking: newHasEmittedVisible,
      reasoningCleared: '',
      summaryCleared: '',
    };
  }

  return {
    hasEmittedVisibleThinking,
    reasoningCleared: '',
    summaryCleared: '',
  };
}

/**
 * Handle a completed function call from output_item.done or arguments.done.
 */
function* handleFunctionCallDone(
  event: ResponsesEvent,
  functionCalls: Map<string, FunctionCallState>,
): Generator<IContent> {
  const itemId = event.item?.id ?? event.item_id;
  if (!itemId) return;
  const call = functionCalls.get(itemId);
  if (!call) return;

  const finalArguments = event.arguments ?? call.arguments;

  let parsedArguments: unknown = {};
  if (finalArguments) {
    try {
      parsedArguments = JSON.parse(finalArguments);
    } catch (parseError) {
      throw createStreamInterruptionError(
        'Streaming tool call arguments were malformed JSON.',
        {
          itemId,
          snippet: finalArguments.slice(0, 200),
        },
        parseError,
      );
    }
  }

  yield {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: call.call_id ?? call.id,
        name: call.name,
        parameters: parsedArguments,
      },
    ],
  };

  // Clean up
  functionCalls.delete(itemId);
}

/**
 * Build a stream-interruption error for terminal `response.failed`
 * or top-level `error` events. Uses createStreamInterruptionError so the error
 * is classified as transient/retryable (server-side failures should be retried).
 * Callers are responsible for throwing the returned Error.
 */
function createTerminalStreamError(
  errorPayload: ResponsesApiError | undefined,
  responseStatus?: string | number,
): Error {
  const message = errorPayload?.message ?? 'OpenAI Responses API stream failed';
  return createStreamInterruptionError(message, {
    providerError: errorPayload,
    responseStatus,
  });
}

/**
 * Handle response.completed / response.done / response.incomplete events.
 */
function* handleResponseCompleted(
  event: ResponsesEvent,
  state: DispatchState,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<IContent, DispatchState> {
  let nextState = state;
  let newHasEmitted = state.hasEmittedVisibleThinking;

  // Usage data
  const terminalReason = event.response?.status ?? 'completed';
  const incompleteReason =
    terminalReason === 'incomplete'
      ? event.response?.incomplete_details?.reason
      : undefined;

  // Defensive: some implementations send failure via response.completed with
  // status "failed" rather than a standalone response.failed event.
  if (terminalReason === 'failed') {
    throw createTerminalStreamError(
      event.response?.error,
      event.response?.status,
    );
  }

  const remainingReasoning = state.reasoningText.trim();
  const remainingSummary = state.reasoningSummaryText.trim();
  const terminalThought = chooseVisibleReasoningText(
    state.visibleReasoningSource,
    remainingReasoning,
    remainingSummary,
  );

  if (terminalThought && nextState.currentReasoningStreamId !== undefined) {
    const allocated = allocateReasoningStreamId(nextState);
    nextState = allocated.state;
    if (nextState.lastEmittedReasoningDelta !== undefined) {
      emittedThoughts.delete(nextState.lastEmittedReasoningDelta);
    }
    yield* yieldThinkingBlock(
      terminalThought,
      includeThinkingInResponse,
      !includeThinkingInResponse,
      emittedThoughts,
      allocated.streamId,
      'complete',
    );
    nextState = closeReasoningStream(nextState);
    newHasEmitted = true;
  } else if (nextState.currentReasoningStreamId !== undefined) {
    if (nextState.lastEmittedReasoningDelta !== undefined) {
      emittedThoughts.delete(nextState.lastEmittedReasoningDelta);
    }
    nextState = closeReasoningStream(nextState);
  }

  if (event.response?.usage) {
    yield {
      speaker: 'ai',
      blocks: [],
      metadata: {
        usage: {
          promptTokens: event.response.usage.input_tokens,
          completionTokens: event.response.usage.output_tokens,
          totalTokens: event.response.usage.total_tokens,
          cachedTokens:
            event.response.usage.input_tokens_details?.cached_tokens ?? 0,
        },
        stopReason: mapFinishReasonToStopReason(terminalReason),
        finishReason: terminalReason,
        ...(incompleteReason ? { incompleteReason } : {}),
      },
    };
  }

  return {
    ...nextState,
    hasEmittedVisibleThinking: newHasEmitted,
    reasoningText: '',
    reasoningSummaryText: '',
  };
}

/**
 * Log SSE event details for debugging.
 */
function logSseEvent(
  event: ResponsesEvent,
  lastLoggedType: string | undefined,
): string | undefined {
  const newLastLoggedType =
    event.type !== lastLoggedType ? event.type : lastLoggedType;

  logger.debug(
    () =>
      `SSE event: type=${event.type}, delta="${event.delta?.slice(0, 50) ?? ''}", text="${event.text?.slice(0, 50) ?? ''}", item_type=${event.item?.type ?? 'none'}, summary_index=${event.summary_index ?? 'none'}, content_index=${event.content_index ?? 'none'}`,
  );
  // Extra debug for any reasoning-related events
  if (event.type.includes('reasoning') || event.item?.type === 'reasoning') {
    logger.debug(() => `REASONING SSE: ${JSON.stringify(event).slice(0, 500)}`);
  }

  // Debug: Log raw reasoning items
  if (event.item?.type === 'reasoning') {
    logger.debug(
      () =>
        `Reasoning item received: summary=${JSON.stringify(event.item?.summary)}, content=${JSON.stringify(event.item?.content)}, encrypted_content_length=${event.item?.encrypted_content?.length ?? 0}`,
    );
  }

  return newLastLoggedType;
}

/**
 * Handle the switch dispatch for a single SSE event type.
 */
function shouldEmitReasoningDelta(
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

function* emitReasoningDelta(
  text: string,
  state: DispatchState,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<IContent, DispatchState> {
  const allocated = allocateReasoningStreamId(state);
  if (state.lastEmittedReasoningDelta !== undefined) {
    emittedThoughts.delete(state.lastEmittedReasoningDelta);
  }
  yield* yieldThinkingBlock(
    text,
    includeThinkingInResponse,
    !includeThinkingInResponse,
    emittedThoughts,
    allocated.streamId,
    'delta',
  );
  emittedThoughts.set(text, { hasEncrypted: false });
  return allocated.state;
}

function updateReasoningDeltaState(
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

function* handleReasoningDeltaEvent(
  event: ResponsesEvent,
  state: DispatchState,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<IContent, DispatchState> {
  if (event.type === 'response.reasoning_text.delta' && event.delta) {
    const text = appendReasoningDelta(state.reasoningText, event.delta);
    const shouldEmitDelta = shouldEmitReasoningDelta(
      'reasoning_text',
      text,
      state,
    );
    const nextState = shouldEmitDelta
      ? yield* emitReasoningDelta(
          text,
          state,
          includeThinkingInResponse,
          emittedThoughts,
        )
      : state;
    return updateReasoningDeltaState(
      'reasoning_text',
      text,
      shouldEmitDelta,
      state,
      nextState,
    );
  }
  if (event.type === 'response.reasoning_summary_text.delta' && event.delta) {
    const text = appendReasoningDelta(state.reasoningSummaryText, event.delta);
    const shouldEmitDelta = shouldEmitReasoningDelta(
      'reasoning_summary_text',
      text,
      state,
    );
    const nextState = shouldEmitDelta
      ? yield* emitReasoningDelta(
          text,
          state,
          includeThinkingInResponse,
          emittedThoughts,
        )
      : state;
    return updateReasoningDeltaState(
      'reasoning_summary_text',
      text,
      shouldEmitDelta,
      state,
      nextState,
    );
  }
  return state;
}

function* handleReasoningDoneEvent(
  event: ResponsesEvent,
  state: DispatchState,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<IContent, DispatchState> {
  const isReasoningText = event.type === 'response.reasoning_text.done';
  const source = isReasoningText
    ? state.reasoningText
    : state.reasoningSummaryText;
  const sourceKind: ReasoningDeltaSource = isReasoningText
    ? 'reasoning_text'
    : 'reasoning_summary_text';
  const content = (event.text ?? source).trim();

  if (content && state.visibleReasoningSource === sourceKind) {
    const allocated = allocateReasoningStreamId(state);
    if (state.lastEmittedReasoningDelta !== undefined) {
      emittedThoughts.delete(state.lastEmittedReasoningDelta);
    }
    yield* yieldThinkingBlock(
      content,
      includeThinkingInResponse,
      !includeThinkingInResponse,
      emittedThoughts,
      allocated.streamId,
      'complete',
    );
    return {
      ...closeReasoningStream(allocated.state),
      hasEmittedVisibleThinking: true,
      reasoningText: isReasoningText ? '' : state.reasoningText,
      reasoningSummaryText: isReasoningText ? state.reasoningSummaryText : '',
    };
  }

  const result = yield* handleReasoningDone(
    event,
    source,
    includeThinkingInResponse,
    state.hasEmittedVisibleThinking,
    emittedThoughts,
  );
  // A non-matching done event must not close another source's active stream;
  // response.completed is the cross-source catch-all closer.
  return {
    ...state,
    hasEmittedVisibleThinking: result.hasEmittedVisibleThinking,
    reasoningText: isReasoningText
      ? result.reasoningCleared
      : state.reasoningText,
    reasoningSummaryText: isReasoningText
      ? state.reasoningSummaryText
      : result.reasoningCleared,
  };
}

function* handleOutputItemDoneEvent(
  event: ResponsesEvent,
  state: DispatchState,
  functionCalls: Map<string, FunctionCallState>,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<IContent, DispatchState> {
  if (event.item?.type === 'reasoning') {
    let stateForItem = state;
    if (state.currentReasoningStreamId !== undefined) {
      const terminalThought = chooseVisibleReasoningText(
        state.visibleReasoningSource,
        state.reasoningText.trim(),
        state.reasoningSummaryText.trim(),
      );
      if (state.lastEmittedReasoningDelta !== undefined) {
        emittedThoughts.delete(state.lastEmittedReasoningDelta);
      }
      if (terminalThought) {
        const allocated = allocateReasoningStreamId(state);
        yield* yieldThinkingBlock(
          terminalThought,
          includeThinkingInResponse,
          !includeThinkingInResponse,
          emittedThoughts,
          allocated.streamId,
          'complete',
        );
        stateForItem = closeReasoningStream(allocated.state);
      } else {
        stateForItem = closeReasoningStream(state);
      }
    }
    const result = yield* handleReasoningItem(
      event,
      includeThinkingInResponse,
      stateForItem.hasEmittedVisibleThinking,
      emittedThoughts,
    );
    return {
      ...closeReasoningStream(stateForItem),
      hasEmittedVisibleThinking: result.hasEmittedVisibleThinking,
      reasoningText: result.reasoningCleared,
      reasoningSummaryText: result.summaryCleared,
      visibleReasoningSource: undefined,
    };
  }

  if (event.item?.type === 'function_call' || event.item_id) {
    yield* handleFunctionCallDone(event, functionCalls);
  }
  return state;
}

function* handleCompletedEvent(
  event: ResponsesEvent,
  state: DispatchState,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<IContent, DispatchState> {
  return yield* handleResponseCompleted(
    event,
    state,
    includeThinkingInResponse,
    emittedThoughts,
  );
}

function* dispatchEventCases(
  event: ResponsesEvent,
  state: DispatchState,
  functionCalls: Map<string, FunctionCallState>,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<IContent, DispatchState> {
  switch (event.type) {
    case 'response.output_text.delta':
      yield* handleTextDelta(event);
      break;
    case 'response.reasoning_text.delta':
    case 'response.reasoning_summary_text.delta':
      state = yield* handleReasoningDeltaEvent(
        event,
        state,
        includeThinkingInResponse,
        emittedThoughts,
      );
      break;
    case 'response.reasoning_text.done':
    case 'response.reasoning_summary_text.done':
      state = yield* handleReasoningDoneEvent(
        event,
        state,
        includeThinkingInResponse,
        emittedThoughts,
      );
      break;
    case 'response.output_item.added':
      handleOutputItemAdded(event, functionCalls);
      break;
    case 'response.function_call_arguments.delta':
      handleArgumentsDelta(event, functionCalls);
      break;
    case 'response.function_call_arguments.done':
    case 'response.output_item.done':
      state = yield* handleOutputItemDoneEvent(
        event,
        state,
        functionCalls,
        includeThinkingInResponse,
        emittedThoughts,
      );
      break;
    case 'response.completed':
    case 'response.done':
    case 'response.incomplete':
      state = yield* handleCompletedEvent(
        event,
        state,
        includeThinkingInResponse,
        emittedThoughts,
      );
      break;
    case 'response.failed':
      throw createTerminalStreamError(
        event.response?.error ?? event.error,
        event.response?.status,
      );
    case 'error':
      throw createTerminalStreamError(event.error);
    default:
      break;
  }

  return state;
}

/**
 * Dispatch a single SSE event to the appropriate handler.
 */
function* dispatchEvent(
  event: ResponsesEvent,
  state: DispatchState,
  functionCalls: Map<string, FunctionCallState>,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
  lastLoggedType: string | undefined,
): Generator<IContent, DispatchResult> {
  const newLastLoggedType = logSseEvent(event, lastLoggedType);

  const result: DispatchState = yield* dispatchEventCases(
    event,
    state,
    functionCalls,
    includeThinkingInResponse,
    emittedThoughts,
  );

  return {
    ...result,
    lastLoggedType: newLastLoggedType,
  };
}

/**
 * Parses a single SSE data payload and dispatches it, returning updated
 * dispatch state. Returns null for malformed JSON (preserving prior behavior
 * of silently skipping unparseable events).
 */
async function* tryDispatchEvent(
  data: string,
  state: DispatchState,
  functionCalls: Map<string, FunctionCallState>,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
  lastLoggedType: string | undefined,
): AsyncGenerator<IContent, DispatchResult> {
  let event: ResponsesEvent;
  try {
    event = JSON.parse(data);
  } catch {
    // Skip malformed JSON events: return unchanged state
    return {
      ...state,
      lastLoggedType,
    };
  }

  return yield* dispatchEvent(
    event,
    state,
    functionCalls,
    includeThinkingInResponse,
    emittedThoughts,
    lastLoggedType,
  );
}

export async function* parseResponsesStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseResponsesStreamOptions = {},
): AsyncIterableIterator<IContent> {
  const { includeThinkingInResponse = true } = options;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const functionCalls = new Map<string, FunctionCallState>();
  let state: DispatchState = {
    hasEmittedVisibleThinking: false,
    reasoningText: '',
    reasoningSummaryText: '',
    nextReasoningStreamIndex: 0,
  };

  // Track emitted thinking content to prevent duplicates (fixes #922).
  const emittedThoughts = new Map<string, { hasEncrypted: boolean }>();

  let lastLoggedType: string | undefined;

  try {
    const streamActive = { done: false };
    while (!streamActive.done) {
      const { done, value } = await reader.read();

      if (done) {
        streamActive.done = true;
        break;
      }

      // Decode chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      const dataLines = lines
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.substring(6))
        .filter((data) => data !== '[DONE]');

      for (const data of dataLines) {
        const dispatchState: DispatchResult = yield* tryDispatchEvent(
          data,
          state,
          functionCalls,
          includeThinkingInResponse,
          emittedThoughts,
          lastLoggedType,
        );
        state = dispatchState;
        lastLoggedType = dispatchState.lastLoggedType;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Re-exported to preserve the public API surface; implementation moved to
// responsesErrorParsing.ts to keep this module within the max-lines budget.
export { parseErrorResponse } from './responsesErrorParsing.js';
