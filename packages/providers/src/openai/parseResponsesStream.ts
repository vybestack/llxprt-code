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
import type { StreamLivenessListener } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import { randomUUID } from 'node:crypto';
import { isAcceptedTerminalEventType } from './responsesTerminalEvents.js';
import { mapFinishReasonToStopReason } from './finishReasonMapping.js';
import type {
  DispatchResult,
  DispatchState,
  FunctionCallState,
  ReasoningDeltaSource,
  ResponsesApiError,
  ResponsesEvent,
} from './parseResponsesStreamTypes.js';
import {
  appendReasoningDelta,
  allocateReasoningStreamId,
  closeReasoningStream,
  chooseVisibleReasoningText,
  shouldEmitReasoningDelta,
  updateReasoningDeltaState,
} from './parseResponsesStreamReasoning.js';
import {
  assertProviderStreamByteLimit,
  MAX_PROVIDER_SSE_LINE_BYTES,
  MAX_PROVIDER_TOOL_CALL_BYTES,
  utf8ByteLength,
} from '../streamLimits.js';

const logger = new DebugLogger('llxprt:providers:openai-responses:sse');

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
  /** Marks response IDs emitted by requests whose results were stored. */
  responsesStored?: boolean;
  /**
   * Reports every successfully parsed SSE event as transport/provider liveness.
   * Malformed data and the [DONE] sentinel do not count.
   */
  onStreamLiveness?: StreamLivenessListener;
  /**
   * When true, reader EOF reached without an accepted terminal response event
   * (response.completed, response.done, response.incomplete) raises a
   * StreamInterruptionError instead of completing normally. Used by the
   * HTTP/SSE path to detect a connection cut mid-body (issue #3049).
   * Default false so the WebSocket caller and existing tests are untouched.
   */
  requireTerminalEvent?: boolean;
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
    const argumentsValue = event.item.arguments ?? '';
    const argumentBytes = utf8ByteLength(argumentsValue);
    assertProviderStreamByteLimit(
      'tool-call arguments',
      argumentBytes,
      MAX_PROVIDER_TOOL_CALL_BYTES,
    );
    functionCalls.set(event.item.id, {
      id: event.item.id,
      call_id: event.item.call_id,
      name: event.item.name ?? '',
      arguments: argumentsValue,
      argumentBytes,
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
      call.argumentBytes += utf8ByteLength(event.delta);
      assertProviderStreamByteLimit(
        'tool-call arguments',
        call.argumentBytes,
        MAX_PROVIDER_TOOL_CALL_BYTES,
      );
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
          providerMetadata: {
            'openai.responses.reasoningId': event.item?.id,
          },
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

  // A provider that sends the whole payload in the terminal event, with no
  // deltas, would otherwise never pass through the delta cap. The accumulated
  // path is already bounded, so only the terminal payload is measured here.
  if (event.arguments !== undefined) {
    assertProviderStreamByteLimit(
      'tool-call arguments',
      utf8ByteLength(event.arguments),
      MAX_PROVIDER_TOOL_CALL_BYTES,
    );
  }
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

// OpenAI's ResponseErrorEvent carries message/code/param at the top level.
// Merge the two shapes so the documented top-level fields win for message/code
// while anything already modelled on the nested error object (notably type)
// still survives. Returns undefined only when neither source has anything.
function topLevelErrorPayload(
  event: ResponsesEvent,
): ResponsesApiError | undefined {
  const nested = event.error;
  const hasTopLevel =
    event.message !== undefined ||
    event.code !== undefined ||
    event.param !== undefined;
  if (nested === undefined && !hasTopLevel) return undefined;
  return {
    message: event.message ?? nested?.message,
    type: nested?.type,
    code: event.code ?? nested?.code,
    // `null` is a meaningful value (no offending param): preserve it rather
    // than treating it as a fallback trigger.
    param: event.param !== undefined ? event.param : nested?.param,
  };
}

function getIncompleteReason(
  event: ResponsesEvent,
  terminalReason: string,
): string | undefined {
  return terminalReason === 'incomplete'
    ? event.response?.incomplete_details?.reason
    : undefined;
}

/**
 * Handle response.completed / response.done / response.incomplete events.
 */
function* handleResponseCompleted(
  event: ResponsesEvent,
  state: DispatchState,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
  responsesStored: boolean,
): Generator<IContent, DispatchState> {
  let nextState = state;
  let newHasEmitted = state.hasEmittedVisibleThinking;

  const terminalReason = event.response?.status ?? 'completed';
  const incompleteReason = getIncompleteReason(event, terminalReason);

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

  const responseId = event.response?.id;
  if (event.response?.usage || responseId) {
    yield {
      speaker: 'ai',
      blocks: [],
      metadata: {
        ...(event.response?.usage
          ? {
              usage: {
                promptTokens: event.response.usage.input_tokens,
                completionTokens: event.response.usage.output_tokens,
                totalTokens: event.response.usage.total_tokens,
                cachedTokens:
                  event.response.usage.input_tokens_details?.cached_tokens ?? 0,
              },
            }
          : {}),
        ...(responseId ? { id: responseId } : {}),
        ...(responsesStored ? { responsesStored: true } : {}),
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
  responsesStored: boolean,
): Generator<IContent, DispatchState> {
  return yield* handleResponseCompleted(
    event,
    state,
    includeThinkingInResponse,
    emittedThoughts,
    responsesStored,
  );
}

function* dispatchEventCases(
  event: ResponsesEvent,
  state: DispatchState,
  functionCalls: Map<string, FunctionCallState>,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
  responsesStored: boolean,
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
        responsesStored,
      );
      break;
    case 'response.failed':
      throw createTerminalStreamError(
        event.response?.error ?? event.error,
        event.response?.status,
      );
    case 'error':
      throw createTerminalStreamError(topLevelErrorPayload(event));
    default:
      break;
  }

  return state;
}

/**
 * Notifies the optional liveness listener for any successfully parsed SSE
 * event. Listener failures must not break stream parsing.
 */
function notifyStreamLiveness(
  listener: StreamLivenessListener | undefined,
  event: ResponsesEvent,
): void {
  if (listener === undefined) {
    return;
  }
  try {
    listener({ sourceEvent: event.type, sseObserved: true });
  } catch {
    // The watchdog callback is observational and cannot own parser failure.
  }
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
  responsesStored: boolean,
  onStreamLiveness: StreamLivenessListener | undefined,
  lastLoggedType: string | undefined,
): Generator<IContent, DispatchResult> {
  const newLastLoggedType = logSseEvent(event, lastLoggedType);
  notifyStreamLiveness(onStreamLiveness, event);

  const result: DispatchState = yield* dispatchEventCases(
    event,
    state,
    functionCalls,
    includeThinkingInResponse,
    emittedThoughts,
    responsesStored,
  );

  return {
    ...result,
    lastLoggedType: newLastLoggedType,
    dispatchedEventType: event.type,
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
  responsesStored: boolean,
  onStreamLiveness: StreamLivenessListener | undefined,
  lastLoggedType: string | undefined,
): AsyncGenerator<IContent, DispatchResult> {
  let event: ResponsesEvent;
  try {
    event = JSON.parse(data);
  } catch {
    // Skip malformed JSON events: return unchanged state and no dispatched
    // event type so it contributes neither to logging dedup nor to terminal
    // tracking.
    return {
      ...state,
      lastLoggedType,
      dispatchedEventType: undefined,
    };
  }

  return yield* dispatchEvent(
    event,
    state,
    functionCalls,
    includeThinkingInResponse,
    emittedThoughts,
    responsesStored,
    onStreamLiveness,
    lastLoggedType,
  );
}

export async function* parseResponsesStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseResponsesStreamOptions = {},
): AsyncIterableIterator<IContent> {
  const {
    includeThinkingInResponse = true,
    responsesStored = false,
    onStreamLiveness,
    requireTerminalEvent = false,
  } = options;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const functionCalls = new Map<string, FunctionCallState>();
  let state: DispatchState = {
    hasEmittedVisibleThinking: false,
    reasoningText: '',
    reasoningSummaryText: '',
    reasoningStreamEpoch: randomUUID(),
    nextReasoningStreamIndex: 0,
  };

  // Track emitted thinking content to prevent duplicates (fixes #922).
  const emittedThoughts = new Map<string, { hasEncrypted: boolean }>();

  let lastLoggedType: string | undefined;
  let acceptedTerminalSeen = false;

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
      assertProviderStreamByteLimit(
        'incomplete SSE line',
        utf8ByteLength(buffer),
        MAX_PROVIDER_SSE_LINE_BYTES,
      );

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
          responsesStored,
          onStreamLiveness,
          lastLoggedType,
        );
        state = dispatchState;
        lastLoggedType = dispatchState.lastLoggedType;
        // Record accepted-terminal state monotonically for every
        // successfully dispatched event (OR semantics). `lastLoggedType` is
        // deduplicated and can be overwritten by a later nonterminal event in
        // the same chunk, so terminal tracking must use the per-event
        // dispatched type. A protocol-failure terminal (response.failed/error)
        // still throws during dispatch above and is never masked (#3049).
        acceptedTerminalSeen ||= isAcceptedTerminalEventType(
          dispatchState.dispatchedEventType,
        );
      }
    }
    // Reader reached EOF. When the caller opted in (HTTP/SSE path), a body
    // that never carried an accepted terminal event is a truncated stream,
    // not a complete response. Throw on the normal completion path only —
    // never from `finally`, so consumer-driven break/return() is not turned
    // into an error and in-flight exceptions are not masked (issue #3049).
    if (requireTerminalEvent && !acceptedTerminalSeen) {
      throw createStreamInterruptionError(
        'Responses stream ended without an accepted terminal response event ' +
          '(expected one of: response.completed, response.done, ' +
          'response.incomplete)',
      );
    }
  } finally {
    reader.releaseLock();
  }
}

// Re-exported to preserve the public API surface; implementation moved to
// responsesErrorParsing.ts to keep this module within the max-lines budget.
export { parseErrorResponse } from './responsesErrorParsing.js';
