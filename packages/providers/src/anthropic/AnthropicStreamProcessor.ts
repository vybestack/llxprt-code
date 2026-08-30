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
import { randomUUID } from 'node:crypto';
import type {
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderToolset } from '../IProvider.js';
import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import {
  processToolParameters,
  logDoubleEscapingInChunk,
} from '@vybestack/llxprt-code-tools/doubleEscapeUtils.js';
import { coerceParametersToSchema } from '@vybestack/llxprt-code-core/utils/parameterCoercion.js';
import {
  assertProviderStreamByteLimit,
  MAX_PROVIDER_TOOL_CALL_BYTES,
  utf8ByteLength,
} from '../streamLimits.js';
import {
  MalformedStreamEventError,
  StreamTruncatedError,
} from '../streamProtocolErrors.js';
import type { RequestCommitState } from '../retryRequestContext.js';

export type StreamProcessorOptions = {
  isOAuth: boolean;
  tools: ProviderToolset | undefined;
  unprefixToolName: (name: string, isOAuth: boolean) => string;
  findToolSchema: (
    tools: ProviderToolset | undefined,
    name: string,
    isOAuth: boolean,
  ) => unknown;
  logger: { debug: (fn: () => string) => void };
  cacheLogger: { debug: (fn: () => string) => void };
  rateLimitLogger: { debug: (fn: () => string) => void };
  includeThinkingInResponse: boolean;
  /**
   * Shared per-request commit state (issue #2532). The processor records the
   * protocol terminal event on it; it never marks commitment — that belongs
   * to the guarded stream that yields outward.
   */
  commitState?: RequestCommitState;
};

type CurrentThinkingBlock = {
  thinking: string;
  signature?: string;
  streamId: string;
};

type CurrentToolCall = {
  id: string;
  name: string;
  input: string;
  inputBytes: number;
};

type ThinkingBlockIdentity = {
  nextStreamId: (sourceIndex: number) => string;
};

/**
 * Creates a scoped thinking-block identity for a single Anthropic streaming
 * response (one API call).
 *
 * The epoch is process-unique (generated fresh per call) so the stream ids
 * produced here can never collide with ids from another API call in the same
 * turn, nor with ids replayed from a resumed session's persisted history
 * (legacy records literally contain `anthropic-thinking:0:block-0`). A bare
 * counter from 0 would repeat those exact ids and let a later model iteration
 * silently overwrite an earlier iteration's reasoning in the transcript
 * (issue #3128).
 *
 * Within one call the lifecycle counter still differentiates distinct thinking
 * blocks, and every delta plus the final complete emission for a single block
 * share that block's id (the replace-by-id semantic the consumer relies on).
 */
function createThinkingBlockIdentity(): ThinkingBlockIdentity {
  const epoch = randomUUID();
  let nextLifecycleId = 0;
  return {
    nextStreamId: (sourceIndex: number): string =>
      `anthropic-thinking:${epoch}:${sourceIndex}:block-${nextLifecycleId++}`,
  };
}

// Global counter appended to tool call IDs so providers that reset indices per
// API call (e.g. Kimi on Fireworks) never produce duplicates across turns.
let toolCallSequence = 0;

function buildTextDeltaContent(textDelta: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: textDelta }],
  };
}

function buildThinkingContent(params: {
  thinking: string;
  signature?: string;
  streamId: string;
  streamStatus: 'delta' | 'complete';
  isHidden: boolean;
}): IContent | undefined {
  if (!params.thinking && params.signature === undefined) {
    return undefined;
  }
  return {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: params.thinking,
        sourceField: 'thinking',
        streamId: params.streamId,
        streamStatus: params.streamStatus,
        ...(params.signature !== undefined
          ? { signature: params.signature }
          : {}),
        ...(params.isHidden ? { isHidden: true } : {}),
      },
    ],
  };
}

interface StreamAssemblyState {
  currentToolCall: CurrentToolCall | undefined;
  currentThinkingBlock: CurrentThinkingBlock | undefined;
  terminalSeen: boolean;
  thinkingBlockIdentity: ThinkingBlockIdentity;
}

async function* processStreamEvents(
  stream: AsyncIterable<Anthropic.MessageStreamEvent>,
  options: StreamProcessorOptions,
): AsyncGenerator<IContent> {
  const state: StreamAssemblyState = {
    currentToolCall: undefined,
    currentThinkingBlock: undefined,
    terminalSeen: false,
    thinkingBlockIdentity: createThinkingBlockIdentity(),
  };

  for await (const chunk of stream) {
    yield* applyStreamEvent(chunk, state, options);
  }

  if (!state.terminalSeen) {
    throw new StreamTruncatedError(
      'Anthropic stream ended without message_stop',
    );
  }
}

function* applyStreamEvent(
  chunk: Anthropic.MessageStreamEvent,
  state: StreamAssemblyState,
  options: StreamProcessorOptions,
): Generator<IContent> {
  switch (chunk.type) {
    case 'message_stop': {
      state.terminalSeen = true;
      options.commitState?.markTerminalSeen();
      return;
    }
    case 'message_start': {
      yield* handleMessageStart(chunk, options.cacheLogger);
      return;
    }
    case 'content_block_start': {
      yield* applyContentBlockStart(chunk, state, options);
      return;
    }
    case 'content_block_delta': {
      yield* applyContentBlockDelta(chunk, state, options);
      return;
    }
    case 'content_block_stop': {
      yield* applyContentBlockStop(chunk, state, options);
      return;
    }
    case 'message_delta': {
      // A final stop_reason is a terminal signal: gateways that omit
      // message_stop still end their streams with stop_reason set, and
      // truncation detection must treat that as a completed message.
      if (readMessageDeltaStopReason(chunk) != null) {
        state.terminalSeen = true;
        options.commitState?.markTerminalSeen();
      }
      yield* handleMessageDelta(chunk, options.logger);
      return;
    }
    default:
      // Unknown event types (e.g. ping) carry no assembly state.
      return;
  }
}

function* applyContentBlockStart(
  chunk: Extract<Anthropic.MessageStreamEvent, { type: 'content_block_start' }>,
  state: StreamAssemblyState,
  options: StreamProcessorOptions,
): Generator<IContent> {
  const blockResult = handleContentBlockStartStateful(
    chunk,
    options.isOAuth,
    options.unprefixToolName,
    state.thinkingBlockIdentity,
    options.logger,
    options.includeThinkingInResponse,
  );
  if (blockResult.currentToolCall !== undefined) {
    state.currentToolCall = blockResult.currentToolCall;
  }
  if (blockResult.currentThinkingBlock !== undefined) {
    state.currentThinkingBlock = blockResult.currentThinkingBlock;
  }
  if (blockResult.content) {
    yield blockResult.content;
  }
}

function* applyContentBlockDelta(
  chunk: Extract<Anthropic.MessageStreamEvent, { type: 'content_block_delta' }>,
  state: StreamAssemblyState,
  options: StreamProcessorOptions,
): Generator<IContent> {
  if (
    chunk.delta.type === 'input_json_delta' &&
    state.currentToolCall === undefined
  ) {
    throw new MalformedStreamEventError(
      'input_json_delta received with no open tool_use block',
    );
  }
  const deltaContent = handleContentBlockDelta(
    chunk,
    state.currentToolCall,
    state.currentThinkingBlock,
    options.includeThinkingInResponse,
    options.logger,
  );
  if (deltaContent !== undefined) {
    yield deltaContent;
  }
}

function* applyContentBlockStop(
  chunk: Extract<Anthropic.MessageStreamEvent, { type: 'content_block_stop' }>,
  state: StreamAssemblyState,
  options: StreamProcessorOptions,
): Generator<IContent> {
  const stopResult = handleContentBlockStop(
    chunk,
    state.currentToolCall,
    state.currentThinkingBlock,
    options.tools,
    options.isOAuth,
    options.findToolSchema,
    options.includeThinkingInResponse,
    options.logger,
  );
  if (stopResult.content) {
    yield stopResult.content;
  }
  state.currentToolCall = stopResult.currentToolCall;
  state.currentThinkingBlock = stopResult.currentThinkingBlock;
}

/**
 * Processes one Anthropic streaming response. Retry ownership belongs to the
 * central RetryOrchestrator so every API request consumes the same budget.
 */
export async function* processAnthropicStream(
  response: AsyncIterable<Anthropic.MessageStreamEvent>,
  options: StreamProcessorOptions,
): AsyncGenerator<IContent> {
  options.logger.debug(() => 'Processing streaming response');
  yield* processStreamEvents(response, options);
}

function* handleMessageStart(
  chunk: Anthropic.MessageStreamEvent & { type: 'message_start' },
  cacheLogger: { debug: (fn: () => string) => void },
): Generator<IContent> {
  const usage = chunk.message.usage;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;

  cacheLogger.debug(
    () =>
      `[AnthropicProvider streaming] Emitting usage metadata: cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, raw values: cache_read_input_tokens=${usage.cache_read_input_tokens}, cache_creation_input_tokens=${usage.cache_creation_input_tokens}`,
  );

  if (cacheRead > 0 || cacheCreation > 0) {
    cacheLogger.debug(() => {
      const hitRate =
        cacheRead + usage.input_tokens > 0
          ? (cacheRead / (cacheRead + usage.input_tokens)) * 100
          : 0;
      return `Cache metrics: read=${cacheRead}, creation=${cacheCreation}, hit_rate=${hitRate.toFixed(1)}%`;
    });
  }

  yield {
    speaker: 'ai',
    blocks: [],
    metadata: {
      usage: {
        promptTokens: usage.input_tokens + cacheRead + cacheCreation,
        completionTokens: usage.output_tokens,
        totalTokens:
          usage.input_tokens + usage.output_tokens + cacheRead + cacheCreation,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreation,
      },
    },
  } as IContent;
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

function handleContentBlockStartStateful(
  chunk: Anthropic.MessageStreamEvent & { type: 'content_block_start' },
  isOAuth: boolean,
  unprefixToolName: (name: string, isOAuth: boolean) => string,
  thinkingBlockIdentity: ThinkingBlockIdentity,
  logger: { debug: (fn: () => string) => void },
  includeThinkingInResponse: boolean,
): {
  currentToolCall?: CurrentToolCall;
  currentThinkingBlock?: CurrentThinkingBlock;
  content?: IContent;
} {
  handleContentBlockStart(chunk, logger);
  if (chunk.content_block.type === 'tool_use') {
    const toolBlock = chunk.content_block as ToolUseBlock;
    return {
      currentToolCall: {
        id: toolBlock.id,
        name: unprefixToolName(toolBlock.name, isOAuth),
        input: '',
        inputBytes: 0,
      },
    };
  }
  if (chunk.content_block.type === 'thinking') {
    return {
      currentThinkingBlock: {
        thinking: '',
        signature: chunk.content_block.signature,
        streamId: thinkingBlockIdentity.nextStreamId(chunk.index),
      },
    };
  }
  if (chunk.content_block.type === 'redacted_thinking') {
    const redactedBlock = chunk.content_block as {
      type: 'redacted_thinking';
      data: string;
    };
    return {
      content: {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: '[redacted]',
            sourceField: 'thinking',
            signature: redactedBlock.data,
            streamId: thinkingBlockIdentity.nextStreamId(chunk.index),
            streamStatus: 'complete',
            ...(!includeThinkingInResponse ? { isHidden: true } : {}),
          } as ThinkingBlock,
        ],
      } as IContent,
    };
  }
  return {};
}

function handleContentBlockDelta(
  chunk: Anthropic.MessageStreamEvent & { type: 'content_block_delta' },
  currentToolCall: CurrentToolCall | undefined,
  currentThinkingBlock: CurrentThinkingBlock | undefined,
  includeThinkingInResponse: boolean,
  logger: { debug: (fn: () => string) => void },
): IContent | undefined {
  if (chunk.delta.type === 'text_delta') {
    const textDelta = chunk.delta as TextDelta;
    logger.debug(() => `Received text delta: ${textDelta.text.length} chars`);
    return textDelta.text ? buildTextDeltaContent(textDelta.text) : undefined;
  } else if (chunk.delta.type === 'input_json_delta' && currentToolCall) {
    const jsonDelta = chunk.delta as InputJSONDelta;
    currentToolCall.inputBytes += utf8ByteLength(jsonDelta.partial_json);
    assertProviderStreamByteLimit(
      'tool-call arguments',
      currentToolCall.inputBytes,
      MAX_PROVIDER_TOOL_CALL_BYTES,
    );
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
    if (thinkingDelta.thinking) {
      return buildThinkingContent({
        thinking: currentThinkingBlock.thinking,
        streamId: currentThinkingBlock.streamId,
        streamStatus: 'delta',
        isHidden: !includeThinkingInResponse,
      });
    }
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

  return undefined;
}

function isNonArrayRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canCoerceParameters(
  toolSchema: unknown,
  params: unknown,
): toolSchema is Record<string, unknown> {
  return isNonArrayRecord(params) && isNonArrayRecord(toolSchema);
}

function sanitizeTokenCount(value: number | null | undefined): number {
  if (value === undefined || value === null || value === 0) return 0;
  return Number.isNaN(value) ? 0 : value;
}

function completeToolCall(
  currentToolCall: CurrentToolCall,
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
  if (canCoerceParameters(toolSchema, processedParameters)) {
    processedParameters = coerceParametersToSchema(
      processedParameters,
      toolSchema,
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

interface StopEventContentBlock {
  type?: string;
  thinking?: string;
  signature?: string;
}

function readStopEventContentBlock(
  chunk: unknown,
): StopEventContentBlock | undefined {
  if (typeof chunk === 'object' && chunk !== null && 'content_block' in chunk) {
    const cb = (chunk as { content_block?: unknown }).content_block;
    if (typeof cb === 'object' && cb !== null) {
      return cb as StopEventContentBlock;
    }
  }
  return undefined;
}

function completeThinkingBlock(
  currentThinkingBlock: CurrentThinkingBlock,
  chunk: Anthropic.MessageStreamEvent & { type: 'content_block_stop' },
  includeThinkingInResponse: boolean,
  logger: { debug: (fn: () => string) => void },
): IContent | undefined {
  logger.debug(
    () =>
      `Completed thinking block: ${currentThinkingBlock.thinking.length} chars`,
  );

  const contentBlock = readStopEventContentBlock(chunk);
  if (contentBlock?.signature) {
    currentThinkingBlock.signature = contentBlock.signature;
  }

  return buildThinkingContent({
    thinking: currentThinkingBlock.thinking,
    signature: currentThinkingBlock.signature,
    streamId: currentThinkingBlock.streamId,
    streamStatus: 'complete',
    isHidden: !includeThinkingInResponse,
  });
}

function handleContentBlockStop(
  chunk: Anthropic.MessageStreamEvent & { type: 'content_block_stop' },
  currentToolCall: CurrentToolCall | undefined,
  currentThinkingBlock: CurrentThinkingBlock | undefined,
  tools: ProviderToolset | undefined,
  isOAuth: boolean,
  findToolSchema: (
    tools: ProviderToolset | undefined,
    name: string,
    isOAuth: boolean,
  ) => unknown,
  includeThinkingInResponse: boolean,
  logger: { debug: (fn: () => string) => void },
): {
  content?: IContent;
  currentToolCall?: CurrentToolCall;
  currentThinkingBlock?: CurrentThinkingBlock;
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
      content: completeThinkingBlock(
        currentThinkingBlock,
        chunk,
        includeThinkingInResponse,
        logger,
      ),
      currentToolCall,
      currentThinkingBlock: undefined,
    };
  }

  return { currentToolCall, currentThinkingBlock };
}

/**
 * Reads stop_reason from a message_delta event defensively.
 * The SDK type declares delta as required, but some test/runtime
 * streams may omit it. Treating the field as possibly-absent runtime
 * data avoids a crash while preserving the original optional-chaining
 * semantics.
 */
function readMessageDeltaStopReason(
  chunk: Anthropic.MessageStreamEvent & { type: 'message_delta' },
): string | null | undefined {
  const delta = (chunk as { delta?: { stop_reason?: string | null } }).delta;
  return delta?.stop_reason;
}

function* handleMessageDelta(
  chunk: Anthropic.MessageStreamEvent & { type: 'message_delta' },
  logger: { debug: (fn: () => string) => void },
): Generator<IContent> {
  const usage = chunk.usage as
    | {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      }
    | undefined;

  const stopReason = readMessageDeltaStopReason(chunk);

  if (!usage) {
    logger.debug(
      () =>
        `Received message_delta without usage metadata; stopReason=${String(stopReason)}`,
    );

    if (stopReason) {
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
  const basePromptTokens = sanitizeTokenCount(rawInputTokens);
  const completionTokens = sanitizeTokenCount(rawOutputTokens);
  const promptTokens = basePromptTokens + cacheRead + cacheCreation;

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
