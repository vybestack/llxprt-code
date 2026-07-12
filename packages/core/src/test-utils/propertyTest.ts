/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from 'bun:test';
import * as fc from 'fast-check';

export function propertyTest<TValues extends [unknown, ...unknown[]]>(
  arbitraries: { [TIndex in keyof TValues]: fc.Arbitrary<TValues[TIndex]> },
  name: string,
  predicate: (...values: TValues) => void,
): void {
  it(name, () => {
    fc.assert(fc.property(...arbitraries, predicate));
  });
}

export function asyncPropertyTest<TValues extends [unknown, ...unknown[]]>(
  arbitraries: { [TIndex in keyof TValues]: fc.Arbitrary<TValues[TIndex]> },
  name: string,
  predicate: (...values: TValues) => Promise<void>,
): void {
  it(name, async () => {
    await fc.assert(fc.asyncProperty(...arbitraries, predicate));
  });
}

export function asyncPropertyTestWithOptions<
  TValues extends [unknown, ...unknown[]],
>(
  arbitraries: { [TIndex in keyof TValues]: fc.Arbitrary<TValues[TIndex]> },
  parameters: fc.Parameters<TValues>,
): (name: string, predicate: (...values: TValues) => Promise<void>) => void {
  return (name, predicate) => {
    it(name, async () => {
      await fc.assert(fc.asyncProperty(...arbitraries, predicate), parameters);
    });
  };
}
