/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { PINNED_CLOCK } from '../../wireBodyFixtures.js';
import { isFrozenUpdateRequested } from '../frozenFixture.js';
import type { ExplicitCase, Observation } from './explicitCase.js';
import {
  readExplicitFixture,
  writeExplicitFixture,
  type ExplicitFixture,
} from './explicitFixture.js';

const DESCRIPTION =
  "Today's output for the named counterexamples of the #854 design, phase 0. " +
  'Regenerate only deliberately with FROZEN_WIRE_CORPUS_UPDATE=1; never in CI.';

function assertUniqueNames(cases: readonly ExplicitCase[]): void {
  const names = cases.map((entry) => entry.name);
  if (new Set(names).size !== names.length) {
    throw new Error('counterexample names must be unique');
  }
}

/** One named test per case; the group's fixture holds the expected values. */
export function defineExplicitCases(
  group: string,
  cases: readonly ExplicitCase[],
): void {
  assertUniqueNames(cases);
  const update = isFrozenUpdateRequested(process.env);
  const fixture = update ? undefined : readExplicitFixture(group);
  const recorded: Record<string, Observation> = {};

  describe(`frozen counterexamples: ${group}`, () => {
    beforeAll(() => {
      setSystemTime(new Date(PINNED_CLOCK));
    });

    afterAll(() => {
      setSystemTime();
      if (!update) return;
      const written: ExplicitFixture = {
        group,
        description: DESCRIPTION,
        cases: recorded,
      };
      writeExplicitFixture(written);
    });

    it('the fixture names exactly the cases of the group', () => {
      if (fixture === undefined) return;
      expect(Object.keys(fixture.cases)).toStrictEqual(
        cases.map((entry) => entry.name),
      );
    });

    for (const entry of cases) {
      it(entry.name, async () => {
        const actual = await entry.observe();
        recorded[entry.name] = actual;
        entry.expectation?.(actual);
        if (fixture === undefined) return;
        const expected = fixture.cases[entry.name];
        if (expected === undefined) {
          throw new Error(`the fixture has no case ${entry.name}`);
        }
        expect(actual).toStrictEqual(expected);
      });
    }
  });
}
