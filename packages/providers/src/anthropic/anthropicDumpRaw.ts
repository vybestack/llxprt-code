/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { AnthropicConversationConversionOptions as AnthropicMessageConversionOptions } from './AnthropicMessageNormalizer.js';
import { DumpScratch } from '../utils/dumpScratch.js';
import { appendDumpChainResults } from './anthropicDumpChainResults.js';
import type { AnthropicDumpTable } from './anthropicDumpTable.js';
import { buildWireTable } from './message-table/wire-builder.js';

/** The captured rows as a selection with random access. */
function scratchRows(rows: DumpScratch<IContent>): ProviderRequestRows {
  return {
    count: rows.length,
    async *openReader(): AsyncGenerator<IContent, void, unknown> {
      for (let index = 0; index < rows.length; index++) yield rows.read(index);
    },
    readAt: (index) => rows.read(index),
  };
}

/**
 * Builds the dump's table with the send path's builder. The history source has
 * no random access, so its rows are copied to scratch first. The only
 * difference from the wire table is that a chain's tool results are kept as
 * descriptors that the dump streams instead of holding.
 */
export async function buildAnthropicRawTable(
  source: HistoryDumpSource,
  table: AnthropicDumpTable,
  options: AnthropicMessageConversionOptions,
): Promise<void> {
  const rows = new DumpScratch<IContent>();
  try {
    for await (const row of source.rows()) rows.append(row);
    await buildWireTable(table, scratchRows(rows), {
      ...options,
      chainResults: appendDumpChainResults,
    });
  } finally {
    rows.close();
  }
}
