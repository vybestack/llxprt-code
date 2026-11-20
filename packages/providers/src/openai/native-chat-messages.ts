/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type OpenAI from 'openai';
import type { NativeRowIds } from './native-row-ids.js';
import type { StreamingToolIdMapper } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools';
import {
  nativeDumpLiteral,
  nativeDumpValue,
  type NativeDumpPiece,
} from '../utils/native-dump-body.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';
import { removeThinkingFromContent } from '../reasoning/reasoningUtils.js';
import {
  processUserMessage,
  processAssistantMessage,
  normalizeToolCallArguments,
  processToolResponses,
  buildToolResponseContent,
  convertBlockToPart,
} from './OpenAIRequestBuilder.js';

function messagesOf(
  row: IContent,
  settings: RowFormatSettings,
  pending: MediaBlock[],
  mapper?: StreamingToolIdMapper,
): Array<OpenAI.Chat.ChatCompletionMessageParam | null> {
  if (row.speaker === 'human') return [processUserMessage(row)];
  if (row.speaker === 'ai')
    return [
      processAssistantMessage(
        row,
        settings.chat?.includeInContext ?? true,
        settings.chat?.toolFormat,
        mapper?.resolveToolCallId ??
          ((call) => normalizeToOpenAIToolId(call.id)),
        normalizeToolCallArguments,
      ),
    ];
  return processToolResponses(
    row,
    settings.chat?.toolFormat ?? 'openai',
    mapper?.resolveToolResponseId ??
      ((response) => normalizeToOpenAIToolId(response.callId)),
    buildToolResponseContent,
    settings.outputLimits ?? undefined,
    pending,
  );
}

function* mediaMessage(
  pending: readonly MediaBlock[],
  serialize: typeof nativeDumpValue,
): Generator<NativeDumpPiece> {
  yield nativeDumpLiteral(',{"role":"user","content":[');
  yield* serialize({
    type: 'text',
    text: pending.some((block) => classifyMediaBlock(block) === 'video')
      ? '[Media from tool response]'
      : '[Images from tool response]',
  });
  for (const block of pending) {
    const part = convertBlockToPart(block);
    if (part !== null) {
      yield nativeDumpLiteral(',');
      yield* serialize(part);
    }
  }
  yield nativeDumpLiteral(']}');
}

async function* indexedMediaMessage(
  readAt: (index: number) => Promise<IContent>,
  from: number,
  to: number,
  video: boolean,
  serialize: typeof nativeDumpValue,
): AsyncGenerator<NativeDumpPiece> {
  yield nativeDumpLiteral(',{"role":"user","content":[');
  yield* serialize({
    type: 'text',
    text: video ? '[Media from tool response]' : '[Images from tool response]',
  });
  for (let index = from; index <= to; index++) {
    const row = await readAt(index);
    const media: MediaBlock[] = [];
    processToolResponses(
      row,
      'openai',
      (response) => response.callId,
      buildToolResponseContent,
      undefined,
      media,
    );
    for (const block of media) {
      const part = convertBlockToPart(block);
      if (part === null) continue;
      yield nativeDumpLiteral(',');
      yield* serialize(part);
    }
  }
  yield nativeDumpLiteral(']}');
}

function nextCallIds(
  message: OpenAI.Chat.ChatCompletionMessageParam,
  previous: readonly string[],
): readonly string[] {
  if (message.role === 'assistant')
    return message.tool_calls?.map((call) => call.id) ?? previous;
  return message.role === 'tool' ? previous : [];
}

function keepsMessage(
  message: OpenAI.Chat.ChatCompletionMessageParam | null,
  allowOrphans: boolean,
  lastIds: readonly string[],
): message is OpenAI.Chat.ChatCompletionMessageParam {
  return (
    message !== null &&
    (message.role !== 'tool' ||
      allowOrphans ||
      lastIds.includes(message.tool_call_id))
  );
}

interface ChatRowMessages {
  readonly speaker: IContent['speaker'];
  readonly messages: Array<OpenAI.Chat.ChatCompletionMessageParam | null>;
  readonly media: MediaBlock[];
}

function nextChatRowMessages(
  iterator: AsyncIterator<IContent>,
  at: number,
  settings: RowFormatSettings,
  strip: unknown,
  lastThinking: number,
  rowIds: NativeRowIds | undefined,
): Promise<ChatRowMessages | undefined> {
  return iterator.next().then((next) => {
    if (next.done === true) return undefined;
    const remove = strip === 'all' || (strip !== 'none' && at !== lastThinking);
    const row = remove ? removeThinkingFromContent(next.value) : next.value;
    const convert = (mapper?: StreamingToolIdMapper): ChatRowMessages => {
      const media: MediaBlock[] = [];
      return {
        speaker: row.speaker,
        messages: messagesOf(row, settings, media, mapper),
        media,
      };
    };
    const mapping = rowIds?.(row, at);
    return mapping === undefined
      ? convert()
      : mapping.then((createMapper) => convert(createMapper()));
  });
}

async function* chatRowMessages(
  rows: AsyncIterable<IContent>,
  settings: RowFormatSettings,
  strip: unknown,
  lastThinking: number,
  rowIds: NativeRowIds | undefined,
): AsyncGenerator<ChatRowMessages> {
  const iterator = rows[Symbol.asyncIterator]();
  try {
    for (let at = 0; ; at++) {
      const item = await nextChatRowMessages(
        iterator,
        at,
        settings,
        strip,
        lastThinking,
        rowIds,
      );
      if (item === undefined) return;
      yield item;
    }
  } finally {
    await iterator.return?.();
  }
}

export async function* nativeChatPieces(
  rows: AsyncIterable<IContent>,
  settings: RowFormatSettings,
  strip: unknown,
  lastThinking: number,
  rowIds?: NativeRowIds,
  allowOrphans = settings.chat?.allowOrphans === true,
  mediaAt?: (index: number) => Promise<IContent>,
  serialize: typeof nativeDumpValue = nativeDumpValue,
): AsyncGenerator<NativeDumpPiece> {
  let lastIds: readonly string[] = [];
  let pending: MediaBlock[] = [];
  let mediaStart = -1;
  let mediaEnd = -1;
  let video = false;
  let index = 0;
  for await (const item of chatRowMessages(
    rows,
    settings,
    strip,
    lastThinking,
    rowIds,
  )) {
    if ((pending.length !== 0 || mediaStart >= 0) && item.speaker !== 'tool') {
      if (mediaAt === undefined) yield* mediaMessage(pending, serialize);
      else
        yield* indexedMediaMessage(
          mediaAt,
          mediaStart,
          mediaEnd,
          video,
          serialize,
        );
      pending = [];
      mediaStart = -1;
      video = false;
      lastIds = [];
    }
    const at = index++;
    pending.push(...item.media);
    const messages = item.messages;
    if (mediaAt !== undefined && pending.length !== 0) {
      if (mediaStart < 0) mediaStart = at;
      mediaEnd = at;
      video ||= pending.some((block) => classifyMediaBlock(block) === 'video');
      pending = [];
    }
    for (const message of messages) {
      if (!keepsMessage(message, allowOrphans, lastIds)) continue;
      lastIds = nextCallIds(message, lastIds);
      yield nativeDumpLiteral(',');
      yield* serialize(message);
    }
  }
  if (mediaAt !== undefined && mediaStart >= 0)
    yield* indexedMediaMessage(mediaAt, mediaStart, mediaEnd, video, serialize);
  else if (pending.length !== 0) yield* mediaMessage(pending, serialize);
}

export async function* nativeChatMessages(
  ...args: Parameters<typeof nativeChatPieces>
): AsyncGenerator<Uint8Array> {
  for await (const piece of nativeChatPieces(...args)) yield piece.wire;
}
