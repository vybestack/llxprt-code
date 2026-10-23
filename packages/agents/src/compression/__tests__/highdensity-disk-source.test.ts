/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { nativeHighdensitySourceFailure } from './support/native-highdensity-source.js';

const cases: Array<[number, string]> = [
  [512, 'error'],
  [512, 'cancel'],
  [8192, 'error'],
  [8192, 'cancel'],
];

describe('native high-density source lifetime', () => {
  it.each(cases)(
    'closes a failed native %i-row %s source, preserves durable values and retries',
    async (size, mode) => {
      expect(await nativeHighdensitySourceFailure(size, mode)).toBe(size);
    },
    180_000,
  );
});
