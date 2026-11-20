/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { FROZEN_FORMATS } from './frozenWire/frozenCases.js';
import { PINNED_CLOCK } from './wireBodyFixtures.js';
import { checkNativeSeed } from './native-seed-cases.js';
import { checkRandomPurge } from './native-random-purge.js';

export function defineNativeSeedRange(first: number, last: number): void {
  describe(`native full corpus seeds ${first}..${last}`, () => {
    beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
    afterAll(() => setSystemTime());
    for (const format of FROZEN_FORMATS) {
      it(`${format.id} compares every provider and service boundary`, async () => {
        let checked = 0;
        for (let seed = first; seed <= last; seed++) {
          await checkNativeSeed(format, seed);
          checked++;
        }
        expect(checked).toBe(last - first + 1);
      }, 180_000);
    }
    it('randomized semantic purge preserves old values, bytes, dumps and pinned selections across owner filtering', async () => {
      let checked = 0;
      for (let seed = first; seed <= last; seed++) {
        await checkRandomPurge(seed);
        checked++;
      }
      expect(checked).toBe(last - first + 1);
    }, 180_000);
  });
}
