/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  sendHistoryTurn,
  withOrchestratorHistory,
} from './orchestrator-history-test-helpers.js';

const bounds = { rows: 440, serializedBytes: 8 * 1024 * 1024 };
const requireWithinBounds =
  process.env.ORCHESTRATOR_HISTORY_RETAINING_TRAP === '1';

for (const size of [512, 8192]) {
  for (const mode of ['borrowed', 'copy'] as const) {
    describe(`invoked orchestrator retaining ${mode} at ${size}`, () => {
      it('detects a retaining stream participant and releases all of its rows', async () => {
        await withOrchestratorHistory(size, async (client, history, reader) => {
          history.retaining = mode;
          try {
            expect(await sendHistoryTurn(client)).toContain(
              'a plain text reply',
            );
            expect(history.consumer.snapshot().peakRows).toBe(size);
            expect(history.consumer.within(bounds)).toBe(requireWithinBounds);
          } finally {
            history.releaseConsumer();
            expect({
              consumer: history.consumer.snapshot().liveRows,
              reader: reader.snapshot().liveRows,
            }).toStrictEqual({ consumer: 0, reader: 0 });
          }
        });
      }, 120_000);
    });
  }
}
