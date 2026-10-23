/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DebugLogger } from '../../debug/index.js';
import { ROW_FLAG, ROW_ID_KIND } from '../../journal/rowRecord.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import { streamCuratedProviderHistory } from './historyCuration.js';
import { decodeStoredRow, decodeStoredBlock } from './journalRowCodec.js';
import type { JournalTailSource } from './journal-tail-source.js';
import {
  completedResponseParts,
  callTarget,
} from './journal-reconstruction.js';
import { journalEntryPlans } from './journal-entry-plans.js';
import {
  ProviderAnchorDiagnostics,
  logReconstructedCalls,
  logUnmatchedResponse,
} from './providerDiagnostics.js';
import type { IContent } from './IContent.js';

async function* historyRows(
  source: JournalTailSource,
  signal?: AbortSignal,
): AsyncGenerator<IContent> {
  for await (const entry of source.entries()) {
    signal?.throwIfAborted();
    if (source.isTail(entry.label)) continue;
    const stored = decodeStoredRow(await source.readRow(entry));
    yield source.header(stored, entry);
  }
}

function* reconstructedCalls(
  row: IContent,
  indices: readonly number[],
): Generator<IContent['blocks'][number]> {
  for (const index of indices) {
    const block = row.blocks[index];
    if (block.type === 'tool_response')
      yield {
        type: 'tool_call',
        id: block.callId,
        name: block.toolName || 'unknown_tool',
        parameters: {},
      };
  }
}

async function logReconstruction(
  source: JournalTailSource,
  logger: DebugLogger,
  signal?: AbortSignal,
): Promise<void> {
  for await (const part of completedResponseParts(source)) {
    signal?.throwIfAborted();
    if (part.reconstructed !== true) continue;
    const row = decodeStoredRow(await source.readRow(part.entry));
    logReconstructedCalls(logger, reconstructedCalls(row, part.indices));
  }
}

async function logUnmatchedRow(
  source: JournalTailSource,
  entry: RowEntry,
  logger: DebugLogger,
): Promise<void> {
  const ids = await source.readIds(entry);
  for (const [index, tuple] of ids.header.ids.entries()) {
    const id = ids.rawIds[index];
    if (tuple.kind !== ROW_ID_KIND.response || !id) continue;
    const fact = await source.facts.fact(id);
    if (fact === undefined || callTarget(fact) === undefined) {
      const block = decodeStoredBlock(
        await source.readBlock(entry, tuple.block, ids),
        ids.header.blocks[tuple.block].type,
      );
      if (block.type === 'tool_response') logUnmatchedResponse(logger, block);
    }
  }
}

async function logUnmatched(
  source: JournalTailSource,
  logger: DebugLogger,
  signal?: AbortSignal,
): Promise<void> {
  for await (const entry of source.entries()) {
    signal?.throwIfAborted();
    if ((entry.flags & ROW_FLAG.curated) !== 0)
      await logUnmatchedRow(source, entry, logger);
  }
}

async function hasOutputAnchor(
  source: JournalTailSource,
  entries: ReadonlyArray<RowEntry | undefined>,
): Promise<boolean> {
  for (const entry of entries) {
    if (entry === undefined) continue;
    for await (const plan of journalEntryPlans(source, entry))
      if (plan.header.metadata?.cacheAnchor === true) return true;
  }
  return false;
}

async function logAnchors(
  source: JournalTailSource,
  outputCount: number,
  logger: DebugLogger,
  signal?: AbortSignal,
): Promise<void> {
  const anchors = new ProviderAnchorDiagnostics();
  let previous: RowEntry | undefined;
  let outputHasAnchor = false;
  for await (const entry of source.entries()) {
    signal?.throwIfAborted();
    if ((entry.flags & ROW_FLAG.curated) === 0) continue;
    const hasAnchor = (entry.flags & ROW_FLAG.cacheAnchor) !== 0;
    anchors.input(hasAnchor);
    if (hasAnchor && !outputHasAnchor)
      outputHasAnchor = await hasOutputAnchor(source, [previous, entry]);
    previous = entry;
  }
  anchors.output(outputHasAnchor, outputCount);
  anchors.log(logger);
}

export async function logJournalRequestDiagnostics(
  source: JournalTailSource,
  outputCount: number,
  logger: DebugLogger,
  isCompressing: boolean,
  signal?: AbortSignal,
): Promise<void> {
  if (logger.enabled) {
    for await (const _row of streamCuratedProviderHistory(
      logger,
      historyRows(source, signal),
      isCompressing,
      signal,
    )) {
      signal?.throwIfAborted();
    }
    await logReconstruction(source, logger, signal);
    await logUnmatched(source, logger, signal);
  }
  await logAnchors(source, outputCount, logger, signal);
}
