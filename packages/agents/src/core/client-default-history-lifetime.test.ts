/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  StreamOnlyHistory,
  withPublicHistory,
} from '../api/__tests__/helpers/public-history-fixture.js';
import { internalConfig } from '../api/__tests__/helpers/agentHarness.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { publicDefaultBounds } from './public-default-history-test-helpers.js';

const cases = [512, 8192].flatMap((size) =>
  [false, true].map((active) => ({ size, active })),
);
for (const { size, active } of cases) {
  describe(`default reader lifetime ${size} active=${active}`, () => {
    it('holds one outward row while the writer commits without changing pinned membership', async () => {
      await withPublicHistory(
        size,
        active,
        async (agent, history, reader, decoded) => {
          const client = internalConfig(agent).getAgentClient();
          const cursor = client.getHistory();
          const first = await cursor.next();
          expect(first.value).toStrictEqual(accountingRow(0));
          try {
            history.add(accountingRow(size));
            await history.waitForCommit();
            await delay(10);
            expect({
              decoded: decoded(),
              held: reader.snapshot().liveRows,
            }).toStrictEqual({ decoded: 1, held: 1 });
            let count = 1;
            for await (const _row of cursor) count++;
            expect(count).toBe(size);
          } finally {
            await cursor.return();
          }
          let current = 0;
          for await (const _row of client.getHistory(false)) current++;
          expect(current).toBe(size + 1);
          expect(reader.within(publicDefaultBounds)).toBe(true);
          expect(reader.snapshot().liveRows).toBe(0);
        },
      );
    }, 120_000);

    it('closes the reader on source failure, consumer failure, return and abort', async () => {
      await withPublicHistory(
        size,
        active,
        async (agent, history, reader, decoded) => {
          if (!(history instanceof StreamOnlyHistory))
            throw new Error('Expected controlled history');
          const client = internalConfig(agent).getAgentClient();
          history.failAfter = 3;
          let sourceRows = 0;
          async function consumeSource(): Promise<void> {
            for await (const _row of client.getHistory()) sourceRows++;
          }
          await expect(consumeSource()).rejects.toThrow('raw source fault');
          expect(sourceRows).toBe(3);
          history.failAfter = undefined;
          async function consumeFault(): Promise<void> {
            for await (const _row of client.getHistory())
              throw new Error('outward consumer fault');
          }
          await expect(consumeFault()).rejects.toThrow(
            'outward consumer fault',
          );
          const returned = client.getHistory();
          await returned.next();
          await returned.return();
          const controller = new AbortController();
          const aborted = client.getHistory(false, controller.signal);
          await aborted.next();
          controller.abort(new Error('outward abort'));
          await expect(aborted.next()).rejects.toThrow('outward abort');
          expect({
            decoded: decoded(),
            held: reader.snapshot().liveRows,
          }).toStrictEqual({ decoded: 6, held: 0 });
          expect(reader.within(publicDefaultBounds)).toBe(true);
        },
      );
    }, 120_000);
  });
}
