/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { nativePublication } from './support/native-publication-owners.js';

describe('native invoked high-density publication owners', () => {
  it.each([512, 8192])(
    'reserves media while publishing %i rows, restores persisted membership on failure and retries with bounded owners',
    async (size) => {
      expect(await nativePublication(size)).toBeUndefined();
    },
    180_000,
  );
  it('rejects an explicitly retained 8192-row prior version at the unchanged owner bounds', async () => {
    expect(await nativePublication(8192, true)).toBeUndefined();
  }, 180_000);
});
