/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { normalizeToAnthropicToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { buildToolResponsePayload } from '../utils/toolResponsePayload.js';
import type { DumpScratch } from '../utils/dumpScratch.js';
import {
  buildAnthropicToolResultContent,
  convertBlockToAnthropicPart,
  type AnthropicConversationConversionOptions,
} from './AnthropicMessageNormalizer.js';
import type {
  AnthropicDumpTable,
  DumpMessage,
  StoredMessageBlock,
} from './anthropicDumpTable.js';

function addDescriptors(
  table: AnthropicDumpTable,
  row: IContent,
  prefix: DumpMessage,
  media: DumpMessage,
  index: number,
  options: AnthropicConversationConversionOptions,
): void {
  for (const block of row.blocks) {
    if (block.type === 'text' || block.type === 'code') {
      const part = convertBlockToAnthropicPart(block, index, false, options);
      if (part !== null) table.addBlock(prefix, part);
    }
    if (block.type === 'media') {
      const parts = buildAnthropicToolResultContent(
        '',
        [block],
        options.supportsUrlImages ?? true,
      );
      if (typeof parts !== 'string') table.addBlock(media, parts[1]);
    }
  }
}
function descriptors(
  table: AnthropicDumpTable,
  rows: DumpScratch<IContent>,
  start: number,
  end: number,
  options: AnthropicConversationConversionOptions,
): { prefix: DumpMessage; media: DumpMessage } {
  const prefix: DumpMessage = { role: 'user', head: -1, tail: -1, next: -1 };
  const media: DumpMessage = { role: 'user', head: -1, tail: -1, next: -1 };
  for (let index = start; index <= end; index++) {
    addDescriptors(table, rows.read(index), prefix, media, index, options);
  }
  return { prefix, media };
}
function addResults(
  table: AnthropicDumpTable,
  target: DumpMessage,
  row: IContent,
  prefix: DumpMessage,
  media: DumpMessage,
  options: AnthropicConversationConversionOptions,
): void {
  for (const block of row.blocks) {
    if (block.type !== 'tool_response') continue;
    const payload = buildToolResponsePayload(
      block,
      options.config as Parameters<typeof buildToolResponsePayload>[1],
    );
    const result: StoredMessageBlock = {
      type: 'tool_result',
      tool_use_id: normalizeToAnthropicToolId(block.callId),
      content: payload.limitMessage
        ? `${payload.result}\n${payload.limitMessage}`
        : payload.result,
      ...(payload.status === 'error' ? { is_error: true } : {}),
      dumpPrefixHead: prefix.head,
      dumpMediaHead: media.head,
    };
    table.addBlock(target, result);
  }
}
export function appendChainResults(
  table: AnthropicDumpTable,
  rows: DumpScratch<IContent>,
  start: number,
  end: number,
  pending: number,
  options: AnthropicConversationConversionOptions,
): void {
  const { prefix, media } = descriptors(table, rows, start, end, options);
  let targetId = pending;
  for (let index = start; index <= end; index++) {
    const row = rows.read(index);
    if (!row.blocks.some((block) => block.type === 'tool_response')) continue;
    if (targetId === -1) targetId = table.append({ role: 'user', content: [] });
    const target = table.messages.read(targetId);
    addResults(table, target, row, prefix, media, options);
    table.messages.replace(targetId, target);
  }
}
