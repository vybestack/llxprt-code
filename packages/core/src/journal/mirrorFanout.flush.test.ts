/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { Failures } from './__tests__/support/journalFixtures.js';
import {
  expectMirrorEqualsFiltered,
  rigWithMirrors,
} from './__tests__/support/mirrorFixtures.js';
import { draftRow } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const A = 1;
const B = 2;
const C = 3;

function rows(tag: string) {
  return {
    kind: 'append' as const,
    rows: [A, B, C, 0].map((owner) =>
      draftRow({ owner, text: `${tag} ${owner}` }),
    ),
  };
}

describe('fan-out flush (design 5.2 and 13.6)', () => {
  const directory = useTempDir('journal-mirror-flush-');

  it('awaits every mirror and reports both failures when two of three mirrors fail', async () => {
    const failures = new Map<number, Failures>([
      [B, { failFlushAt: 0 }],
      // Write 0 is the journal header; write 1 is the first group.
      [C, { failWriteAt: 1 }],
    ]);
    const rig = await rigWithMirrors(directory(), [A, B, C], { failures });
    await rig.fanout.commit([rows('one')]);
    await rig.fanout.commit([rows('two')]);

    const outcome = await rig.fanout.flush().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError)) throw new Error('not aggregated');
    expect(outcome.errors.map(String).sort()).toStrictEqual([
      'Error: injected flush failure',
      'Error: injected write failure',
    ]);

    // The mirror that did not fail applied both groups, and the failed ones took nothing after their failure.
    const good = rig.mirrors.get(A);
    if (good === undefined) throw new Error('no mirror A');
    await expectMirrorEqualsFiltered(rig.primary, good, A);
    expect(good.published?.rows).toBe(4);
    expect(rig.mirrors.get(B)?.published?.rows ?? 0).toBe(0);
    await rig.closeAll();
  });

  it('reports a single failure as that failure, and a flush with no failure resolves', async () => {
    const failures = new Map<number, Failures>([[B, { failFlushAt: 0 }]]);
    const rig = await rigWithMirrors(directory(), [A, B, C], { failures });
    await rig.fanout.commit([rows('one')]);
    await expect(rig.fanout.flush()).rejects.toThrow('injected flush failure');
    await rig.closeAll();

    const healthyDirectory = path.join(directory(), 'healthy');
    await fsp.mkdir(healthyDirectory);
    const healthy = await rigWithMirrors(healthyDirectory, [A, B, C]);
    await healthy.fanout.commit([rows('one')]);
    await healthy.fanout.flush();
    await healthy.closeAll();
  });
});
