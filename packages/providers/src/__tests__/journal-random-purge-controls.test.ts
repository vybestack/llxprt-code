/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { checkRandomPurge } from './support/native-random-purge.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';

describe('native randomized purge oracle controls', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(() => setSystemTime());
  it('preserves the unchanged purge and selected-version body assertions', async () => {
    await expect(checkRandomPurge(0)).resolves.toBeUndefined();
  });
});
