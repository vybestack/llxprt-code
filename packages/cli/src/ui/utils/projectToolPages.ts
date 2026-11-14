/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  EmojiFilterMode,
  ToolCallBlock,
  RowOwnership,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem, IndividualToolCallDisplay } from '../types.js';
import { iContentToHistoryItems } from './iContentToHistoryItems.js';
import type { ToolResponseIndex } from './toolResponseIndex.js';

const TOOL_PAGE_SIZE = 16;

function responseSequence(
  responses: ToolResponseIndex | undefined,
  callId: string,
  ownership: RowOwnership | undefined,
): number | undefined {
  const response = responses?.get(callId);
  if (!response) return undefined;
  ownership?.retain(response);
  try {
    return response.metadata?.chronology?.seq;
  } finally {
    ownership?.release(response);
  }
}

function groupBounds(
  opener: IContent,
  responses: ToolResponseIndex | undefined,
  ownership: RowOwnership | undefined,
): { total: number; span: readonly [number, number] | undefined } {
  let total = 0;
  let end: number | undefined;
  for (const block of opener.blocks) {
    if (block.type !== 'tool_call') continue;
    total += 1;
    const seq = responseSequence(responses, block.id, ownership);
    if (seq !== undefined) end = Math.max(end ?? seq, seq);
  }
  const start = opener.metadata?.chronology?.seq;
  return {
    total,
    span:
      start !== undefined && end !== undefined
        ? [start, Math.max(start, end)]
        : undefined,
  };
}

function acquireProjectedCall(
  call: ToolCallBlock,
  responses: ToolResponseIndex | undefined,
  ownership: RowOwnership | undefined,
): IndividualToolCallDisplay {
  const row: IContent = { speaker: 'ai', blocks: [call] };
  const response = responses?.get(call.id);
  const rows = response ? [row, response] : [row];
  for (const input of rows) ownership?.retain(input);
  let group: HistoryItem | undefined;
  try {
    [group] = iContentToHistoryItems(rows, 'allowed');
    ownership?.retain(group);
    if (group.type !== 'tool_group') throw new Error('Missing projected call');
    const tool = group.tools[0];
    ownership?.retain(tool);
    return tool;
  } finally {
    if (group) ownership?.release(group);
    for (const input of rows) ownership?.release(input);
  }
}

function* projectPage(
  page: IContent,
  responses: ToolResponseIndex | undefined,
  mode: EmojiFilterMode | undefined,
  ownership: RowOwnership | undefined,
): Iterable<HistoryItem> {
  const items: HistoryItem[] = [];
  const tools: IndividualToolCallDisplay[] = [];
  const textRow: IContent = {
    ...page,
    blocks: page.blocks.filter((block) => block.type !== 'tool_call'),
  };
  ownership?.retain(page);
  ownership?.retain(textRow);
  try {
    for (const item of iContentToHistoryItems([textRow], mode)) {
      ownership?.retain(item);
      items.push(item);
    }
    for (const block of page.blocks) {
      if (block.type === 'tool_call')
        tools.push(acquireProjectedCall(block, responses, ownership));
    }
    if (tools.length > 0) {
      const group: HistoryItem = {
        id: -1,
        type: 'tool_group',
        tools,
        rowIdentity: { kind: 'legacy', index: 0, discriminator: 'toolGroup' },
      };
      ownership?.retain(group);
      items.push(group);
    }
    yield* items;
  } finally {
    for (const item of items) ownership?.release(item);
    for (const tool of tools) ownership?.release(tool);
    ownership?.release(textRow);
    ownership?.release(page);
  }
}

export function* projectToolPages(
  opener: IContent,
  responses: ToolResponseIndex | undefined,
  groupIndex: number,
  mode?: EmojiFilterMode,
  ownership?: RowOwnership,
): Iterable<HistoryItem> {
  const { total, span } = groupBounds(opener, responses, ownership);
  let blockIndex = 0;
  let start = 0;
  do {
    const blocks: IContent['blocks'] =
      start === 0
        ? opener.blocks.filter((block) => block.type !== 'tool_call')
        : [];
    let calls = 0;
    while (blockIndex < opener.blocks.length && calls < TOOL_PAGE_SIZE) {
      const block = opener.blocks[blockIndex++];
      if (block.type !== 'tool_call') continue;
      blocks.push(block);
      calls += 1;
    }
    const page: IContent = { ...opener, blocks };
    for (const item of projectPage(page, responses, mode, ownership)) {
      if (item.type !== 'tool_group') {
        yield item;
        continue;
      }
      const identity = item.rowIdentity;
      const projected: HistoryItem = {
        ...item,
        ...(span !== undefined ? { seqSpan: span } : {}),
        ...(total > TOOL_PAGE_SIZE
          ? {
              toolPage: { start, total, groupIndex },
              ...(identity?.kind === 'legacy' && start > 0
                ? {
                    rowIdentity: { ...identity, toolOffset: start },
                  }
                : {}),
            }
          : {}),
      };
      ownership?.retain(projected);
      try {
        yield projected;
      } finally {
        ownership?.release(projected);
      }
    }
    start += calls;
  } while (start < total);
}
