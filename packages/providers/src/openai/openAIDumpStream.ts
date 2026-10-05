/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type OpenAI from 'openai';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolOutputSettingsProvider } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { removeThinkingFromContent } from '../reasoning/reasoningUtils.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';
import { DumpScratch } from '../utils/dumpScratch.js';
import {
  convertBlockToPart,
  processUserMessage,
  processAssistantMessage,
  processToolResponses,
  normalizeToolCallArguments,
  buildToolResponseContent,
  type ReasoningMessageOptions,
} from './OpenAIRequestBuilder.js';

async function inspectHistory(
  source: HistoryDumpSource,
): Promise<{ lastThinking: number; hasCalls: boolean }> {
  let index = -1;
  let lastThinking = -1;
  let hasCalls = false;
  for await (const row of source.rows()) {
    index++;
    if (!Array.isArray(row.blocks)) continue;
    if (row.blocks.some((block) => block.type === 'thinking'))
      lastThinking = index;
    if (
      row.speaker === 'ai' &&
      row.blocks.some((block) => block.type === 'tool_call')
    )
      hasCalls = true;
  }
  return { lastThinking, hasCalls };
}
async function* imageParts(
  images: DumpScratch<MediaBlock>,
  start: number,
  end: number,
): AsyncIterable<unknown> {
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
function convertRow(
  row: IContent,
  include: boolean,
  config: ToolOutputSettingsProvider | undefined,
  images: DumpScratch<MediaBlock>,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (row.speaker === 'human') {
    const message = processUserMessage(row);
    return message === null ? [] : [message];
  }
  if (row.speaker === 'ai') {
    const message = processAssistantMessage(
      row,
      include,
      'openai',
      (call) => normalizeToOpenAIToolId(call.id),
      normalizeToolCallArguments,
    );
    return message === null ? [] : [message];
  }
  const pending: MediaBlock[] = [];
  const messages = processToolResponses(
    row,
    'openai',
    (response) => normalizeToOpenAIToolId(response.callId),
    buildToolResponseContent,
    config,
    pending,
  );
  for (const image of pending) images.append(image);
  return messages;
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
export async function* buildOpenAIDumpStream(
  source: HistoryDumpSource,
  options: ReasoningMessageOptions,
  config?: ToolOutputSettingsProvider,
): AsyncIterable<unknown> {
  const policy = options.settings.get('reasoning.stripFromContext') ?? 'none';
  const include = options.settings.get('reasoning.includeInContext') === true;
  const facts = await inspectHistory(source);
  const images = new DumpScratch<MediaBlock>();
  let imageStart = 0;
  let lastCallIds: string[] = [];
  let index = -1;
  try {
    for await (const original of source.rows()) {
      index++;
      if (!Array.isArray(original.blocks)) continue;
      const row =
        policy === 'all' ||
        (policy === 'allButLast' && index !== facts.lastThinking)
          ? removeThinkingFromContent(original)
          : original;
      if (row.speaker !== 'tool' && images.length > imageStart) {
        yield {
          role: 'user',
          content: imageParts(images, imageStart, images.length),
        };
        imageStart = images.length;
        lastCallIds = [];
      }
      const messages = convertRow(row, include, config, images).filter(
        (message) => validToolMessage(message, facts.hasCalls, lastCallIds),
      );
      for (const message of messages) {
        lastCallIds = nextCallIds(message, lastCallIds);
        yield message;
      }
    }
    if (images.length > imageStart)
      yield {
        role: 'user',
        content: imageParts(images, imageStart, images.length),
      };
  } finally {
    images.close();
  }
}
