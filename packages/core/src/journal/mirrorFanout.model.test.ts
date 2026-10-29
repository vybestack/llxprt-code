/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalStore } from './journalStore.js';
import { MirrorFanout } from './mirrorFanout.js';
import { expectMirrorEqualsFiltered } from './__tests__/support/mirrorFixtures.js';
import { storeDeps } from './__tests__/support/storeFixtures.js';
import { runModelSequence } from './__tests__/support/storeModelRun.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const SEEDS = [11, 12, 13, 14] as const;
const STEPS = 220;
const RUN_MS = 170_000;
/** The model gives rows the owners 0 to 3 and owner changes 0 to 5; three agents have mirrors. */
const AGENTS = [1, 2, 3] as const;

const PRIMITIVES = [
  'append',
  'pop',
  'compress',
  'density',
  'purge',
  'insert',
  'owner',
  'clear',
  'restore',
  'fill',
  'checkpoint',
] as const;

/** The files on disk, opened again, still agree: a mirror's trailer names what its tree holds. */
async function expectReopenedMirrorsEqual(
  seed: number,
  directory: string,
): Promise<void> {
  const primary = await JournalStore.open(
    path.join(directory, `primary-${seed}.llxj`),
    storeDeps(),
  );
  for (const agent of AGENTS) {
    const mirror = await JournalStore.open(
      path.join(directory, `mirror-${seed}-${agent}.llxj`),
      storeDeps(),
    );
    await expectMirrorEqualsFiltered(primary, mirror, agent);
    await mirror.close();
  }
  await primary.close();
}

describe('mirrors against the mutation model (design 13.6)', () => {
  const directory = useTempDir('journal-mirror-model-');

  it(
    'after every step of seeded random sequences over every primitive and owner changes, each of three mirrors equals the filtered primary: the same labels and the same ROW bytes',
    async () => {
      const total = new Map<string, number>();
      for (const seed of SEEDS) {
        const mirrors = new Map<number, JournalStore>();
        let fanout: MirrorFanout | undefined;
        const commitStep = async (
          store: JournalStore,
          edits: Parameters<JournalStore['commit']>[0],
        ) => {
          if (fanout === undefined) {
            fanout = new MirrorFanout(store);
            for (const agent of AGENTS) {
              const mirror = await JournalStore.create(
                path.join(directory(), `mirror-${seed}-${agent}.llxj`),
                storeDeps(),
              );
              mirrors.set(agent, mirror);
              await fanout.attach(mirror, agent);
            }
          }
          return fanout.commit(edits);
        };
        const result = await runModelSequence(
          path.join(directory(), `primary-${seed}.llxj`),
          seed,
          STEPS,
          async (store, _model, index) => {
            await fanout?.flush();
            for (const [agent, mirror] of mirrors) {
              try {
                await expectMirrorEqualsFiltered(store, mirror, agent);
              } catch (error) {
                throw new Error(
                  `Seed ${seed}, step ${index}: mirror ${agent} differs from the filtered primary`,
                  { cause: error },
                );
              }
            }
          },
          commitStep,
        );
        for (const mirror of mirrors.values()) await mirror.close();
        await expectReopenedMirrorsEqual(seed, directory());
        for (const [name, count] of result.counts) {
          total.set(name, (total.get(name) ?? 0) + count);
        }
      }
      const used = [...total.keys()].join(',');
      for (const primitive of PRIMITIVES) {
        expect({ primitive, used: used.includes(primitive) }).toStrictEqual({
          primitive,
          used: true,
        });
      }
      expect([...total.values()].reduce((sum, n) => sum + n, 0)).toBe(
        SEEDS.length * STEPS,
      );
    },
    RUN_MS,
  );
});
