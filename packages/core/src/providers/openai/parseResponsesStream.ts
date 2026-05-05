/**
 * Parses OpenAI Responses API server-sent events (SSE) and yields IContent messages.
 * Handles text output, tool calls, reasoning/thinking content, and usage metadata.
 *
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy provider boundary retained while larger decomposition continues. */

import {
  type ContentBlock,
  type IContent,
} from '../../services/history/IContent.js';
import { createStreamInterruptionError } from '../../utils/retry.js';
import { DebugLogger } from '../../debug/index.js';
import { mapFinishReasonToStopReason } from './finishReasonMapping.js';

const logger = new DebugLogger('llxprt:providers:openai-responses:sse');

// Types for Responses API events
interface ResponsesEvent {
  type: string;
  sequence_number?: number;
  output_index?: number;
  delta?: string;
  text?: string;
  content_index?: number;
  summary_index?: number;
  item?: {
    id: string;
    type: string;
    status?: string;
    arguments?: string;
    call_id?: string;
    name?: string;
    summary?: Array<{ type: string; text?: string }>;
    content?: Array<{ type: string; text?: string }>;
    encrypted_content?: string;
  };
  item_id?: string;
  arguments?: string;
  response?: {
    id: string;
    object: string;
    model: string;
    status: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      input_tokens_details?: {
        cached_tokens?: number;
      };
    };
  };
}

// Track function calls as they are built up
interface FunctionCallState {
  id: string;
  call_id?: string;
  name: string;
  arguments: string;
}

interface DispatchState {
  hasEmittedVisibleThinking: boolean;
  reasoningText: string;
  reasoningSummaryText: string;
}

interface DispatchResult extends DispatchState {
  lastLoggedType: string | undefined;
}

function appendReasoningDelta(current: string, delta: string): string {
  if (!delta) {
    return current;
  }
  if (!current) {
    return delta;
  }
  const lastChar = current[current.length - 1] ?? '';
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- OpenAI response streams are external provider boundaries despite declared types.
  const nextChar = delta[0] ?? '';
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
 */
function* yieldThinkingBlock(
  thoughtText: string,
  includeThinkingInResponse: boolean,
  shouldHide: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<IContent> {
  yield {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: thoughtText,
        sourceField: 'reasoning_content',
        isHidden: shouldHide,
      },
    ],
  };
  emittedThoughts.set(thoughtText, { hasEncrypted: false });
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
  const hasEncryptedContent = Boolean(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- OpenAI response streams are external provider boundaries despite declared types.
    event.item?.encrypted_content,
  );
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
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- OpenAI response streams are external provider boundaries despite declared types.
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
 * Handle response.completed / response.done events.
 */
function* handleResponseCompleted(
  event: ResponsesEvent,
  reasoningText: string,
  reasoningSummaryText: string,
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
  let newHasEmitted = hasEmittedVisibleThinking;

  // Fallback: emit any remaining reasoning
  const remainingReasoning = reasoningText.trim();
  if (
    remainingReasoning &&
    !emittedThoughts.has(remainingReasoning) &&
    !newHasEmitted
  ) {
    yield* yieldThinkingBlock(
      remainingReasoning,
      includeThinkingInResponse,
      !includeThinkingInResponse,
      emittedThoughts,
    );
    newHasEmitted = true;
  }
  const remainingSummary = reasoningSummaryText.trim();
  if (
    remainingSummary &&
    !emittedThoughts.has(remainingSummary) &&
    !newHasEmitted
  ) {
    yield* yieldThinkingBlock(
      remainingSummary,
      includeThinkingInResponse,
      !includeThinkingInResponse,
      emittedThoughts,
    );
    newHasEmitted = true;
  }

  // Usage data
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- OpenAI response streams are external provider boundaries despite declared types.
  const terminalReason = event.response?.status ?? 'completed';
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
      },
    };
  }

  return {
    hasEmittedVisibleThinking: newHasEmitted,
    reasoningCleared: '',
    summaryCleared: '',
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
function handleReasoningDeltaEvent(
  event: ResponsesEvent,
  state: DispatchState,
): DispatchState {
  if (event.type === 'response.reasoning_text.delta' && event.delta) {
    return {
      ...state,
      reasoningText: appendReasoningDelta(state.reasoningText, event.delta),
    };
  }
  if (event.type === 'response.reasoning_summary_text.delta' && event.delta) {
    return {
      ...state,
      reasoningSummaryText: appendReasoningDelta(
        state.reasoningSummaryText,
        event.delta,
      ),
    };
  }
  return state;
}

function* handleReasoningDoneEvent(
  event: ResponsesEvent,
  state: DispatchState,
  includeThinkingInResponse: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<IContent, DispatchState> {
  const source =
    event.type === 'response.reasoning_text.done'
      ? state.reasoningText
      : state.reasoningSummaryText;
  const result = yield* handleReasoningDone(
    event,
    source,
    includeThinkingInResponse,
    state.hasEmittedVisibleThinking,
    emittedThoughts,
  );
  return {
    hasEmittedVisibleThinking: result.hasEmittedVisibleThinking,
    reasoningText:
      event.type === 'response.reasoning_text.done'
        ? result.reasoningCleared
        : state.reasoningText,
    reasoningSummaryText:
      event.type === 'response.reasoning_summary_text.done'
        ? result.reasoningCleared
        : state.reasoningSummaryText,
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
    const result = yield* handleReasoningItem(
      event,
      includeThinkingInResponse,
      state.hasEmittedVisibleThinking,
      emittedThoughts,
    );
    return {
      hasEmittedVisibleThinking: result.hasEmittedVisibleThinking,
      reasoningText: result.reasoningCleared,
      reasoningSummaryText: result.summaryCleared,
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
  const result = yield* handleResponseCompleted(
    event,
    state.reasoningText,
    state.reasoningSummaryText,
    includeThinkingInResponse,
    state.hasEmittedVisibleThinking,
    emittedThoughts,
  );
  return {
    hasEmittedVisibleThinking: result.hasEmittedVisibleThinking,
    reasoningText: result.reasoningCleared,
    reasoningSummaryText: result.summaryCleared,
  };
}

function* dispatchEventCases(
  event: ResponsesEvent,
  reasoningText: string,
  reasoningSummaryText: string,
  functionCalls: Map<string, FunctionCallState>,
  includeThinkingInResponse: boolean,
  hasEmittedVisibleThinking: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
): Generator<IContent, DispatchState> {
  let state: DispatchState = {
    hasEmittedVisibleThinking,
    reasoningText,
    reasoningSummaryText,
  };

  switch (event.type) {
    case 'response.output_text.delta':
      yield* handleTextDelta(event);
      break;
    case 'response.reasoning_text.delta':
    case 'response.reasoning_summary_text.delta':
      state = handleReasoningDeltaEvent(event, state);
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
      state = yield* handleCompletedEvent(
        event,
        state,
        includeThinkingInResponse,
        emittedThoughts,
      );
      break;
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
  reasoningText: string,
  reasoningSummaryText: string,
  functionCalls: Map<string, FunctionCallState>,
  includeThinkingInResponse: boolean,
  hasEmittedVisibleThinking: boolean,
  emittedThoughts: Map<string, { hasEncrypted: boolean }>,
  lastLoggedType: string | undefined,
): Generator<IContent, DispatchResult> {
  const newLastLoggedType = logSseEvent(event, lastLoggedType);

  const result: DispatchState = yield* dispatchEventCases(
    event,
    reasoningText,
    reasoningSummaryText,
    functionCalls,
    includeThinkingInResponse,
    hasEmittedVisibleThinking,
    emittedThoughts,
  );

  return {
    ...result,
    lastLoggedType: newLastLoggedType,
  };
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
  let reasoningText = '';
  let reasoningSummaryText = '';

  // Track emitted thinking content to prevent duplicates (fixes #922).
  const emittedThoughts = new Map<string, { hasEncrypted: boolean }>();

  let hasEmittedVisibleThinking = false;

  let lastLoggedType: string | undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- OpenAI response streams are external provider boundaries despite declared types.
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      // Decode chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      for (const line of lines) {
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (line.startsWith('data: ')) {
          const data = line.substring(6);

          // Skip [DONE] marker
          if (data === '[DONE]') continue;

          try {
            const event: ResponsesEvent = JSON.parse(data);

            const result: DispatchResult = yield* dispatchEvent(
              event,
              reasoningText,
              reasoningSummaryText,
              functionCalls,
              includeThinkingInResponse,
              hasEmittedVisibleThinking,
              emittedThoughts,
              lastLoggedType,
            );
            hasEmittedVisibleThinking = result.hasEmittedVisibleThinking;
            reasoningText = result.reasoningText;
            reasoningSummaryText = result.reasoningSummaryText;
            lastLoggedType = result.lastLoggedType;
          } catch {
            // Skip malformed JSON events
            continue;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseErrorResponse(
  status: number,
  body: string,
  providerName: string,
): Error {
  // Try to parse JSON error response first
  try {
    const errorData = JSON.parse(body);

    // Handle various error response formats
    let message = 'Unknown error';
    if (
      typeof errorData.error?.message === 'string' &&
      errorData.error.message !== ''
    ) {
      message = errorData.error.message;
    } else if (
      typeof errorData.error?.description === 'string' &&
      errorData.error.description !== ''
    ) {
      message = errorData.error.description;
    } else if (
      typeof errorData.message === 'string' &&
      errorData.message !== ''
    ) {
      message = errorData.message;
    } else if (
      typeof errorData.description === 'string' &&
      errorData.description !== ''
    ) {
      message = errorData.description;
    } else if (typeof errorData === 'string' && errorData !== '') {
      message = errorData;
    }

    // Determine the error prefix based on specific status codes
    let errorPrefix = 'API Error';
    switch (status) {
      case 409:
        errorPrefix = 'Conflict';
        break;
      case 410:
        errorPrefix = 'Gone';
        break;
      case 418: {
        // For 418 I'm a teapot, just return the message without prefix
        const teapotError = new Error(message);
        (teapotError as { status?: number }).status = status;
        (teapotError as { code?: string }).code =
          errorData.error?.code ?? errorData.code;
        return teapotError;
      }
      case 429:
        errorPrefix = 'Rate limit exceeded';
        break;
      default:
        if (status >= 400 && status < 500) {
          errorPrefix = 'Client error';
        } else if (status >= 500 && status < 600) {
          errorPrefix = 'Server error';
        }
    }

    const error = new Error(`${errorPrefix}: ${message}`);
    (error as { status?: number }).status = status;
    (error as { code?: string }).code = errorData.error?.code ?? errorData.code;
    return error;
  } catch {
    // For invalid JSON, use a consistent format
    const errorPrefix =
      status >= 500 && status < 600 ? 'Server error' : 'API Error';
    const error = new Error(
      `${errorPrefix}: ${providerName} API error: ${status}`,
    );
    (error as { status?: number }).status = status;
    return error;
  }
}
