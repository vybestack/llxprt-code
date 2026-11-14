/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { OutputLimitConfig } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { nativeChatPieces } from './native-chat-messages.js';
import { StreamJsonValue } from '../utils/streamJsonValue.js';

async function chatFacts(
  source: HistoryDumpSource,
): Promise<{ lastThinking: number; hasCalls: boolean }> {
  if (source.rawChatFacts !== undefined) return source.rawChatFacts();
  let lastThinking = -1;
  let hasCalls = false;
  let index = 0;
  for await (const row of source.rows()) {
    if (row.blocks.some((block) => block.type === 'thinking'))
      lastThinking = index;
    hasCalls ||=
      row.speaker === 'ai' &&
      row.blocks.some((block) => block.type === 'tool_call');
    index++;
  }
  return { lastThinking, hasCalls };
}

export function nativeChatDump(
  source: HistoryDumpSource,
  policy: Readonly<Record<string, unknown>> = {},
  config?: OutputLimitConfig,
): StreamJsonValue {
  const settings: RowFormatSettings = {
    formatId: 'openai-chat:plain',
    formatRev: 2,
    model: '',
    endpoint: '',
    isOAuth: false,
    toolNameTransform: 'none',
    supportsUrlImages: true,
    reasoningEnabled: false,
    reasoningFieldName: 'reasoning_content',
    mediaPdfEnabled: false,
    unsupportedMedia: 'notice',
    outputLimits: config ?? null,
    chat: {
      toolFormat: 'openai',
      includeInContext: Boolean(policy['reasoning.includeInContext']),
    },
  };
  return new StreamJsonValue(async function* () {
    const facts = await chatFacts(source);
    yield Buffer.from('[');
    let first = true;
    const readRawRow = source.readRawRow?.bind(source);
    for await (const piece of nativeChatPieces(
      source.rows(),
      settings,
      policy['reasoning.stripFromContext'] ?? 'none',
      facts.lastThinking,
      undefined,
      !facts.hasCalls,
      readRawRow,
    )) {
      const wire = first ? piece.wire.subarray(1) : piece.wire;
      first = false;
      yield wire;
    }
    yield Buffer.from(']');
  });
}
