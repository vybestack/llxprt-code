/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  expectMirrorEqualsFiltered,
  rigWithMirrors,
} from './__tests__/support/mirrorFixtures.js';
import { draftRow } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const A = 1;
const B = 2;

function rows(tag: string) {
  return {
    kind: 'append' as const,
    rows: [A, B, 0].map((owner) =>
      draftRow({ owner, text: `${tag} ${owner}` }),
    ),
  };
}

describe('fan-out detach and detailed commit', () => {
  const directory = useTempDir('journal-mirror-detach-');

  it('returns the versions around the group it committed, with and without mirrors', async () => {
    const rig = await rigWithMirrors(directory(), [A], { attach: false });
    const bare = await rig.fanout.commitDetailed([rows('bare')]);
    expect(bare.before).toBeUndefined();
    expect(bare.after.rows).toBe(3);

    await rig.fanout.attach(rig.mirrors.get(A)!, A);
    const mirrored = await rig.fanout.commitDetailed([rows('mirrored')]);
    expect(mirrored.before?.rows).toBe(3);
    expect(mirrored.after.rows).toBe(6);
    await rig.fanout.flush();
    await expectMirrorEqualsFiltered(rig.primary, rig.mirrors.get(A)!, A);
    await rig.closeAll();
  });

  it('applies what was delivered before the unbind and nothing after it', async () => {
    const rig = await rigWithMirrors(directory(), [A, B]);
    const mirror = rig.mirrors.get(A)!;
    await rig.fanout.commit([rows('one')]);

    expect(rig.fanout.has(mirror)).toBe(true);
    expect(await rig.fanout.detach(mirror)).toBe(true);
    expect(rig.fanout.has(mirror)).toBe(false);
    expect(rig.fanout.mirrors).toBe(1);
    await rig.fanout.commit([rows('two')]);
    await rig.fanout.flush();

    expect(mirror.published?.rows).toBe(2);
    await expectMirrorEqualsFiltered(rig.primary, rig.mirrors.get(B)!, B);
    expect(await rig.fanout.detach(mirror)).toBe(false);
    await rig.closeAll();
  });
});
