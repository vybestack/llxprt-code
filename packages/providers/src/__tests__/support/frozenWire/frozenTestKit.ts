/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the test body shared by the per-format files. Each
 * format has its own test file so a run stays far below the per-test limit.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { PINNED_CLOCK } from '../wireBodyFixtures.js';
import {
  SEEDS_PER_FORMAT,
  caseOf,
  formatById,
  type FrozenFormat,
} from './frozenCases.js';
import {
  FixtureBuilder,
  describeCaseDifference,
  fixtureCaseOf,
  isFrozenUpdateRequested,
  readFrozenFixture,
  writeFrozenFixture,
  type FrozenFixture,
} from './frozenFixture.js';
import { sendCase } from './frozenSend.js';

const CHUNK = 1000;
const DESCRIPTION =
  'Frozen request-body hashes and lengths of the pre-#854 builders (issue #854 phase 0). ' +
  'Regenerate only deliberately with FROZEN_WIRE_CORPUS_UPDATE=1; never in CI.';

async function regenerate(
  format: FrozenFormat,
  first: number,
  last: number,
  fixture: FrozenFixture | undefined,
  builder: FixtureBuilder,
): Promise<string[]> {
  const differences: string[] = [];
  for (let seed = first; seed < last; seed += 1) {
    const frozen = await caseOf(format, seed);
    const outcome = await sendCase(format, frozen);
    builder.add(seed, frozen.settings, outcome);
    if (fixture === undefined) continue;
    const expected = fixture.cases[seed];
    const actual = fixtureCaseOf(seed, expected[1], outcome);
    const settingsDrift =
      JSON.stringify(fixture.settings[expected[1]]) !==
      JSON.stringify(frozen.settings);
    const difference = describeCaseDifference(expected, actual);
    if (settingsDrift) differences.push(`seed ${seed}: settings draw changed`);
    if (difference !== undefined) differences.push(difference);
  }
  return differences;
}

function describeControls(format: FrozenFormat): void {
  describe('controls', () => {
    it('is deterministic: the same case twice yields the same outcome', async () => {
      const frozen = await caseOf(format, 7);
      expect(await sendCase(format, frozen)).toStrictEqual(
        await sendCase(format, frozen),
      );
    });

    it('trap: a changed history changes the recorded hash', async () => {
      const frozen = await caseOf(format, 7);
      const perturbed = {
        ...frozen,
        rows: [...frozen.rows, frozen.rows[frozen.rows.length - 1]],
      };
      expect(await sendCase(format, perturbed)).not.toStrictEqual(
        await sendCase(format, frozen),
      );
    });
  });
}

export function defineFrozenFormatTests(formatId: string): void {
  const format = formatById(formatId);
  const update = isFrozenUpdateRequested(process.env);
  const fixture = update ? undefined : readFrozenFixture(formatId);
  const builder = new FixtureBuilder();

  describe(`frozen wire corpus: ${formatId}`, () => {
    beforeAll(() => {
      setSystemTime(new Date(PINNED_CLOCK));
    });

    afterAll(() => {
      setSystemTime();
      if (!update) return;
      writeFrozenFixture(
        builder.build(
          {
            format: formatId,
            description: DESCRIPTION,
            pinnedClock: PINNED_CLOCK,
          },
          SEEDS_PER_FORMAT,
        ),
      );
    });

    it('the fixture holds every seed once, in order, with known settings', () => {
      if (fixture === undefined) return;
      expect(fixture.format).toBe(formatId);
      expect(fixture.seeds).toBe(SEEDS_PER_FORMAT);
      expect(fixture.cases.map((entry) => entry[0])).toStrictEqual(
        Array.from({ length: SEEDS_PER_FORMAT }, (_, seed) => seed),
      );
      for (const entry of fixture.cases) {
        expect(fixture.settings[entry[1]]).toBeDefined();
      }
    });

    for (let first = 0; first < SEEDS_PER_FORMAT; first += CHUNK) {
      const last = Math.min(first + CHUNK, SEEDS_PER_FORMAT);
      it(`seeds ${first}..${last - 1} send today's bytes`, async () => {
        const differences = await regenerate(
          format,
          first,
          last,
          fixture,
          builder,
        );
        expect(differences.slice(0, 10)).toStrictEqual([]);
      });
    }

    describeControls(format);
  });
}
