/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {} from 'bun';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';
import { isJsonlRecorder } from '@vybestack/llxprt-code-core/services/history/recorderBackend.js';
import { createRecorderForTest } from './recorder-for-test.js';
import {
  HistoryService,
  type HistoryServiceJournalOptions,
} from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export function suffixRow(index: number, payloadBytes = 0): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `${index}:${'x'.repeat(payloadBytes)}` }],
    metadata: {
      chronology: {
        seq: index + 1,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
    },
  };
}

export function rowIndex(row: IContent): number {
  const block = row.blocks[0];
  if (block.type !== 'text') throw new Error('Expected a text row');
  return Number(block.text.split(':')[0]);
}

export function tokenWeight(row: IContent): number {
  return rowIndex(row) % 7;
}

export interface SuffixFixtureGraph<Service, Ownership, Counters> {
  readonly service: Service;
  readonly ownership: Ownership;
  readonly counters: Counters;
  readonly recording: { dispose(): Promise<void> };
  /** Puts the rows into the history, durably, before the action runs. */
  seed(rows: Iterable<IContent>): Promise<void>;
}

const SEED_BATCH_ROWS = 256;

function isHistoricalRowWriter(value: unknown): value is {
  apply(op: { kind: 'content'; content: IContent }): void;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'apply' in value &&
    typeof value.apply === 'function'
  );
}

function writeHistoricalRow(service: object, row: IContent): void {
  const journal: unknown = Reflect.get(service, 'journal');
  if (!isHistoricalRowWriter(journal))
    throw new Error('Historical suffix rows require a journal store');
  journal.apply({ kind: 'content', content: row });
}

/**
 * How a fixture's rows reach its history, by the kind of recorder it was given.
 * The old backend reads a history out of the recorder's file, so the rows are
 * committed to the recorder before the first read. The journal backend writes
 * the recorder as a mirror of the history, so the rows are added to the
 * history and the recorder follows. Every journal operation is its own durable
 * commit, so runs of ordinary rows go in as batches (one commit each, and no
 * more than a batch in memory). Historical zero-block rows bypass admission
 * through the real store, just as legacy fixtures write the recorder directly.
 * Both `add` and `addBatch` reject new zero-block turns.
 */
export function suffixSeeder(
  recording: SessionRecordingPort,
  service: {
    add(row: IContent): void;
    addBatch(rows: readonly IContent[]): Promise<void>;
    waitForCommit(): Promise<void>;
  },
): (rows: Iterable<IContent>) => Promise<void> {
  if (!isJsonlRecorder(recording)) {
    return async (rows) => {
      let run: IContent[] = [];
      const flush = async (): Promise<void> => {
        if (run.length === 0) return;
        const batch = run;
        run = [];
        await service.addBatch(batch);
      };
      for (const row of rows) {
        if (row.blocks.length === 0) {
          await flush();
          writeHistoricalRow(service, row);
          continue;
        }
        run.push(row);
        if (run.length === SEED_BATCH_ROWS) await flush();
      }
      await flush();
      await service.waitForCommit();
    };
  }
  return async (rows) => {
    for (const row of rows) await recording.commit('content', { content: row });
  };
}

export async function withSuffixFixtureGraph<
  T,
  Service extends { dispose(): void | Promise<void> },
  Ownership,
  Counters,
>(
  size: number,
  createGraph: (
    root: string,
  ) => SuffixFixtureGraph<Service, Ownership, Counters>,
  action: (
    service: Service,
    ownership: Ownership,
    counters: Counters,
  ) => Promise<T>,
  payloadBytes = 0,
  makeRow: (index: number, payloadBytes: number) => IContent = suffixRow,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'history-suffix-test-'));
  try {
    const { service, recording, ownership, counters, seed } = createGraph(root);
    try {
      await seed(
        (function* (): Generator<IContent> {
          for (let index = 0; index < size; index++)
            yield makeRow(index, payloadBytes);
        })(),
      );
      return await action(service, ownership, counters);
    } finally {
      await service.dispose();
      await recording.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export async function withSuffixFixture<T>(
  size: number,
  action: (
    service: HistoryService,
    ownership: RowOwnership,
    counters: ReturnType<typeof createRowCounters>,
  ) => Promise<T>,
  payloadBytes = 0,
  makeRow: (index: number, payloadBytes: number) => IContent = suffixRow,
  mutationOwnership?: RowOwnership,
  createService: (options: HistoryServiceJournalOptions) => HistoryService = (
    options,
  ) => new HistoryService(options),
): Promise<T> {
  return withSuffixFixtureGraph(
    size,
    (root) => {
      const recording = createRecorderForTest({
        sessionId: 'suffix-test',
        projectHash: 'suffix-test',
        chatsDir: root,
      });
      const ownership = new RowOwnership();
      const counters = createRowCounters();
      const service = createService({
        recording,
        attachmentCounters: { ...counters.counters, ownership },
        mutationOwnership,
      });
      return {
        service,
        recording,
        ownership,
        counters,
        seed: suffixSeeder(recording, service),
      };
    },
    action,
    payloadBytes,
    makeRow,
  );
}

export async function indices(
  stream: AsyncIterable<IContent>,
): Promise<number[]> {
  const result: number[] = [];
  for await (const row of stream) result.push(rowIndex(row));
  return result;
}
