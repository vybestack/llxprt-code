/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { collectResumeRows, displayBoot } from './resumeRows.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

describe('relocated resume row values', () => {
  it('retains decoded values after the history is cleared and disposed', async () => {
    const history = new HistoryService();
    try {
      history.addAll([suffixRow(0), suffixRow(1)]);
      await history.waitForCommit();
      const collected = await collectResumeRows(history.streamRawHistory());
      history.clear();
      await history.waitForCommit();
      history.dispose();
      gcAndSweep();
      expect(collected).toStrictEqual([suffixRow(0), suffixRow(1)]);
      const boot = displayBoot(collected);
      expect(await collectResumeRows(boot.streamRows())).toStrictEqual(
        collected,
      );
    } finally {
      history.dispose();
    }
  });

  it('propagates source failure and closes the producer without publishing partial rows', async () => {
    let closed = false;
    const failure = new Error('resume read failed');
    async function* rows() {
      try {
        yield suffixRow(0);
        throw failure;
      } finally {
        closed = true;
      }
    }
    await expect(collectResumeRows(rows())).rejects.toBe(failure);
    expect(closed).toBe(true);
  });
});
