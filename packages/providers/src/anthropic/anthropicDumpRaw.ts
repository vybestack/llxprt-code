/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AnthropicConversationConversionOptions as AnthropicMessageConversionOptions } from './AnthropicMessageNormalizer.js';
import { stripCrossModelThinking } from './crossModelThinkingStrip.js';
import {
  convertContentToMessages,
  convertBlockToAnthropicPart,
  type AnthropicMessage,
} from './AnthropicMessageNormalizer.js';
import { DumpScratch } from '../utils/dumpScratch.js';
import { appendChainResults } from './anthropicDumpChainResults.js';
import type { AnthropicDumpTable, DumpMessage } from './anthropicDumpTable.js';

function appendChainRow(
  table: AnthropicDumpTable,
  record: DumpMessage,
  row: IContent,
  category: number,
  index: number,
  redact: boolean,
  options: AnthropicMessageConversionOptions,
): void {
  for (const block of row.blocks) {
    if (priority(block) !== category) continue;
    const part = convertBlockToAnthropicPart(block, index, redact, options);
    if (part !== null) table.addBlock(record, part);
  }
}

function chainEnd(
  rows: DumpScratch<IContent>,
  start: number,
  enabled: boolean,
): number {
  const first = rows.read(start);
  if (
    !enabled ||
    first.speaker !== 'ai' ||
    first.blocks.length === 0 ||
    !first.blocks.every(
      (block) => block.type === 'thinking' && block.sourceField === 'thinking',
    )
  )
    return start;
  let end = start;
  while (end + 1 < rows.length && rows.read(end + 1).speaker === 'ai') end++;
  return end;
}

function priority(block: ContentBlock): number {
  if (block.type === 'thinking' && block.sourceField === 'thinking') return 0;
  if (block.type === 'text' || block.type === 'code') return 1;
  if (block.type === 'tool_call') return 3;
  return 2;
}

function appendResult(
  table: AnthropicDumpTable,
  message: AnthropicMessage,
  pending: number,
): number {
  if (pending === -1) return table.append(message);
  const record = table.messages.read(pending);
  if (typeof message.content === 'string')
    throw new Error('Tool-result message must have blocks');
  for (const block of message.content) table.addBlock(record, block);
  table.messages.replace(pending, record);
  return pending;
}

function appendRow(
  table: AnthropicDumpTable,
  row: IContent,
  redact: boolean,
  options: AnthropicMessageConversionOptions,
  pending: number,
): number {
  const messages = convertContentToMessages(
    [row],
    new Set(redact ? [0] : []),
    options,
  );
  const hasResults = row.blocks.some((block) => block.type === 'tool_response');
  for (let index = 0; index < messages.length; index++) {
    if (index === 0 && hasResults)
      pending = appendResult(table, messages[index], pending);
    else table.append(messages[index]);
  }
  return row.speaker === 'tool' ? pending : -1;
}

function appendChain(
  table: AnthropicDumpTable,
  rows: DumpScratch<IContent>,
  start: number,
  end: number,
  redact: boolean,
  options: AnthropicMessageConversionOptions,
): void {
  const id = table.append({ role: 'assistant', content: [] });
  const record = table.messages.read(id);
  for (let category = 0; category < 4; category++) {
    for (let index = start; index <= end; index++) {
      appendChainRow(
        table,
        record,
        rows.read(index),
        category,
        index,
        redact,
        options,
      );
    }
  }
  if (record.head === -1) record.text = '';
  table.messages.replace(id, record);
}

async function captureRows(
  source: HistoryDumpSource,
  rows: DumpScratch<IContent>,
  options: AnthropicMessageConversionOptions,
): Promise<void> {
  let leading = true;
  for await (const original of source.rows()) {
    const strippedRows = stripCrossModelThinking(
      [original],
      options.currentModel,
      options.currentBaseURL,
      options.logger,
    );
    const stripped: IContent | undefined =
      strippedRows.length === 0 ? undefined : strippedRows[0];
    if (stripped !== undefined && (!leading || stripped.speaker !== 'tool')) {
      leading = false;
      rows.append(stripped);
    }
  }
}

function lastThinkingGroup(
  rows: DumpScratch<IContent>,
  enabled: boolean,
): number {
  let last = -1;
  for (let start = 0; start < rows.length; start++) {
    const end = chainEnd(rows, start, enabled);
    for (let index = start; index <= end; index++) {
      const row = rows.read(index);
      if (
        row.speaker === 'ai' &&
        row.blocks.some((block) => block.type === 'thinking')
      )
        last = start;
    }
    start = end;
  }
  return last;
}

export async function buildAnthropicRawTable(
  source: HistoryDumpSource,
  table: AnthropicDumpTable,
  options: AnthropicMessageConversionOptions,
): Promise<void> {
  const rows = new DumpScratch<IContent>();
  try {
    await captureRows(source, rows, options);
    const lastThinking = lastThinkingGroup(rows, options.reasoningEnabled);
    let pending = -1;
    for (let start = 0; start < rows.length; start++) {
      const end = chainEnd(rows, start, options.reasoningEnabled);
      const redact =
        options.includeInContext === false ||
        options.stripFromContext === 'all' ||
        (options.stripFromContext === 'allButLast' && start !== lastThinking);
      if (end === start)
        pending = appendRow(table, rows.read(start), redact, options, pending);
      else {
        appendChainResults(table, rows, start, end, pending, options);
        appendChain(table, rows, start, end, redact, options);
        pending = -1;
      }
      start = end;
    }
  } finally {
    rows.close();
  }
}
