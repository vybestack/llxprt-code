/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { suffixRow, withSuffixFixture } from './history-suffix-test-helpers.js';
import { rawHistoryAfterCommit } from './collect-raw-history.js';
import {
  forbidHistoryMaterializationForTest,
  materializeHistoryForTest,
} from './history-materialization-test-guard.js';

describe('test-only history materialization guard', () => {
  it('rejects an eager read of committed history while leaving the public stream usable', async () => {
    await withSuffixFixture(512, async (history) => {
      expect(await rawHistoryAfterCommit(history)).toHaveLength(512);
      forbidHistoryMaterializationForTest(history);
      await expect(materializeHistoryForTest(history)).rejects.toThrow(
        'eager history materialization forbidden',
      );
      let count = 0;
      for await (const row of history.streamRawHistory()) {
        expect(row.metadata?.chronology?.seq).toBe(++count);
      }
      expect(count).toBe(512);
    });
  });

  it('keeps committed detached values when a conditional guard permits reads and restores after rejection', async () => {
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
      await history.waitForCommit();
      const permitted = await materializeHistoryForTest(history);
      expect(permitted[0]).toStrictEqual(row);
      expect(permitted[0]).not.toBe(row);
      forbidden = true;
      await expect(materializeHistoryForTest(history)).rejects.toThrow(
        'conditional journal trap',
      );
      restore();
      expect((await materializeHistoryForTest(history))[0]).toStrictEqual(row);
    } finally {
      await history.dispose();
    }
  });
});
