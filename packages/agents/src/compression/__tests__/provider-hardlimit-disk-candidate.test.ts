/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import {
  withRollbackFixture,
  rollbackRow,
} from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';

describe('disk provider candidate pending publication', () => {
  it('publishes a detached provider candidate with correct durable values', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      const caller = rollbackRow(0);
      const adding = history.addBatch([caller]);
      releaseWriter();
      await adding;
      const rows = new HistoryDensityRows();
      try {
        rows.appendSanitized(caller);
        await publishProviderFallbackCandidate(
          history,
          { rows, start: 0, hasPendingRows: true },
          'test',
        );
        await recorder.flush();
        const published = (await collectRawHistory(history))[0];
        expect(published).not.toBe(caller);
        expect(published.blocks).toStrictEqual(caller.blocks);
      } finally {
        rows.close();
      }
    }, true);
  }, 10000);
  it('rejects an invalid disk range before mutation', async () => {
    await withRollbackFixture(async (history) => {
      const original = rollbackRow(0);
      await history.addBatch([original]);
      const rows = new HistoryDensityRows();
      try {
        rows.append(rollbackRow(1));
        await expect(
          publishProviderFallbackCandidate(
            history,
            { rows, start: -1, hasPendingRows: false },
            'test',
          ),
        ).rejects.toThrow('Invalid provider fallback candidate range');
        expect(await collectRawHistory(history)).toMatchObject([original]);
      } finally {
        rows.close();
      }
    });
  });
});
