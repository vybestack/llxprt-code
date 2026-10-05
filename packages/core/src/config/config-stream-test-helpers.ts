/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import type { ContentGeneratorConfig } from '../core/contentGenerator.js';
import type { DeferredHistorySourceOptions } from '../core/clientContract.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';

export const configHistoryJournals = new Set<HistoryService>();
export function configHistoryRows(...rows: IContent[]): IContent[] {
  return rows.map((row, index) => ({
    ...row,
    metadata: {
      ...row.metadata,
      chronology: {
        seq: index + 1,
        userTurn: 1,
        step: index + 1,
        recordedAt: 0,
      },
    },
  }));
}

export async function readConfigHistory(
  source: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of source) rows.push(row);
  return rows;
}

export function captureConfigHistory(): {
  streamHistory: (
    signal?: AbortSignal,
  ) => AsyncGenerator<IContent, void, unknown>;
  storeHistoryForLaterUse: ReturnType<
    typeof vi.fn<
      (
        source: AsyncIterable<IContent>,
        options?: DeferredHistorySourceOptions,
      ) => Promise<void>
    >
  >;
  initialize: ReturnType<
    typeof vi.fn<
      (
        config: ContentGeneratorConfig,
        options?: DeferredHistorySourceOptions,
      ) => Promise<void>
    >
  >;
  initializedHistoryCount: () => number;
} {
  const journal = new HistoryService();
  configHistoryJournals.add(journal);
  let countAtInitialize = 0;
  return {
    streamHistory: (signal) => journal.streamRawHistory(signal),
    storeHistoryForLaterUse: vi.fn(async (source, options = {}) => {
      await journal.transformRows(
        async (_previous, sink) => {
          for await (const row of source) {
            options.signal?.throwIfAborted();
            sink.appendDetached(row);
          }
        },
        undefined,
        { signal: options.signal, awaitDurableCommit: true },
      );
    }),
    initialize: vi.fn(async (_config, options = {}) => {
      for await (const _row of journal.streamRawHistory(options.signal)) {
        countAtInitialize++;
      }
    }),
    initializedHistoryCount: () => countAtInitialize,
  };
}

export function disposeConfigHistoryJournals(): void {
  for (const journal of configHistoryJournals) journal.dispose();
  configHistoryJournals.clear();
}
