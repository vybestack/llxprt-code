/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { runModelSequence } from './__tests__/support/storeModelRun.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const SEEDS = [1, 2, 3, 4] as const;
const STEPS = 220;
/** The four seeds together stay well under the two minutes a file may take. */
const RUN_MS = 170_000;

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

describe('mutation model (design 13.6)', () => {
  const directory = useTempDir('journal-model-');

  it(
    'matches an array model after every step of seeded random sequences over every primitive: rows, owners, root aggregate and the facts of every id',
    async () => {
      const total = new Map<string, number>();
      for (const seed of SEEDS) {
        const result = await runModelSequence(
          path.join(directory(), `model-${seed}.llxj`),
          seed,
          STEPS,
        );
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
      expect(used).toContain('replace');
      expect(used).toContain('+');
      expect([...total.values()].reduce((sum, n) => sum + n, 0)).toBe(
        SEEDS.length * STEPS,
      );
    },
    RUN_MS,
  );
});
