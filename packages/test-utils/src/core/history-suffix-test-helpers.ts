/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {} from 'bun';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
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
  readonly recording: {
    commit(type: 'content', payload: { content: IContent }): Promise<object>;
    dispose(): Promise<void>;
  };
}

export async function withSuffixFixtureGraph<
  T,
  Service extends { dispose(): void },
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
    const { service, recording, ownership, counters } = createGraph(root);
    try {
      for (let index = 0; index < size; index++) {
        await recording.commit('content', {
          content: makeRow(index, payloadBytes),
        });
      }
      return await action(service, ownership, counters);
    } finally {
      service.dispose();
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
      return { service, recording, ownership, counters };
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
