/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { normalizeToAnthropicToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { buildToolResponsePayload } from '../utils/toolResponsePayload.js';
import {
  buildAnthropicToolResultContent,
  convertBlockToAnthropicPart,
  type AnthropicConversationConversionOptions,
} from './AnthropicMessageNormalizer.js';
import {
  newMessage,
  type MessageTable,
  type StoredMessageBlock,
  type TableMessage,
} from './message-table/message-table.js';
import type { ChainResultsAppender } from './message-table/wire-builder.js';

function addDescriptors(
  table: MessageTable,
  row: IContent,
  prefix: TableMessage,
  media: TableMessage,
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
async function descriptors(
  table: MessageTable,
  request: Parameters<ChainResultsAppender>[0],
): Promise<{ prefix: TableMessage; media: TableMessage }> {
  const prefix = newMessage('user');
  const media = newMessage('user');
  for (let index = request.range.start; index <= request.range.end; index++) {
    const row = await request.projectedAt(index);
    if (row !== undefined)
      addDescriptors(table, row, prefix, media, index, request.options);
  }
  return { prefix, media };
}
function addResults(
  table: MessageTable,
  target: TableMessage,
  row: IContent,
  prefix: TableMessage,
  media: TableMessage,
  options: AnthropicConversationConversionOptions,
): void {
  for (const block of row.blocks) {
    if (block.type !== 'tool_response') continue;
    const payload = buildToolResponsePayload(block, options.config);
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
function hasResponses(row: IContent): boolean {
  return row.blocks.some((block) => block.type === 'tool_response');
}

export const appendDumpChainResults: ChainResultsAppender = async (request) => {
  const { table, range, options } = request;
  const { prefix, media } = await descriptors(table, request);
  let targetId = request.pending;
  for (let index = range.start; index <= range.end; index++) {
    const row = await request.projectedAt(index);
    if (row === undefined || !hasResponses(row)) continue;
    if (targetId === -1) targetId = table.append({ role: 'user', content: [] });
    const target = table.messages.read(targetId);
    addResults(table, target, row, prefix, media, options);
    table.messages.replace(targetId, target);
  }
};
