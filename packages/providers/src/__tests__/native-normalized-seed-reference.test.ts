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

describe('provider-ready normalized caller fixtures', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(() => setSystemTime());
  for (const id of [
    'openai-chat-plain',
    'openai-chat-kimi',
    'openai-chat-mistral',
  ]) {
    it(`${id} keeps the normalized empty assistant rows in seed 3`, async () => {
      await expect(checkNativeSeed(formatById(id), 3)).resolves.toBeUndefined();
    });
  }
  it('Anthropic keeps the normalized empty assistant row in seed 6', async () => {
    await expect(
      checkNativeSeed(formatById('anthropic-cache-off'), 6),
    ).resolves.toBeUndefined();
  });
});
