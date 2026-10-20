/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { formatById } from './support/frozenWire/frozenCases.js';
import { checkNativeSeed } from './support/native-seed-cases.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';

describe('native service seeded empty-id reconstruction', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(() => setSystemTime());
  for (const format of ['openai-responses-via-openai', 'openai-responses']) {
    for (const seed of [2, 178, 179, 180]) {
      it(`${format} seed ${seed} preserves frozen provider bytes and independent service bytes`, async () => {
        await expect(
          checkNativeSeed(formatById(format), seed),
        ).resolves.toBeUndefined();
      });
    }
  }
});
