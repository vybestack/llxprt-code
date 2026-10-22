/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type OpenAI from 'openai';
import type { NativeRowIds } from './native-row-ids.js';
import type { StreamingToolIdMapper } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools';
import { jsonValueChunks } from '../utils/boundedJsonBody.js';
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

export function* nativeChatValue(value: unknown): Generator<Uint8Array> {
  const chunks = jsonValueChunks(value);
  if (chunks === undefined)
    throw new TypeError('Native Chat value is not JSON');
  yield* chunks;
}

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

function* mediaMessage(pending: readonly MediaBlock[]): Generator<Uint8Array> {
  yield Buffer.from(',{"role":"user","content":[');
  yield* nativeChatValue({
    type: 'text',
    text: pending.some((block) => classifyMediaBlock(block) === 'video')
      ? '[Media from tool response]'
      : '[Images from tool response]',
  });
  for (const block of pending) {
    const part = convertBlockToPart(block);
    if (part !== null) {
      yield Buffer.from(',');
      yield* nativeChatValue(part);
    }
  }
  yield Buffer.from(']}');
}

function nextCallIds(
  message: OpenAI.Chat.ChatCompletionMessageParam,
  previous: readonly string[],
): readonly string[] {
  if (message.role === 'assistant')
    return message.tool_calls?.map((call) => call.id) ?? previous;
  return message.role === 'tool' ? previous : [];
}

export async function* nativeChatMessages(
  rows: AsyncIterable<IContent>,
  settings: RowFormatSettings,
  strip: unknown,
  lastThinking: number,
  rowIds?: NativeRowIds,
): AsyncGenerator<Uint8Array> {
  let lastIds: readonly string[] = [];
  let pending: MediaBlock[] = [];
  let index = 0;
  for await (const source of rows) {
    if (pending.length !== 0) {
      if (source.speaker === 'tool')
        throw new JournalFormatError(
          'Native normalized Chat has consecutive tool-media units',
        );
      yield* mediaMessage(pending);
      pending = [];
      lastIds = [];
    }
    const at = index++;
    const remove = strip === 'all' || (strip !== 'none' && at !== lastThinking);
    const row = remove ? removeThinkingFromContent(source) : source;
    const mapper = (await rowIds?.(row, at))?.();
    const messages = messagesOf(row, settings, pending, mapper);
    for (const message of messages) {
      if (
        message === null ||
        (message.role === 'tool' && !lastIds.includes(message.tool_call_id))
      )
        continue;
      lastIds = nextCallIds(message, lastIds);
      yield Buffer.from(',');
      yield* nativeChatValue(message);
    }
  }
  if (pending.length !== 0) yield* mediaMessage(pending);
}
