/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AnthropicConversationConversionOptions as AnthropicMessageConversionOptions } from './AnthropicMessageNormalizer.js';
import type { AnthropicMessageBlock } from './AnthropicMessageNormalizer.js';
import { AnthropicDumpTable, type DumpMessage } from './anthropicDumpTable.js';
import { buildAnthropicRawTable } from './anthropicDumpRaw.js';
import {
  filterDumpOrphans,
  repairDumpAdjacency,
  mergeDumpRoles,
} from './anthropicDumpValidation.js';
import { modelSupportsPrefill } from './AnthropicModelData.js';
import { dumpBlockValue } from './anthropicDumpBlockValue.js';

function important(
  block: AnthropicMessageBlock,
  role: DumpMessage['role'],
): boolean {
  return role === 'user'
    ? block.type === 'tool_result'
    : block.type === 'thinking' || block.type === 'redacted_thinking';
}
function nonempty(block: AnthropicMessageBlock): boolean {
  return block.type !== 'text' || block.text.trim() !== '';
}
async function* contentBlocks(
  table: AnthropicDumpTable,
  message: DumpMessage,
): AsyncIterable<unknown> {
  if (message.ordered !== true) {
    for (const entry of table.entries(message))
      if (nonempty(entry.block)) yield dumpBlockValue(table, entry.block);
    return;
  }
  for (const first of [true, false])
    for (const entry of table.entries(message)) {
      if (
        nonempty(entry.block) &&
        important(entry.block, message.role) === first
      )
        yield dumpBlockValue(table, entry.block);
    }
}
function contentValue(
  table: AnthropicDumpTable,
  message: DumpMessage,
): string | AsyncIterable<unknown> {
  const placeholder =
    message.role === 'user' ? '[Empty message]' : '[No content generated]';
  if (message.text !== undefined)
    return message.text.trim() === '' ? placeholder : message.text;
  for (const entry of table.entries(message))
    if (nonempty(entry.block)) return contentBlocks(table, message);
  return placeholder;
}

export async function* buildAnthropicDumpStream(
  source: HistoryDumpSource,
  options: AnthropicMessageConversionOptions,
): AsyncIterable<unknown> {
  const table = new AnthropicDumpTable();
  try {
    await buildAnthropicRawTable(source, table, options);
    filterDumpOrphans(table);
    repairDumpAdjacency(table);
    mergeDumpRoles(table);
    if (table.head === -1) {
      yield { role: 'user', content: 'Hello' };
      return;
    }
    if (table.messages.read(table.head).role !== 'user')
      yield { role: 'user', content: 'Continue the conversation' };
    for (const id of table.ids()) {
      const message = table.messages.read(id);
      yield { role: message.role, content: contentValue(table, message) };
    }
    if (
      table.messages.read(table.tail).role === 'assistant' &&
      (options.reasoningEnabled || !modelSupportsPrefill(options.currentModel))
    )
      yield { role: 'user', content: 'Continue the conversation' };
  } finally {
    table.close();
  }
}
