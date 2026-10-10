/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import {
  withValueTransformFixture,
  transformProbes,
  transformPhaseSampler,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers-fixtures.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import {
  rejectedValue,
  expectedRange,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  purgeRankingRows,
  purgeRankingRow,
  prepareValueRoute,
  type ValueRoute,
} from './purge-ranking-value-helpers.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

async function observeFailure(
  route: ValueRoute,
  size: number,
  kind: string,
): Promise<number> {
  return withValueTransformFixture(async ({ history, recorder, owners }) => {
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
      } else if (kind === 'write') {
        const fault = spyOn(fs, 'writeSync').mockImplementationOnce(() => {
          throw failure;
        });
        restore = () => fault.mockRestore();
      } else recorder.failAdmissionAfter(3);
      result = await rejectedValue(prepared.execute().then(() => {}));
    } finally {
      restore();
      prepared.close();
    }
    expect(result).toBe(kind === 'admission' ? recorder.failure : failure);
    expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
      before,
    );
    expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
    expect(history.getTotalTokens()).toBe(tokens);
    expect(history.getContextRange()).toStrictEqual(range);
    await sample(`${kind}-failure-released`);
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
      true,
    );
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
  });
}

describe('real purge and ranking failures preserve complete membership', () => {
  for (const route of ['purge', 'ranking'] satisfies ValueRoute[])
    for (const size of [512, 8192])
      for (const kind of ['read', 'write', 'admission'])
        it(`${route} preserves values, tokens and visibility at ${size} on ${kind} failure`, async () => {
          expect(await observeFailure(route, size, kind)).toBe(size);
        }, 120_000);
});
