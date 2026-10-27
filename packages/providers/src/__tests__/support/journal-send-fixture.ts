/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { JournalProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/journal-provider-request.js';
import { encodedRows } from '@vybestack/llxprt-code-core/services/history/journalPublication.js';
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

export async function nativeJournalSendFixture(
  rows: Iterable<IContent>,
  options: { readonly mediaStore?: LocalMediaStore } = {},
): Promise<JournalSendFixture> {
  const parent = join(
    import.meta.dir,
    '../../../../../tmp/ci-provider-fixtures',
  );
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'native-journal-send-'));
  const session = await JournalSession.create(join(root, 'session.llxj'));
  try {
    // Provider envelope tests need a real journal selection, not unrelated
    // HistoryService admission and token estimation of their oversized rows.
    await session.store.commit([
      { kind: 'replace', rows: encodedRows(rows, 0) },
    ]);
    const snapshot = await session.store.snapshot();
    const selection = await JournalProviderRequestSnapshot.create(
      snapshot,
      [],
      {},
      undefined,
      () => snapshot.close(),
      (pin, registration) =>
        session.store.prepareSnapshotFormat(pin, registration),
      options.mediaStore,
      (pin) => session.store.prepareSnapshotKimi(pin),
    );
    return {
      selection,
      async close(): Promise<void> {
        await selection.close();
        await session.close();
      },
    };
  } catch (error) {
    await session.close();
    throw error;
  }
}

async function seedBatches(
  service: HistoryService,
  rows: Iterable<IContent> | AsyncIterable<IContent>,
  size: number,
): Promise<void> {
  if (!Number.isSafeInteger(size) || size < 1)
    throw new Error('Fixture seed batch size must be a positive integer');
  let batch: IContent[] = [];
  for await (const row of rows) {
    batch.push(row);
    if (batch.length === size) {
      await service.addBatch(batch);
      batch = [];
    }
  }
  if (batch.length > 0) await service.addBatch(batch);
  await service.waitForCommit();
}

export async function journalSendFixture(
  rows: Iterable<IContent> | AsyncIterable<IContent>,
  pending: readonly IContent[] = [],
  options: {
    readonly directory?: string;
    readonly oneRowAtATime?: boolean;
    readonly seedBatchRows?: number;
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
    if (options.seedBatchRows !== undefined) {
      await seedBatches(graph.service, rows, options.seedBatchRows);
    } else if (options.oneRowAtATime === true || Symbol.asyncIterator in rows) {
      for await (const row of rows) await graph.service.addBatch([row]);
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
