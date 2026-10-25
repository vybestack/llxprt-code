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

import { checkRandomPurge } from './support/native-random-purge.js';
describe('native service seeded empty-id reconstruction', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(() => setSystemTime());
  it('preserves Kimi fallback ordinals across split source parts in seed 95', async () => {
    await expect(
      checkNativeSeed(formatById('openai-chat-kimi'), 95),
    ).resolves.toBeUndefined();
  });
  for (const seed of [
    0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100,
  ]) {
    it(`preserves randomized purge and owner filtering in seed ${seed}`, async () => {
      await expect(checkRandomPurge(seed)).resolves.toBeUndefined();
    });
  }
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
