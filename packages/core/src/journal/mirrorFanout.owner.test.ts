/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';
import {
  expectAllMirrorsEqual,
  rigWithMirrors,
  type MirrorRig,
} from './__tests__/support/mirrorFixtures.js';
import { draftRow } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const A = 1;
const B = 2;
const C = 3;
const AGENTS = [A, B, C] as const;
/** The row the owner changes is the fifth; rows of each owner sit before and after it. */
const LAYOUT = [A, B, C, 0, 0, A, B, C, 0] as const;
const TARGET = 4;

interface Case {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  /** Which mirrors the table says receive a delta. */
  readonly delta: Readonly<Record<number, boolean>>;
}

/** The four transitions of the table in design 5.2, with A to B written out for the other pairs too. */
const CASES: readonly Case[] = [
  {
    name: '0 to A',
    from: 0,
    to: A,
    delta: { [A]: false, [B]: true, [C]: true },
  },
  {
    name: 'A to 0',
    from: A,
    to: 0,
    delta: { [A]: false, [B]: true, [C]: true },
  },
  {
    name: 'A to B',
    from: A,
    to: B,
    delta: { [A]: true, [B]: true, [C]: false },
  },
  {
    name: 'B to C',
    from: B,
    to: C,
    delta: { [A]: false, [B]: true, [C]: true },
  },
  {
    name: 'A to A',
    from: A,
    to: A,
    delta: { [A]: false, [B]: false, [C]: false },
  },
  {
    name: '0 to 0',
    from: 0,
    to: 0,
    delta: { [A]: false, [B]: false, [C]: false },
  },
];

async function sizes(rig: MirrorRig): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (const [owner, file] of rig.files) {
    out.set(owner, (await fsp.stat(file)).size);
  }
  return out;
}

function commitSeqs(rig: MirrorRig): Map<number, number | undefined> {
  return new Map(
    [...rig.mirrors].map(([owner, mirror]) => [
      owner,
      mirror.published?.commitSeq,
    ]),
  );
}

describe('owner change fan-out (design 5.2 and 13.6)', () => {
  const directory = useTempDir('journal-mirror-owner-');

  it.each([...CASES])(
    'the change $name reaches exactly the mirrors the table names, and every mirror ends equal to the filtered primary',
    async (change) => {
      const rig = await rigWithMirrors(directory(), AGENTS);
      const owners = LAYOUT.map((owner, at) =>
        at === TARGET ? change.from : owner,
      );
      await rig.fanout.commit([
        {
          kind: 'append',
          rows: owners.map((owner, at) =>
            draftRow({ owner, text: `row ${at}` }),
          ),
        },
      ]);
      await rig.fanout.flush();
      await expectAllMirrorsEqual(rig);
      const labels: bigint[] = [];
      for await (const entry of rig.primary.rows()) labels.push(entry.label);

      const sizeBefore = await sizes(rig);
      const seqBefore = commitSeqs(rig);
      await rig.fanout.commit([
        {
          kind: 'owner',
          changes: [{ label: labels[TARGET], owner: change.to }],
        },
      ]);
      await rig.fanout.flush();

      await expectAllMirrorsEqual(rig);
      const sizeAfter = await sizes(rig);
      const seqAfter = commitSeqs(rig);
      for (const agent of AGENTS) {
        const received = seqAfter.get(agent) !== seqBefore.get(agent);
        expect({ agent, received }).toStrictEqual({
          agent,
          received: change.delta[agent],
        });
        expect({
          agent,
          grew: (sizeAfter.get(agent) ?? 0) > (sizeBefore.get(agent) ?? 0),
        }).toStrictEqual({ agent, grew: change.delta[agent] });
      }
      await rig.closeAll();
    },
  );

  it('a group that changes the owner of rows in both directions at once leaves every mirror equal to the filtered primary', async () => {
    const rig = await rigWithMirrors(directory(), AGENTS);
    await rig.fanout.commit([
      {
        kind: 'append',
        rows: LAYOUT.map((owner, at) => draftRow({ owner, text: `row ${at}` })),
      },
    ]);
    const labels: bigint[] = [];
    for await (const entry of rig.primary.rows()) labels.push(entry.label);
    await rig.fanout.commit([
      {
        kind: 'owner',
        changes: [
          { label: labels[0], owner: B },
          { label: labels[1], owner: 0 },
          { label: labels[2], owner: A },
          { label: labels[3], owner: C },
          { label: labels[8], owner: A },
        ],
      },
    ]);
    await rig.fanout.flush();
    expect(rig.fanout.mirrors).toBe(AGENTS.length);
    await expectAllMirrorsEqual(rig);
    await rig.closeAll();
  });
});
