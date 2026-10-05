/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withPublicHistory } from './helpers/public-history-fixture.js';

const bounds = { rows: 440, serializedBytes: 8 * 1024 * 1024 };
const requiredWithinBounds = process.env.PUBLIC_HISTORY_RETAINING_TRAP === '1';

async function retainingControl(
  size: number,
  distinctCopy: boolean,
): Promise<number> {
  return withPublicHistory(size, false, async (agent, _history, reader) => {
    const consumer = new RowOwnership();
    const retained: IContent[] = [];
    try {
      for await (const row of agent.streamHistory()) {
        const owned = distinctCopy ? { ...row, blocks: [...row.blocks] } : row;
        consumer.retain(owned);
        retained.push(owned);
      }
      expect(consumer.snapshot().peakRows).toBe(size);
      expect(consumer.snapshot().peakRows).toBeGreaterThan(bounds.rows);
      expect(
        consumer.snapshot().peakSerializedBytes > bounds.serializedBytes,
      ).toBe(size === 8192);
      expect(consumer.within(bounds)).toBe(requiredWithinBounds);
    } finally {
      for (const row of retained) consumer.release(row);
      retained.length = 0;
      expect({
        consumer: consumer.snapshot().liveRows,
        reader: reader.snapshot().liveRows,
      }).toStrictEqual({ consumer: 0, reader: 0 });
    }
    return consumer.snapshot().acquisitions;
  });
}

for (const size of [512, 8192]) {
  for (const distinctCopy of [false, true]) {
    describe(`public agent retaining ${distinctCopy ? 'copies' : 'borrowed rows'} at ${size}`, () => {
      it('detects full-history consumer retention and releases every charged object', async () => {
        expect(await retainingControl(size, distinctCopy)).toBe(size);
      }, 120_000);
    });
  }
}
