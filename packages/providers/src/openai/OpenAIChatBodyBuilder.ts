/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type OpenAI from 'openai';
import { readInvocationPolicyValue } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { OutputLimitConfig } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import {
  getToolIdStrategy,
  type StreamingToolIdMapper,
  type ToolIdStore,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import { removeThinkingFromContent } from '../reasoning/reasoningUtils.js';
import { jsonValueChunks } from '../utils/boundedJsonBody.js';
import { DumpScratch } from '../utils/dumpScratch.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';
import {
  convertBlockToPart,
  processUserMessage,
  processAssistantMessage,
  processToolResponses,
  normalizeToolCallArguments,
  buildToolResponseContent,
  type ReasoningMessageOptions,
} from './OpenAIRequestBuilder.js';

/** Rows of a request, readable twice: once to index them, once to convert. */
export type ChatBodyRows = HistoryDumpSource;

export interface ChatBodyOptions {
  readonly reasoning: ReasoningMessageOptions;
  /** The tool format of the target model; `undefined` means the generic one. */
  readonly toolFormat: ToolFormat | undefined;
  readonly config?: OutputLimitConfig;
  /**
   * Where the Kimi and Mistral id mappers keep their facts. Required for those
   * two formats and ignored for the others. The caller owns the store and
   * whatever backs it.
   */
  readonly toolIdStore?: ToolIdStore;
  /**
   * Rewrites the stream of block-bearing rows during conversion (for example
   * to resolve stored media). It runs once per build, only on the conversion
   * pass, and must yield exactly one row per row it receives.
   */
  readonly mediaStage?: (
    rows: AsyncIterable<IContent>,
  ) => AsyncIterable<IContent>;
}

/**
 * One message of the body. A `tool-media` message is the user message that
 * carries the images and videos a run of tool rows returned; it is the one
 * message whose parts are read from scratch storage instead of held, so its
 * parts are valid only until the next message is requested.
 */
export type ChatMessageItem =
  | {
      readonly kind: 'message';
      readonly message: OpenAI.Chat.ChatCompletionMessageParam;
    }
  | { readonly kind: 'tool-media'; readonly parts: () => Iterable<unknown> };

/**
 * Receives each message as JSON bytes and as the item they were made from.
 * Both are valid only until the call returns; a sink that writes the item in
 * another form (the estimator files) reads it inside the call.
 */
export interface ChatMessageSink {
  message(
    chunks: Iterable<Uint8Array>,
    item: ChatMessageItem,
  ): void | Promise<void>;
}

interface ChatFacts {
  readonly rowCount: number;
  readonly lastThinking: number;
  readonly hasCalls: boolean;
}

interface ConversionSettings {
  readonly stripPolicy: unknown;
  readonly includeInContext: boolean;
  readonly toolFormat: ToolFormat | undefined;
  readonly config: OutputLimitConfig | undefined;
}

function createToolIdMapper(
  options: ChatBodyOptions,
): StreamingToolIdMapper | undefined {
  const format = options.toolFormat;
  if (format !== 'kimi' && format !== 'mistral') return undefined;
  if (options.toolIdStore === undefined)
    throw new Error(`A tool id store is required for the ${format} format`);
  return getToolIdStrategy(format).createStreamingMapper(options.toolIdStore);
}

/**
 * Pass 1: the facts the conversion needs that only the whole history can
 * give. Rows without a block list are not part of the request, so every index
 * here counts block-bearing rows only, as the array route does after its
 * filter. The id mapper learns every call id in row order.
 */
async function observeRows(
  source: ChatBodyRows,
  mapper: StreamingToolIdMapper | undefined,
): Promise<ChatFacts> {
  let rowCount = 0;
  let lastThinking = -1;
  let hasCalls = false;
  for await (const row of source.rows()) {
    if (!Array.isArray(row.blocks)) continue;
    mapper?.observe(row);
    if (row.blocks.some((block) => block.type === 'thinking'))
      lastThinking = rowCount;
    if (
      row.speaker === 'ai' &&
      row.blocks.some((block) => block.type === 'tool_call')
    )
      hasCalls = true;
    rowCount++;
  }
  return { rowCount, lastThinking, hasCalls };
}

async function* blockBearingRows(
  source: ChatBodyRows,
): AsyncGenerator<IContent> {
  for await (const row of source.rows()) {
    if (Array.isArray(row.blocks)) yield row;
  }
}

function readSettings(options: ChatBodyOptions): ConversionSettings {
  const ephemerals = options.reasoning.invocation.ephemerals;
  const stripPolicy: unknown =
    readInvocationPolicyValue(ephemerals, 'reasoning.stripFromContext') ??
    'none';
  const includeInContext = Boolean(
    readInvocationPolicyValue(ephemerals, 'reasoning.includeInContext'),
  );
  return {
    stripPolicy,
    includeInContext,
    toolFormat: options.toolFormat,
    config: options.config,
  };
}

/** `filterThinkingForContext`: any policy but 'none' and 'all' keeps the last. */
function stripsThinking(
  policy: unknown,
  index: number,
  lastThinking: number,
): boolean {
  if (policy === 'none') return false;
  if (policy === 'all') return true;
  return index !== lastThinking;
}

function nextCallIds(
  message: OpenAI.Chat.ChatCompletionMessageParam,
  previous: string[],
): string[] {
  if (message.role === 'assistant')
    return message.tool_calls === undefined
      ? previous
      : message.tool_calls.map((call) => call.id);
  return message.role === 'tool' ? previous : [];
}

function validToolMessage(
  message: OpenAI.Chat.ChatCompletionMessageParam,
  hasCalls: boolean,
  lastCallIds: string[],
): boolean {
  return (
    message.role !== 'tool' ||
    !hasCalls ||
    lastCallIds.includes(message.tool_call_id)
  );
}

function* toolMediaParts(
  images: DumpScratch<MediaBlock>,
  start: number,
  end: number,
): Generator<unknown> {
  let video = false;
  for (let index = start; index < end; index++)
    if (classifyMediaBlock(images.read(index)) === 'video') video = true;
  yield {
    type: 'text',
    text: video ? '[Media from tool response]' : '[Images from tool response]',
  };
  for (let index = start; index < end; index++) {
    const part = convertBlockToPart(images.read(index));
    if (part !== null) yield part;
  }
}

/** Pass 2 state: what the conversion carries from one row to the next. */
class ChatConversion {
  private readonly images = new DumpScratch<MediaBlock>();
  private imageStart = 0;
  private lastCallIds: string[] = [];

  constructor(
    private readonly settings: ConversionSettings,
    private readonly facts: ChatFacts,
    private readonly mapper: StreamingToolIdMapper | undefined,
  ) {}

  close(): void {
    this.images.close();
  }

  *convert(row: IContent, index: number): Generator<ChatMessageItem> {
    if (row.speaker !== 'tool') yield* this.flushToolMedia();
    const converted = stripsThinking(
      this.settings.stripPolicy,
      index,
      this.facts.lastThinking,
    )
      ? removeThinkingFromContent(row)
      : row;
    for (const message of this.messagesOf(converted)) {
      if (!validToolMessage(message, this.facts.hasCalls, this.lastCallIds))
        continue;
      this.lastCallIds = nextCallIds(message, this.lastCallIds);
      yield { kind: 'message', message };
    }
  }

  *flushToolMedia(): Generator<ChatMessageItem> {
    const start = this.imageStart;
    const end = this.images.length;
    if (end <= start) return;
    this.imageStart = end;
    this.lastCallIds = [];
    yield {
      kind: 'tool-media',
      parts: () => toolMediaParts(this.images, start, end),
    };
  }

  private messagesOf(row: IContent): OpenAI.Chat.ChatCompletionMessageParam[] {
    const { includeInContext, toolFormat, config } = this.settings;
    if (row.speaker === 'human') {
      const message = processUserMessage(row);
      return message === null ? [] : [message];
    }
    if (row.speaker === 'ai') {
      const message = processAssistantMessage(
        row,
        includeInContext,
        toolFormat,
        (call) =>
          this.mapper?.resolveToolCallId(call) ??
          normalizeToOpenAIToolId(call.id),
        normalizeToolCallArguments,
      );
      return message === null ? [] : [message];
    }
    const pending: MediaBlock[] = [];
    const messages = processToolResponses(
      row,
      toolFormat ?? 'openai',
      (response) =>
        this.mapper?.resolveToolResponseId(response) ??
        normalizeToOpenAIToolId(response.callId),
      buildToolResponseContent,
      config,
      pending,
    );
    for (const image of pending) this.images.append(image);
    return messages;
  }
}

/**
 * The messages of a chat completions body, one at a time, in the order and
 * with the content `buildMessagesWithReasoning` produces for the same rows.
 * Pass 1 reads every row to learn the thinking position, whether any call
 * exists, and the tool ids; pass 2 reads them again and converts one row, so
 * only that row's messages and the pending tool media on scratch exist at once.
 */
export async function* streamChatMessages(
  source: ChatBodyRows,
  options: ChatBodyOptions,
): AsyncGenerator<ChatMessageItem> {
  const mapper = createToolIdMapper(options);
  const facts = await observeRows(source, mapper);
  const conversion = new ChatConversion(readSettings(options), facts, mapper);
  try {
    const rows = blockBearingRows(source);
    let index = -1;
    for await (const row of options.mediaStage?.(rows) ?? rows) {
      index++;
      yield* conversion.convert(row, index);
    }
    if (index + 1 !== facts.rowCount)
      throw new Error('Chat body rows changed between passes');
    yield* conversion.flushToolMedia();
  } finally {
    conversion.close();
  }
}

const encoder = new TextEncoder();

function literal(text: string): Uint8Array {
  return encoder.encode(text);
}

function valueChunks(value: unknown): Generator<Uint8Array, void, unknown> {
  const chunks = jsonValueChunks(value);
  if (chunks === undefined) throw new Error('Chat body part is not JSON');
  return chunks;
}

function* toolMediaChunks(parts: Iterable<unknown>): Generator<Uint8Array> {
  yield literal('{"role":"user","content":[');
  let first = true;
  for (const part of parts) {
    if (!first) yield literal(',');
    first = false;
    yield* valueChunks(part);
  }
  yield literal(']}');
}

/**
 * Streams the message bytes of the body into `sink`, one call per message.
 * The caller writes the surrounding array punctuation and any message that
 * precedes these (the system message). Returns the number of messages.
 */
export async function writeChatMessages(
  source: ChatBodyRows,
  options: ChatBodyOptions,
  sink: ChatMessageSink,
): Promise<number> {
  let count = 0;
  for await (const item of streamChatMessages(source, options)) {
    await sink.message(
      item.kind === 'message'
        ? valueChunks(item.message)
        : toolMediaChunks(item.parts()),
      item,
    );
    count++;
  }
  return count;
}
