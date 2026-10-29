/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';

import { nativeSummaryPublication } from './support/native-summary-publication.js';

async function publication(size: number): Promise<number> {
  return nativeSummaryPublication(size, 'one-shot');
}
describe('invoked one-shot publication owners', () => {
  it.each([512, 8192])(
    'pauses the real %i-row transaction with bounded owners and restores all membership after failure',
    async (size) => {
      expect(await publication(size)).toBeGreaterThan(0);
    },
    180_000,
  );
});
