/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { AgentClientContract } from '../core/clientContract.js';
import { createHistoryReportClient } from './history-report-client-test-helpers.js';
import { withCoreSuffixFixture } from '../services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

describe('source history report client fixture', () => {
  it('initializes the report client by traversing the real source journal and leaves it usable', async () => {
    await withCoreSuffixFixture(3, async (history, owner, counters) => {
      const client: AgentClientContract = createHistoryReportClient(history);
      await client.initialize({ model: 'test-model' });
      let traversed = 0;
      for await (const _row of client.streamHistory()) traversed++;
      expect(traversed).toBe(3);
      expect(client.isInitialized()).toBe(true);
      expect(counters.snapshot().rowsDecoded).toBe(3);
      await client.dispose();
      expect(client.isInitialized()).toBe(false);
      history.add(suffixRow(3));
      await history.waitForCommit();
      let seen = 0;
      for await (const row of history.streamRawHistory())
        expect(row).toStrictEqual(suffixRow(seen++));
      expect(seen).toBe(4);
      expect(owner.snapshot().liveRows).toBe(0);
    });
  });

  it('keeps traversal cold and releases source cursor owners on cancellation', async () => {
    await withCoreSuffixFixture(3, async (history, owner, counters) => {
      const client: AgentClientContract = createHistoryReportClient(history);
      const controller = new AbortController();
      const cursor = client.streamHistory(controller.signal);
      expect(counters.snapshot().rowsDecoded).toBe(0);
      const first = await cursor.next();
      expect(first.value).toStrictEqual(suffixRow(0));
      expect(owner.snapshot().liveRows).toBe(1);
      const failure = new Error('report cursor cancelled');
      controller.abort(failure);
      await expect(cursor.next()).rejects.toBe(failure);
      expect(owner.snapshot().liveRows).toBe(0);
      let count = 0;
      for await (const row of client.streamHistory())
        expect(row).toStrictEqual(suffixRow(count++));
      expect(count).toBe(3);
    });
  });

  it('rejects aborted initialization and unsupported eager history access without acquiring rows', async () => {
    await withCoreSuffixFixture(1, async (history, owner) => {
      const client: AgentClientContract = createHistoryReportClient(history);
      const controller = new AbortController();
      const failure = new Error('report initialization cancelled');
      controller.abort(failure);
      await expect(
        client.initialize(
          { model: 'test-model' },
          { signal: controller.signal },
        ),
      ).rejects.toBe(failure);
      expect(client.isInitialized()).toBe(false);
      expect(() => client.getHistory()).toThrow(
        'history report must not materialize',
      );
      expect(() => client.getContentGenerator()).toThrow(
        'History report fixture does not support agent operations',
      );
      expect(owner.snapshot().acquisitions).toBe(0);
    });
  });
});
