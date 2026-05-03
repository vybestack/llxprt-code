/**
 * Anthropic Stream Processing Module
 * Processes streaming responses from the Anthropic API
 *
 * @issue #1572 - Decomposing AnthropicProvider (Step 4 - Part B)
 */

import type Anthropic from '@anthropic-ai/sdk';
import type {
  ToolUseBlock,
  TextDelta,
  InputJSONDelta,
} from '@anthropic-ai/sdk/resources/messages/index.js';
import type {
  IContent,
  ThinkingBlock,
} from '../../services/history/IContent.js';
import type { ProviderToolset } from '../IProvider.js';
import { normalizeToHistoryToolId } from '../utils/toolIdNormalization.js';
import {
  processToolParameters,
  logDoubleEscapingInChunk,
} from '../../tools/doubleEscapeUtils.js';
import { coerceParametersToSchema } from '../../utils/parameterCoercion.js';
import { isNetworkTransientError } from '../../utils/retry.js';
import { delay } from '../../utils/delay.js';

export type StreamProcessorOptions = {
  isOAuth: boolean;
  tools: ProviderToolset | undefined;
  unprefixToolName: (name: string, isOAuth: boolean) => string;
  findToolSchema: (
    tools: ProviderToolset | undefined,
    name: string,
    isOAuth: boolean,
  ) => unknown;
  maxAttempts: number;
  initialDelayMs: number;
  apiCallWithResponse: () => Promise<{
    data: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>;
    response?: Response;
  }>;
  logger: { debug: (fn: () => string) => void };
  cacheLogger: { debug: (fn: () => string) => void };
  rateLimitLogger: { debug: (fn: () => string) => void };
};

type StreamState = { hasYieldedContent: boolean };

// Global counter appended to tool call IDs so providers that reset indices per
// API call (e.g. Kimi on Fireworks) never produce duplicates across turns.
let toolCallSequence = 0;

async function* processStreamEvents(
  stream: AsyncIterable<Anthropic.MessageStreamEvent>,
  options: StreamProcessorOptions,
  state: StreamState,
): AsyncGenerator<IContent> {
  const {
    isOAuth,
    tools,
    unprefixToolName,
    findToolSchema,
    logger,
    cacheLogger,
  } = options;

  let currentToolCall: { id: string; name: string; input: string } | undefined;
  let currentThinkingBlock:
    | { thinking: string; signature?: string }
    | undefined;

  for await (const chunk of stream) {
    if (chunk.type === 'message_start') {
      yield* handleMessageStart(chunk, cacheLogger);
    } else if (chunk.type === 'content_block_start') {
      handleContentBlockStart(chunk, logger);
      if (chunk.content_block.type === 'tool_use') {
        const toolBlock = chunk.content_block as ToolUseBlock;
        currentToolCall = {
          id: toolBlock.id,
          name: unprefixToolName(toolBlock.name, isOAuth),
          input: '',
        };
      } else if (chunk.content_block.type === 'thinking') {
        currentThinkingBlock = {
          thinking: '',
          signature: chunk.content_block.signature,
        };
      } else if (chunk.content_block.type === 'redacted_thinking') {
        const redactedBlock = chunk.content_block as {
          type: 'redacted_thinking';
          data: string;
        };
        state.hasYieldedContent = true;
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: '[redacted]',
              sourceField: 'thinking',
              signature: redactedBlock.data,
            } as ThinkingBlock,
          ],
        } as IContent;
      }
    } else if (chunk.type === 'content_block_delta') {
      const deltaResult = handleContentBlockDelta(
        chunk,
        currentToolCall,
        currentThinkingBlock,
        logger,
      );
      if (deltaResult.textDelta) {
        state.hasYieldedContent = true;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: deltaResult.textDelta }],
        } as IContent;
      }
    } else if (chunk.type === 'content_block_stop') {
      const stopResult = handleContentBlockStop(
        chunk,
        currentToolCall,
        currentThinkingBlock,
        tools,
        isOAuth,
        findToolSchema,
        logger,
      );
      if (stopResult.content) {
        state.hasYieldedContent = true;
        yield stopResult.content;
      }
      currentToolCall = stopResult.currentToolCall;
      currentThinkingBlock = stopResult.currentThinkingBlock;
    } else if (chunk.type === 'message_delta') {
      yield* handleMessageDelta(chunk, logger, state);
    }
  }
}

/**
 * Processes an Anthropic streaming response with retry logic for network errors
 * Yields IContent blocks as they arrive from the stream
 */
export async function* processAnthropicStream(
  response: AsyncIterable<Anthropic.MessageStreamEvent>,
  options: StreamProcessorOptions,
): AsyncGenerator<IContent> {
  const { maxAttempts, initialDelayMs, apiCallWithResponse, logger } = options;

  const streamRetryMaxDelayMs = 30000;
  let streamingAttempt = 0;
  let currentDelay = initialDelayMs;
  let currentResponse = response;

  while (streamingAttempt < maxAttempts) {
    streamingAttempt++;

    const state: StreamState = { hasYieldedContent: false };

    try {
      if (streamingAttempt > 1) {
        logger.debug(
          () =>
            `Stream retry attempt ${streamingAttempt}/${maxAttempts}: Making fresh API call`,
        );
        const retryResult = await apiCallWithResponse();
        currentResponse =
          retryResult.data as AsyncIterable<Anthropic.MessageStreamEvent>;
      }

      const stream =
        currentResponse as unknown as AsyncIterable<Anthropic.MessageStreamEvent>;

      logger.debug(() => 'Processing streaming response');
      yield* processStreamEvents(stream, options, state);
      return;
    } catch (error) {
      const canRetryStream = isNetworkTransientError(error);
      logger.debug(
        () =>
          `Stream attempt ${streamingAttempt}/${maxAttempts} error: ${error}`,
      );

      if (state.hasYieldedContent) {
        logger.debug(
          () =>
            `Stream error after content was already yielded to consumer, cannot safely retry: ${error}`,
        );
        throw error;
      }

      if (!canRetryStream || streamingAttempt >= maxAttempts) {
        logger.debug(
          () =>
            `Stream error not retryable or max attempts reached, throwing: ${error}`,
        );
        throw error;
      }

      const jitter = currentDelay * 0.3 * (Math.random() * 2 - 1);
      const delayWithJitter = Math.max(0, currentDelay + jitter);
      logger.debug(
        () =>
          `Stream retry attempt ${streamingAttempt}/${maxAttempts}: Transient error detected, waiting ${Math.round(delayWithJitter)}ms before retry`,
      );
      await delay(delayWithJitter);
      currentDelay = Math.min(streamRetryMaxDelayMs, currentDelay * 2);
    }
  }
}

function* handleMessageStart(
  chunk: Anthropic.MessageStreamEvent,
  cacheLogger: { debug: (fn: () => string) => void },
): Generator<IContent> {
  const usage = (
    chunk as unknown as {
      message?: {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
    }
  ).message?.usage;

  if (usage) {
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheCreation = usage.cache_creation_input_tokens ?? 0;

    cacheLogger.debug(
      () =>
        `[AnthropicProvider streaming] Emitting usage metadata: cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, raw values: cache_read_input_tokens=${usage.cache_read_input_tokens}, cache_creation_input_tokens=${usage.cache_creation_input_tokens}`,
    );

    if (cacheRead > 0 || cacheCreation > 0) {
      cacheLogger.debug(() => {
        const hitRate =
          cacheRead + (usage.input_tokens ?? 0) > 0
            ? (cacheRead / (cacheRead + (usage.input_tokens ?? 0))) * 100
            : 0;
        return `Cache metrics: read=${cacheRead}, creation=${cacheCreation}, hit_rate=${hitRate.toFixed(1)}%`;
      });
    }

    yield {
      speaker: 'ai',
      blocks: [],
      metadata: {
        usage: {
          promptTokens: usage.input_tokens ?? 0,
          completionTokens: usage.output_tokens ?? 0,
          totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: cacheCreation,
        },
      },
    } as IContent;
  }
}

function handleContentBlockStart(
  chunk: Anthropic.MessageStreamEvent & { type: 'content_block_start' },
  logger: { debug: (fn: () => string) => void },
): void {
  if (chunk.content_block.type === 'tool_use') {
    const toolBlock = chunk.content_block as ToolUseBlock;
    logger.debug(() => `Starting tool use: ${toolBlock.name}`);
  } else if (chunk.content_block.type === 'thinking') {
    logger.debug(() => 'Starting thinking block');
  } else if (chunk.content_block.type === 'redacted_thinking') {
    logger.debug(() => 'Starting redacted thinking block');
  }
}

function handleContentBlockDelta(
  chunk: Anthropic.MessageStreamEvent & { type: 'content_block_delta' },
  currentToolCall: { id: string; name: string; input: string } | undefined,
  currentThinkingBlock: { thinking: string; signature?: string } | undefined,
  logger: { debug: (fn: () => string) => void },
): { textDelta?: string } {
  if (chunk.delta.type === 'text_delta') {
    const textDelta = chunk.delta as TextDelta;
    logger.debug(() => `Received text delta: ${textDelta.text.length} chars`);
    return { textDelta: textDelta.text };
  } else if (chunk.delta.type === 'input_json_delta' && currentToolCall) {
    const jsonDelta = chunk.delta as InputJSONDelta;
    currentToolCall.input += jsonDelta.partial_json;

    logDoubleEscapingInChunk(
      jsonDelta.partial_json,
      currentToolCall.name,
      'anthropic',
    );
  } else if (chunk.delta.type === 'thinking_delta' && currentThinkingBlock) {
    const thinkingDelta = chunk.delta as {
      type: 'thinking_delta';
      thinking: string;
    };
    currentThinkingBlock.thinking += thinkingDelta.thinking;
    logger.debug(
      () => `Thinking delta chunk (${thinkingDelta.thinking.length} chars)`,
    );
  } else if (chunk.delta.type === 'signature_delta' && currentThinkingBlock) {
    const signatureDelta = chunk.delta as {
      type: 'signature_delta';
      signature: string;
    };
    logger.debug(
      () =>
        `Received signature_delta (${signatureDelta.signature.length} chars)`,
    );
    currentThinkingBlock.signature = signatureDelta.signature;
  }

  return {};
}

function completeToolCall(
  currentToolCall: { id: string; name: string; input: string },
  tools: ProviderToolset | undefined,
  isOAuth: boolean,
  findToolSchema: (
    tools: ProviderToolset | undefined,
    name: string,
    isOAuth: boolean,
  ) => unknown,
  logger: { debug: (fn: () => string) => void },
): IContent {
  logger.debug(() => `Completed tool use: ${currentToolCall.name}`);

  let processedParameters = processToolParameters(
    currentToolCall.input,
    currentToolCall.name,
    'anthropic',
  );

  const toolSchema = findToolSchema(tools, currentToolCall.name, isOAuth);
  if (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    toolSchema !== undefined &&
    toolSchema !== null &&
    processedParameters !== undefined &&
    processedParameters !== null &&
    typeof processedParameters === 'object' &&
    typeof toolSchema === 'object'
  ) {
    processedParameters = coerceParametersToSchema(
      processedParameters,
      toolSchema as Record<string, unknown>,
    );
  }

  return {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: normalizeToHistoryToolId(
          `${currentToolCall.id}_seq${toolCallSequence++}`,
        ),
        name: currentToolCall.name,
        parameters: processedParameters,
      },
    ],
  } as IContent;
}

function completeThinkingBlock(
  currentThinkingBlock: { thinking: string; signature?: string },
  chunk: Anthropic.MessageStreamEvent & { type: 'content_block_stop' },
  logger: { debug: (fn: () => string) => void },
): IContent {
  logger.debug(
    () =>
      `Completed thinking block: ${currentThinkingBlock.thinking.length} chars`,
  );

  const contentBlock = (
    chunk as unknown as {
      content_block?: {
        type: string;
        thinking?: string;
        signature?: string;
      };
    }
  ).content_block;
  if (contentBlock?.signature) {
    currentThinkingBlock.signature = contentBlock.signature;
  }

  return {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: currentThinkingBlock.thinking,
        sourceField: 'thinking',
        signature: currentThinkingBlock.signature,
      } as ThinkingBlock,
    ],
  } as IContent;
}

function handleContentBlockStop(
  chunk: Anthropic.MessageStreamEvent & { type: 'content_block_stop' },
  currentToolCall: { id: string; name: string; input: string } | undefined,
  currentThinkingBlock: { thinking: string; signature?: string } | undefined,
  tools: ProviderToolset | undefined,
  isOAuth: boolean,
  findToolSchema: (
    tools: ProviderToolset | undefined,
    name: string,
    isOAuth: boolean,
  ) => unknown,
  logger: { debug: (fn: () => string) => void },
): {
  content?: IContent;
  currentToolCall?: { id: string; name: string; input: string };
  currentThinkingBlock?: { thinking: string; signature?: string };
} {
  if (currentToolCall) {
    return {
      content: completeToolCall(
        currentToolCall,
        tools,
        isOAuth,
        findToolSchema,
        logger,
      ),
      currentToolCall: undefined,
      currentThinkingBlock,
    };
  } else if (currentThinkingBlock) {
    return {
      content: completeThinkingBlock(currentThinkingBlock, chunk, logger),
      currentToolCall,
      currentThinkingBlock: undefined,
    };
  }

  return { currentToolCall, currentThinkingBlock };
}

function* handleMessageDelta(
  chunk: Anthropic.MessageStreamEvent & { type: 'message_delta' },
  logger: { debug: (fn: () => string) => void },
  state: StreamState,
): Generator<IContent> {
  const usage = chunk.usage as
    | {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      }
    | undefined;

  const stopReason = (chunk as unknown as { delta?: { stop_reason?: string } })
    .delta?.stop_reason;

  if (!usage) {
    logger.debug(
      () =>
        `Received message_delta without usage metadata; stopReason=${String(stopReason)}`,
    );

    if (stopReason) {
      state.hasYieldedContent = true;
      yield {
        speaker: 'ai',
        blocks: [],
        metadata: {
          stopReason,
        },
      } as IContent;
    }

    return;
  }

  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;

  const rawInputTokens = usage.input_tokens as number | null | undefined;
  const rawOutputTokens = usage.output_tokens as number | null | undefined;
  const promptTokens =
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    rawInputTokens !== undefined &&
    rawInputTokens !== null &&
    rawInputTokens !== 0 &&
    !Number.isNaN(rawInputTokens)
      ? rawInputTokens
      : 0;
  const completionTokens =
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    rawOutputTokens !== undefined &&
    rawOutputTokens !== null &&
    rawOutputTokens !== 0 &&
    !Number.isNaN(rawOutputTokens)
      ? rawOutputTokens
      : 0;

  logger.debug(
    () =>
      `Received usage metadata from message_delta: promptTokens=${promptTokens}, completionTokens=${completionTokens}, cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, stopReason=${String(stopReason)}`,
  );

  yield {
    speaker: 'ai',
    blocks: [],
    metadata: {
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreation,
      },
      stopReason,
    },
  } as IContent;
}
