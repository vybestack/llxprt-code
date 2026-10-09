/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { IContent } from './IContent.js';

export async function estimateMergedAppendTokens(
  candidate: HistoryDensityRows,
  start: number,
  estimate: (row: IContent) => Promise<number>,
  ownership?: RowOwnership,
): Promise<number> {
  let tokens = 0;
  for (let index = start; index < candidate.length; index++) {
    const row = candidate.readRow(index);
    ownership?.retain(row);
    try {
      tokens += await estimate(row);
    } finally {
      ownership?.release(row);
    }
  }
  return tokens;
}

function appendSnapshot(
  candidate: HistoryDensityRows,
  source: HistoryMutationSnapshot,
  acceptedOnly = false,
): void {
  let index = 0;
  for (const row of source) {
    const accepted =
      ['human', 'ai', 'tool'].includes(row.speaker) &&
      Array.isArray(row.blocks) &&
      row.blocks.length > 0;
    if (!acceptedOnly || accepted) {
      if (source.isPendingRow(index)) candidate.appendSanitized(row);
      else candidate.append(row);
    }
    index++;
  }
}

export async function withMergedHistoryRows(
  previous: HistoryMutationSnapshot,
  incoming: HistoryMutationSnapshot,
  publish: (candidate: HistoryDensityRows) => Promise<void>,
  ownership?: RowOwnership,
): Promise<void> {
  if (incoming.length === 0) return;
  const candidate = new HistoryDensityRows(ownership);
  try {
    appendSnapshot(candidate, previous);
    appendSnapshot(candidate, incoming, true);
    if (candidate.length === previous.length) return;
    await publish(candidate);
  } finally {
    candidate.close();
  }
}
