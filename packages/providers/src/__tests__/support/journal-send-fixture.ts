/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createCoreSuffixFixtureGraph } from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import {
  assertRowIndex,
  type ProviderRequestSelection,
  type ProviderRequestSnapshot,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { SemanticPurgeStreamTransaction } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

export interface JournalSendFixture {
  readonly selection: ProviderRequestSnapshot;
  close(): Promise<void>;
}

export async function journalSendFixture(
  rows: Iterable<IContent>,
  pending: readonly IContent[] = [],
  options: {
    readonly directory?: string;
    readonly oneRowAtATime?: boolean;
    readonly mediaStore?: LocalMediaStore;
  } = {},
): Promise<JournalSendFixture> {
  const parent =
    options.directory ??
    join(
      import.meta.dir,
      '../../../../../tmp/854-notes/p4/w23/limits-memory-run-c/fixtures',
    );
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'native-send-'));
  const graph = createCoreSuffixFixtureGraph(root, undefined, (options) => {
    const service = new HistoryService(options);
    forbidHistoryMaterializationForTest(
      service,
      'native send materialized history',
    );
    return service;
  });
  try {
    if (options.oneRowAtATime === true) {
      for (const row of rows) await graph.service.addBatch([row]);
      await graph.service.waitForCommit();
    } else await graph.seed(rows);
    await graph.recording.setSessionName('Journal send fixture');
    if (options.mediaStore !== undefined)
      await graph.service.registerMediaOwner(
        new HistoryMediaOwnership(options.mediaStore),
      );
    const selection = await graph.service.prepareCuratedForProviderSnapshot(
      pending,
      {
        ownership: graph.ownership,
      },
    );
    return {
      selection,
      async close(): Promise<void> {
        await selection.close();
        await graph.service.dispose();
        await graph.recording.dispose();
      },
    };
  } catch (error) {
    await graph.service.dispose();
    await graph.recording.dispose();
    throw error;
  }
}

export async function rawJournalSelection(
  history: HistoryService,
  transaction?: SemanticPurgeStreamTransaction,
  explicit = true,
): Promise<ProviderRequestSelection> {
  const snapshot = await history.detachedValues.openSemanticPurgeSnapshot();
  if (snapshot === undefined) throw new Error('Missing raw journal snapshot');
  const candidate = transaction?.native;
  const count =
    transaction === undefined || explicit
      ? snapshot.length
      : transaction.candidate.length;
  let closed = false;
  const readAt = async (
    index: number,
    signal?: AbortSignal,
  ): Promise<IContent> => {
    if (closed) throw new Error('Raw journal selection is closed');
    signal?.throwIfAborted();
    assertRowIndex(index, count);
    const original =
      !explicit &&
      candidate?.removed === true &&
      index >= candidate.location.contentIndex
        ? index + 1
        : index;
    let row = await snapshot.readRow(original);
    if (
      !explicit &&
      candidate !== undefined &&
      original === candidate.location.contentIndex
    )
      row = candidate.projectRequestRow(row);
    const boundary = transaction?.preImageBoundary;
    const boundaryId = transaction?.preImageBoundaryIdentity;
    if (
      explicit &&
      boundary !== undefined &&
      boundaryId !== undefined &&
      original === boundary.contentIndex
    )
      row = {
        ...row,
        metadata: {
          ...row.metadata,
          semanticMediaPurgeBoundary: {
            blockIndex: boundary.blockIndex,
            boundaryId,
          },
        },
      };
    return row;
  };
  return {
    callerOwned: true,
    count,
    readAt,
    async *openReader(signal) {
      for (let index = 0; index < count; index++)
        yield await readAt(index, signal);
    },
    async close() {
      closed = true;
      await snapshot.close();
    },
  };
}
