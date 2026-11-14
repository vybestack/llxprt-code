/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { nativeFallbackPhases } from './support/native-fallback-phases.js';

const cases = [512, 8192].flatMap((size) =>
  [false, true].flatMap((rollback) =>
    [false, true].map((pending) => ({ size, rollback, pending })),
  ),
);

describe('native fallback disk value ownership phases', () => {
  for (const { size, rollback, pending } of cases) {
    it(`publishes ${pending ? 'actual pending fallback' : 'complete candidate'} at ${size}, rollback=${rollback}`, async () => {
      const result = await nativeFallbackPhases(size, rollback, pending);
      expect(result).toBeUndefined();
    }, 180_000);
  }
});
