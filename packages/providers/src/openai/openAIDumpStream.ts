/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { OutputLimitConfig } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { streamChatMessages } from './OpenAIChatBodyBuilder.js';
import type { ReasoningMessageOptions } from './OpenAIRequestBuilder.js';

async function* asyncParts(parts: Iterable<unknown>): AsyncGenerator<unknown> {
  yield* parts;
}

/**
 * The chat messages of a history dump: the same conversion as the request
 * body, with the tool-media message's parts left lazy for the pretty printer.
 */
export async function* buildOpenAIDumpStream(
  source: HistoryDumpSource,
  options: ReasoningMessageOptions,
  config?: OutputLimitConfig,
): AsyncIterable<unknown> {
  for await (const item of streamChatMessages(source, {
    reasoning: options,
    toolFormat: 'openai',
    config,
  })) {
    yield item.kind === 'message'
      ? item.message
      : { role: 'user', content: asyncParts(item.parts()) };
  }
}
