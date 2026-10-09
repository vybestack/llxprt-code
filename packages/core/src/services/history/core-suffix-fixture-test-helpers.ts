/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  suffixRow,
  withSuffixFixtureGraph,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  createRowCounters,
  type RowCounters,
} from '../../recording/journalCounters.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import {
  HistoryService,
  type HistoryServiceJournalOptions,
} from './HistoryService.js';
import type { IContent } from './IContent.js';

export interface CoreSuffixFixtureGraph {
  readonly service: HistoryService;
  readonly recording: SessionRecordingService;
  readonly ownership: RowOwnership;
  readonly mutationOwnership: RowOwnership;
  readonly counters: RowCounters;
}

function createHistoryService(
  options: HistoryServiceJournalOptions,
): HistoryService {
  return new HistoryService(options);
}

export function createCoreSuffixFixtureGraph(
  root: string,
  mutationOwnership = new RowOwnership(),
  createService: (
    options: HistoryServiceJournalOptions,
  ) => HistoryService = createHistoryService,
): CoreSuffixFixtureGraph {
  const recording = new SessionRecordingService({
    sessionId: 'suffix-test',
    projectHash: 'suffix-test',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const ownership = new RowOwnership();
  const counters = createRowCounters();
  const service = createService({
    recording,
    attachmentCounters: { ...counters.counters, ownership },
    mutationOwnership,
  });
  return { service, recording, ownership, mutationOwnership, counters };
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
): Promise<T> {
  return withSuffixFixtureGraph(
    size,
    (root) =>
      createCoreSuffixFixtureGraph(root, mutationOwnership, createService),
    action,
    payloadBytes,
    makeRow,
  );
}
