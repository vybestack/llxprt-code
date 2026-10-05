/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '../services/history/HistoryService.js';
import {
  suffixRow,
  withSuffixFixture,
} from '../services/history/history-suffix-test-helpers.js';
import { observeHistorySynchronouslyForTest } from './synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from './history-materialization-test-guard.js';

describe('test-only history materialization guard', () => {
  it('rejects an eager read of committed history while leaving the public stream usable', async () => {
    await withSuffixFixture(512, async (history) => {
      expect(observeHistorySynchronouslyForTest(history)).toHaveLength(512);
      forbidHistoryMaterializationForTest(history);
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'eager history materialization forbidden',
      );
      let count = 0;
      for await (const row of history.streamRawHistory()) {
        expect(row.metadata?.chronology?.seq).toBe(++count);
      }
      expect(count).toBe(512);
    });
  });

  it('keeps same-turn identities when a conditional guard permits reads and restores after rejection', () => {
    const history = new HistoryService();
    const row = suffixRow(0);
    let forbidden = false;
    try {
      history.add(row);
      const restore = forbidHistoryMaterializationForTest(
        history,
        'conditional journal trap',
        () => forbidden,
      );
      const permitted = observeHistorySynchronouslyForTest(history);
      expect(permitted[0]).toBe(row);
      forbidden = true;
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'conditional journal trap',
      );
      restore();
      expect(observeHistorySynchronouslyForTest(history)[0]).toBe(row);
    } finally {
      history.dispose();
    }
  });
});
