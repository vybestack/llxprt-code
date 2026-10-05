/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { Config } from './config.js';
import { createTestAgentClient } from '../test-utils/config.js';
import { withSuffixFixture } from '../services/history/history-suffix-test-helpers.js';
import { accountingRow } from '../services/history/token-accounting-stream-test-helpers.js';

for (const size of [512, 8192]) {
  describe(`configuration history verification with ${size} rows`, () => {
    it('finishes auth-state publication while raw arrays are unavailable', async () => {
      await withSuffixFixture(
        size,
        async (history, reader, counters) => {
          const config = new Config({
            sessionId: 'history-report',
            targetDir: tmpdir(),
            cwd: tmpdir(),
            debugMode: false,
            model: 'test-model',
            agentClientFactory: () =>
              createTestAgentClient({
                getHistory: () => {
                  throw new Error('history report must not materialize');
                },
                streamHistory: (signal) => history.streamRawHistory(signal),
                getHistoryService: () => history,
              }),
          });
          config.setFallbackMode(true);
          await config.initializeContentGeneratorConfig();
          expect(config.isInFallbackMode()).toBe(false);
          expect(config.getContentGeneratorConfig()?.model).toBe('test-model');
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
