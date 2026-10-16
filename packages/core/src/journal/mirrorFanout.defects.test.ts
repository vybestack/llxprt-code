/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { INHERIT_OWNER, type LabeledDraft } from './groupEdits.js';
import { MirrorFanout } from './mirrorFanout.js';
import { accepts } from './ownerRules.js';
import type { RowDraft } from './rowDraft.js';
import {
  expectAllMirrorsEqual,
  rigWithMirrors,
  rowRecordDigest,
  type MirrorRig,
} from './__tests__/support/mirrorFixtures.js';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import * as path from 'node:path';

const AGENT_A = 1;
const AGENT_B = 2;
/** Rows are owned by A, by B and by nobody in turn. */
const OWNERS = [AGENT_A, AGENT_B, 0] as const;

function ownedDrafts(count: number): RowDraft[] {
  return Array.from({ length: count }, (_, index) =>
    draftRow({ owner: OWNERS[index % OWNERS.length], text: `row ${index}` }),
  );
}

async function liveLabels(rig: MirrorRig): Promise<bigint[]> {
  const labels: bigint[] = [];
  for await (const entry of rig.primary.rows()) labels.push(entry.label);
  return labels;
}

/** How many rows of a mirror carry the text a rewrite gives. */
async function rewrittenIn(rig: MirrorRig, owner: number): Promise<number> {
  const mirror = rig.mirrors.get(owner);
  if (mirror === undefined) throw new Error(`no mirror for owner ${owner}`);
  let count = 0;
  for await (const entry of mirror.rows()) {
    const row = await mirror.readRow(entry);
    if (new TextDecoder().decode(row.blocks[0]).startsWith('rewritten')) {
      count += 1;
    }
  }
  return count;
}

describe('defect 3: edits over 64 rows reach the mirrors by owner (design 13.5)', () => {
  const directory = useTempDir('journal-mirror-defect3-');

  it.each([3, 64, 65, 5000])(
    'a density rewrite of %d rows gives each mirror its own rows and the unowned ones, and a clear empties both',
    async (rewritten) => {
      const rig = await rigWithMirrors(directory(), [AGENT_A, AGENT_B]);
      await rig.fanout.commit([
        { kind: 'append', rows: ownedDrafts(rewritten + 7) },
      ]);
      const labels = await liveLabels(rig);

      const replacements: LabeledDraft[] = labels
        .slice(0, rewritten)
        .map((label, index) => ({
          label,
          draft: {
            ...draftRow({ text: `rewritten ${index}` }),
            owner: INHERIT_OWNER,
          },
        }));
      await rig.fanout.commit([{ kind: 'density', replacements, removed: [] }]);
      await rig.fanout.flush();

      await expectAllMirrorsEqual(rig);
      const ownedBy = (owner: number): number =>
        OWNERS.slice(0, 3)
          .map((o, offset) => ({ o, offset }))
          .filter(({ o }) => o === owner || o === 0)
          .reduce(
            (total, { offset }) =>
              total + Math.ceil((rewritten - offset) / OWNERS.length),
            0,
          );
      expect(await rewrittenIn(rig, AGENT_A)).toBe(ownedBy(AGENT_A));
      expect(await rewrittenIn(rig, AGENT_B)).toBe(ownedBy(AGENT_B));

      await rig.fanout.commit([{ kind: 'clear' }]);
      await rig.fanout.flush();
      expect(rig.mirrors.get(AGENT_A)?.published?.rows).toBe(0);
      expect(rig.mirrors.get(AGENT_B)?.published?.rows).toBe(0);
      await rig.closeAll();
    },
    170_000,
  );
});

describe('defect 4: a row that changed hands goes to its current owner at attach (design 13.5)', () => {
  const directory = useTempDir('journal-mirror-defect4-');

  it('the attached mirror holds the rows reassigned to it and not the rows reassigned away', async () => {
    const rig = await rigWithMirrors(directory(), [], {});
    const primary = rig.primary;
    await primary.commit([{ kind: 'append', rows: ownedDrafts(9) }]);
    const labels = await liveLabels(rig);
    // Row 0 was A's, row 1 was B's. They swap owners after they were written.
    await primary.commit([
      {
        kind: 'owner',
        changes: [
          { label: labels[0], owner: AGENT_B },
          { label: labels[1], owner: AGENT_A },
        ],
      },
    ]);
    const first = await primary.readRow((await rowsOf(primary))[0]);
    expect(first.header.owner).toBe(AGENT_A);

    const fanout = new MirrorFanout(primary);
    const mirrorA = await JournalStore.create(
      path.join(directory(), 'a.llxj'),
      storeDeps(),
    );
    await fanout.attach(mirrorA, AGENT_A);
    const held = await rowsOf(mirrorA);
    const heldLabels = held.map((entry) => entry.label);
    expect(heldLabels).toContain(labels[1]);
    expect(heldLabels).not.toContain(labels[0]);
    // The whole copy is the rows whose current owner is A or nobody.
    const expectedLabels = (await rowsOf(primary))
      .filter((candidate) => accepts(AGENT_A, candidate.owner))
      .map((candidate) => candidate.label);
    expect(expectedLabels.length).toBe(heldLabels.length);
    expect(heldLabels).toStrictEqual(expectedLabels);
    const entry = held.find((candidate) => candidate.label === labels[1]);
    if (entry === undefined) throw new Error('row 1 is missing');
    expect(await rowRecordDigest(mirrorA, entry)).toBe(
      await rowRecordDigest(primary, (await rowsOf(primary))[1]),
    );
    await mirrorA.close();
    await rig.closeAll();
  });
});

async function rowsOf(store: JournalStore) {
  const rows = [];
  for await (const entry of store.rows()) rows.push(entry);
  return rows;
}
