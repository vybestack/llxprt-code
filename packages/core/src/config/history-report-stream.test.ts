/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '../debug/index.js';
import type { AgentClientContract } from '../core/clientContract.js';
import {
  extractExistingState,
  prepareAgentClientReplacement,
} from './agentClientLifecycle.js';
import { createHistoryReportClient } from './history-report-client-test-helpers.js';
import { withCoreSuffixFixture } from '../services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { accountingRow } from '../services/history/__tests__/support/token-accounting-stream-test-helpers.js';

for (const size of [512, 8192]) {
  describe(`configuration history verification with ${size} rows`, () => {
    it('finishes client replacement while raw arrays are unavailable', async () => {
      await withCoreSuffixFixture(
        size,
        async (history, reader, counters) => {
          const logger = new DebugLogger('llxprt:test:history-report');
          const previous = createHistoryReportClient(history);
          await previous.initialize({ model: 'test-model' });
          expect(previous.isInitialized()).toBe(true);
          let replacementInitialized = false;
          let storedRows = 0;
          const replacement: AgentClientContract = createHistoryReportClient(
            history,
            {
              storeHistoryForLaterUse: async (rows) => {
                for await (const _row of rows) storedRows++;
              },
              initialize: async () => {
                replacementInitialized = true;
              },
              isInitialized: () => replacementInitialized,
              dispose: async () => {
                replacementInitialized = false;
              },
            },
          );
          const existing = await extractExistingState(logger, previous);
          const transferred = await prepareAgentClientReplacement(
            logger,
            replacement,
            previous,
            existing.history,
            existing.historyService,
            { model: 'test-model' },
            undefined,
          );
          expect(transferred).toBe(size);
          expect(storedRows).toBe(size);
          expect(replacement.isInitialized()).toBe(true);
          expect(previous.isInitialized()).toBe(false);
          expect({
            decoded: counters.snapshot().rowsDecoded,
            live: reader.snapshot().liveRows,
          }).toStrictEqual({ decoded: size, live: 0 });
          expect(
            reader.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
        },
        2048,
        accountingRow,
      );
    }, 120_000);
  });
}
