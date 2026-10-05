/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryMediaIndex } from '@vybestack/llxprt-code-core/storage/history-media-index.js';
import { collectMediaReferences } from '@vybestack/llxprt-code-core/storage/media-reference-lifecycle.js';
import { randomUUID } from 'node:crypto';

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

async function captureClearHistory(
  source: AsyncIterable<IContent>,
  rows: HistoryDensityRows,
  media: ClearMediaScope,
): Promise<number> {
  let foundHuman = false;
  let cut: number | undefined;
  for await (const row of source) {
    if (row.speaker === 'human') {
      if (foundHuman && cut === undefined) cut = rows.length;
      foundHuman = true;
    }
    await reserveClearRow(row, media);
    rows.append(row);
  }
  return cut ?? rows.length;
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

export async function clearClientHistory(
  client: AgentClientContract,
  store: LocalMediaStore,
): Promise<void> {
  const rows = new HistoryDensityRows();
  const media: ClearMediaScope = {
    references: new HistoryMediaIndex(),
    store,
    owner: `clear-snapshot:${randomUUID()}`,
  };
  try {
    const cut = await captureClearHistory(client.getHistory(), rows, media);
    if (cut === rows.length) return;
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
