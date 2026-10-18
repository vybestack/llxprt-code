/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  suffixRow,
  suffixSeeder,
  withSuffixFixtureGraph,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { createRecorderForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import {
  HISTORY_BACKEND_ENV,
  type HistoryBackend,
} from '../../historyBackendSelect.js';
import {
  createRowCounters,
  type RowCounters,
} from '../../../../recording/journalCounters.js';
import { RowOwnership } from '../../../../recording/rowOwnership.js';
import type { SessionRecordingPort } from '../../../../recording/recordingPort.js';
import {
  HistoryService,
  type HistoryServiceJournalOptions,
} from '../../HistoryService.js';
import type { IContent } from '../../IContent.js';

export interface CoreSuffixFixtureGraph {
  readonly service: HistoryService;
  readonly recording: SessionRecordingPort;
  seed(rows: Iterable<IContent>): Promise<void>;
  readonly ownership: RowOwnership;
  readonly mutationOwnership: RowOwnership;
  readonly counters: RowCounters;
}

function createHistoryService(
  options: HistoryServiceJournalOptions,
): HistoryService {
  return new HistoryService(options);
}

/**
 * `backend` names the store and recorder the fixture builds; omitted, the
 * environment selects them. A test of the old store's internals names `'old'`.
 */
export function createCoreSuffixFixtureGraph(
  root: string,
  mutationOwnership = new RowOwnership(),
  createService: (
    options: HistoryServiceJournalOptions,
  ) => HistoryService = createHistoryService,
  backend?: HistoryBackend,
): CoreSuffixFixtureGraph {
  const recording = createRecorderForTest(
    {
      sessionId: 'suffix-test',
      projectHash: 'suffix-test',
      chatsDir: root,
    },
    backend === undefined ? process.env : { [HISTORY_BACKEND_ENV]: backend },
  );
  const ownership = new RowOwnership();
  const counters = createRowCounters();
  const service = createService({
    backend,
    recording,
    attachmentCounters: { ...counters.counters, ownership },
    mutationOwnership,
  });
  return {
    service,
    recording,
    ownership,
    mutationOwnership,
    counters,
    seed: suffixSeeder(recording, service),
  };
}

export async function withCoreSuffixFixture<T>(
  size: number,
  action: (
    service: HistoryService,
    ownership: RowOwnership,
    counters: RowCounters,
  ) => Promise<T>,
  payloadBytes = 0,
  makeRow: (index: number, payloadBytes: number) => IContent = suffixRow,
  mutationOwnership = new RowOwnership(),
  createService: (
    options: HistoryServiceJournalOptions,
  ) => HistoryService = createHistoryService,
  backend?: HistoryBackend,
): Promise<T> {
  return withSuffixFixtureGraph(
    size,
    (root) =>
      createCoreSuffixFixtureGraph(
        root,
        mutationOwnership,
        createService,
        backend,
      ),
    action,
    payloadBytes,
    makeRow,
  );
}
