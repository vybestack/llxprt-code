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
  it('finishes with a paused caller writer and preserves surviving pending identities', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      const caller = rollbackRow(0);
      await history.addBatch([caller]);
      const rows = new HistoryDensityRows();
      try {
        rows.appendIdentity(caller);
        await publishProviderFallbackCandidate(
          history,
          { rows, start: 0, hasPendingRows: true },
          'test',
        );
        expect((await collectRawHistory(history))[0]).toBe(caller);
        expect(caller.metadata?.chronology?.seq).toBe(1);
        releaseWriter();
        await recorder.flush();
        expect((await collectRawHistory(history))[0]).toStrictEqual(caller);
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
        expect(await collectRawHistory(history)).toStrictEqual([original]);
      } finally {
        rows.close();
      }
    });
  });
});
