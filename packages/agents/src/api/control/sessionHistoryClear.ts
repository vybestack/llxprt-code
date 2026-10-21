/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryMediaIndex } from '@vybestack/llxprt-code-core/storage/history-media-index.js';
import { collectMediaReferences } from '@vybestack/llxprt-code-core/storage/media-reference-lifecycle.js';
import { randomUUID } from 'node:crypto';
import { nativeHistoryPrefixOwner } from '@vybestack/llxprt-code-core/services/history/native-history-prefix.js';

interface ClearMediaScope {
  readonly references: HistoryMediaIndex;
  readonly store: LocalMediaStore;
  readonly owner: string;
}

async function reserveClearRow(
  row: IContent,
  media: ClearMediaScope,
): Promise<void> {
  for (const reference of collectMediaReferences([row])) {
    if (media.references.has(reference.contentId)) continue;
    media.references.set(reference);
    await media.store.reserve(reference, media.owner);
  }
}

async function releaseClearMedia(media: ClearMediaScope): Promise<void> {
  try {
    for (const reference of media.references.values()) {
      await media.store.release(reference.contentId, media.owner);
      media.references.delete(reference.contentId);
    }
  } finally {
    media.references.close();
  }
}

async function captureHistoryRows(
  source: AsyncIterable<IContent>,
  rows: HistoryDensityRows,
  media: ClearMediaScope,
): Promise<void> {
  for await (const row of source) {
    await reserveClearRow(row, media);
    rows.append(row);
  }
}

/** Index of the second human row: everything from there on is cleared. */
function clearCut(rows: HistoryDensityRows): number {
  let foundHuman = false;
  for (let index = 0; index < rows.length; index++) {
    if (rows.readRow(index).speaker !== 'human') continue;
    if (foundHuman) return index;
    foundHuman = true;
  }
  return rows.length;
}

/** Start of the Nth-from-last human turn, or 0 when there are fewer turns. */
function restoreCut(turns: number): (rows: HistoryDensityRows) => number {
  return (rows) => {
    if (turns === 0 || rows.length === 0) return rows.length;
    let humans = 0;
    for (let index = rows.length - 1; index >= 0; index--) {
      if (rows.readRow(index).speaker === 'human' && ++humans === turns)
        return index;
    }
    return 0;
  };
}

async function* prefixRows(
  rows: HistoryDensityRows,
  count: number,
): AsyncGenerator<IContent, void, unknown> {
  let index = 0;
  for (const row of rows) {
    if (index++ === count) return;
    yield row;
  }
}

async function preflightClear(
  rows: HistoryDensityRows,
  count: number,
  store: LocalMediaStore,
): Promise<void> {
  const admission = new MediaAdmissionService(store);
  const context = {
    turnId: 'clear-history-preflight',
    source: 'clear-history-preflight',
  };
  for await (const row of prefixRows(rows, count)) {
    const admitted = await admission.admitContents([row], context);
    await admission.releaseContents(admitted, context);
  }
}

async function rewriteClientHistory(
  client: AgentClientContract,
  store: LocalMediaStore,
  selectCut: (rows: HistoryDensityRows) => number,
  turns: number,
  fromEnd: boolean,
): Promise<number> {
  const native = nativeHistoryPrefixOwner(client.getHistoryService());
  if (native !== undefined) {
    return native.withPrefix(turns, fromEnd, store, async (prefix) => {
      if (prefix.removed !== 0) await client.resetChat(prefix);
      return prefix.removed;
    });
  }
  const rows = new HistoryDensityRows();
  const media: ClearMediaScope = {
    references: new HistoryMediaIndex(),
    store,
    owner: `clear-snapshot:${randomUUID()}`,
  };
  try {
    await captureHistoryRows(client.getHistory(), rows, media);
    const cut = selectCut(rows);
    if (cut === rows.length) return 0;
    await preflightClear(rows, cut, store);
    try {
      await client.resetChat(prefixRows(rows, cut));
    } catch (error: unknown) {
      try {
        await client.setHistoryFromSource(rows.streamRows());
        await client.getHistoryService()?.waitForCommit();
      } catch (rollbackError: unknown) {
        throw new AggregateError(
          [error, rollbackError],
          'History clear and rollback failed',
        );
      }
      throw error;
    }
    return rows.length - cut;
  } finally {
    try {
      try {
        await client.getHistoryService()?.settleMediaOwnership();
      } finally {
        await releaseClearMedia(media);
      }
    } finally {
      rows.close();
    }
  }
}

export async function clearClientHistory(
  client: AgentClientContract,
  store: LocalMediaStore,
): Promise<void> {
  await rewriteClientHistory(client, store, clearCut, 2, false);
}

/** Removes the last `turns` human-led turns; returns the number of rows removed. */
export async function restoreClientTurns(
  client: AgentClientContract,
  store: LocalMediaStore,
  turns: number,
): Promise<number> {
  if (!Number.isSafeInteger(turns) || turns < 0) {
    throw new Error('Turns to remove must be a non-negative integer');
  }
  return rewriteClientHistory(client, store, restoreCut(turns), turns, true);
}
