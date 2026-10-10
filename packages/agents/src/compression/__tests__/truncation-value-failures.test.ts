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
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  executeTruncation,
  truncationValueRow,
  truncationValues,
} from './truncation-value-helpers.js';

import { highdensitySetup } from './highdensity-disk-helpers.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

async function fault(
  size: number,
  kind: 'read' | 'write' | 'cancel',
  route: 'truncation' | 'highdensity',
): Promise<number> {
  return withValueTransformFixture(async ({ history, recorder, owners }) => {
    const probes = transformProbes();
    await history.detachedValues.replace(
      probedTransformInput(size, truncationValueRow, owners, probes),
    );
    const expected = await detachedDigest(truncationValues(size));
    const scratch = fs.readdirSync(getScratchRoot());
    const failure =
      kind === 'cancel'
        ? new DOMException('cancelled checkpoint source', 'AbortError')
        : new Error(`external checkpoint ${kind} failure`);
    const injected = spyOn(
      fs,
      kind === 'write' ? 'writeSync' : 'readSync',
    ).mockImplementationOnce(() => {
      throw failure;
    });
    let result: unknown;
    try {
      result = await rejectedValue(
        (route === 'truncation'
          ? executeTruncation(history, size)
          : highdensitySetup(history).handler.performCompression('source-fault')
        ).then(() => {}),
      );
    } finally {
      injected.mockRestore();
    }
    expect(result).toBe(failure);
    expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
      expected,
    );
    expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
    expect(history.getTotalTokens()).toBe(size);
    await transformPhaseSampler(
      `truncation-${kind}`,
      size,
      owners,
      probes,
    )('released');
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
      true,
    );
    expect(
      fs
        .readdirSync(getScratchRoot())
        .filter(
          (name) =>
            /^(history-detached-|history-density-)/.test(name) &&
            !scratch.includes(name),
        ),
    ).toStrictEqual([]);
    return expected.count;
  });
}

describe('truncation/highdensity external checkpoint I/O cleanup', () => {
  for (const route of ['truncation', 'highdensity'] satisfies Array<
    'truncation' | 'highdensity'
  >)
    for (const size of [512, 8192])
      for (const kind of ['read', 'write', 'cancel'] satisfies Array<
        'read' | 'write' | 'cancel'
      >) {
        it(`${route} releases scratch and preserves complete ${size}-row history on ${kind} failure`, async () => {
          expect(await fault(size, kind, route)).toBe(size);
        }, 120_000);
      }
});
