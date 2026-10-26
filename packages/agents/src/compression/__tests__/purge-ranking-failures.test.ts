/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/__tests__/support/transform-value-fixtures-test-helpers.js';
import {
  expectedRange,
  rejectedValue,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import {
  transformPhaseSampler,
  transformProbes,
  withValueTransformFixture,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import {
  prepareValueRoute,
  purgeRankingRow,
  purgeRankingRows,
  type ValueRoute,
} from './purge-ranking-value-helpers.js';

async function observeFailure(
  route: ValueRoute,
  size: number,
  kind: string,
): Promise<number> {
  return withValueTransformFixture(
    async ({ history, recorder, owners, io }) => {
      const probes = transformProbes();
      const sample = transformPhaseSampler(route, size, owners, probes);
      await history.detachedValues.replace(
        probedTransformInput(size, purgeRankingRow, owners, probes),
      );
      const before = await detachedDigest(purgeRankingRows(size));
      const tokens = size * 2 + 1000;
      const range = expectedRange(size);
      expect(history.getTotalTokens()).toBe(tokens);
      expect(history.getContextRange()).toStrictEqual(range);
      const prepared = await prepareValueRoute(history, route, size, owners);
      const failure = new Error(`external ${kind} failure`);
      const scratch = fs.readdirSync(getScratchRoot());
      let restore = (): void => {};
      let result: unknown;
      try {
        if (kind === 'read') {
          const fault = spyOn(fs, 'readSync').mockImplementationOnce(() => {
            throw failure;
          });
          restore = () => fault.mockRestore();
        } else if (kind === 'write' && route === 'ranking') {
          const fault = spyOn(fs, 'writeSync').mockImplementationOnce(() => {
            throw failure;
          });
          restore = () => fault.mockRestore();
        } else {
          io.rejectNextWrite(
            failure,
            kind === 'trailer' ? 'trailer' : 'records',
          );
        }
        result = await rejectedValue(prepared.execute().then(() => {}));
      } finally {
        restore();
        await prepared.close();
      }
      expect(result).toBe(failure);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        before,
      );
      await history.waitForCommit();
      expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
      expect(history.getTotalTokens()).toBe(tokens);
      expect(history.getContextRange()).toStrictEqual(range);
      await sample(`${kind}-failure-released`);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(
        fs
          .readdirSync(getScratchRoot())
          .filter(
            (name) =>
              /^(history-detached-|history-density-|tool-response-ranking-)/.test(
                name,
              ) && !scratch.includes(name),
          ),
      ).toStrictEqual([]);
      return before.count;
    },
  );
}

describe('real purge and ranking failures preserve complete membership', () => {
  for (const route of ['purge', 'ranking'] satisfies ValueRoute[])
    for (const kind of ['read', 'write', 'trailer']) {
      const size = route === 'purge' && kind === 'read' ? 512 : 65;
      it(`${route} preserves values, tokens and visibility at ${size} on ${kind} failure`, async () => {
        expect(await observeFailure(route, size, kind)).toBe(size);
      }, 120_000);
    }
});
