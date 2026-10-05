/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { withPublicHistory } from './helpers/public-history-fixture.js';

const bounds = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

async function verifyPause(size: number, active: boolean): Promise<number> {
  return withPublicHistory(
    size,
    active,
    async (agent, history, owners, decoded) => {
      const cursor = agent.streamHistory();
      const first = await cursor.next();
      if (first.done === true) throw new Error('Missing first public row');
      owners.retain(first.value);
      try {
        expect(first.value).toStrictEqual(accountingRow(0));
        expect(decoded()).toBe(1);
        await delay(10);
        expect(decoded()).toBe(1);
        const before = owners.snapshot();
        history.clear();
        const afterClear = owners.snapshot();
        await delay(10);
        const output = process.env.PUBLIC_HISTORY_PAUSE_OUTPUT;
        if (output !== undefined)
          appendFileSync(
            output,
            `${JSON.stringify({ size, active, decoded: decoded(), before, afterClear, paused: owners.snapshot() })}\n`,
          );
        expect(owners.snapshot().liveRows).toBe(1);
        expect(owners.snapshot().peakRows).toBeLessThanOrEqual(2);
        expect(owners.within(bounds)).toBe(true);
        expect(decoded()).toBe(1);
        expect((await cursor.next()).value).toStrictEqual(accountingRow(1));
        expect(decoded()).toBe(2);
      } finally {
        await cursor.return();
        expect(owners.snapshot().liveRows).toBe(1);
        owners.release(first.value);
      }
      expect(owners.snapshot().liveRows).toBe(0);
      expect((await agent.streamHistory().next()).done).toBe(true);
      return decoded();
    },
  );
}

for (const size of [512, 8192]) {
  for (const active of [false, true]) {
    describe(`paused public ${active ? 'active' : 'stored'} history at ${size}`, () => {
      it('keeps the returned row charged while clear reads only indexed chronology boundaries', async () => {
        expect(await verifyPause(size, active)).toBe(2);
      }, 120_000);
    });
  }
}
