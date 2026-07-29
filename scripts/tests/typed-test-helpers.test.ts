/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  asArray,
  asRecord,
  asRecordArray,
  asRecordMap,
  asNumberRecord,
  asStringArray,
  asVmFunction,
} from './typed-test-helpers.ts';

describe('typed test helper identity preservation', () => {
  it('returns validated records, arrays, and record maps without copying', () => {
    const record = { value: 1 };
    const array = [record];
    const recordMap = { record };

    expect(asRecord(record)).toBe(record);
    expect(asArray(array)).toBe(array);
    expect(asRecordArray(array)).toBe(array);
    expect(asRecordMap(recordMap)).toBe(recordMap);
  });

  it('returns validated string arrays and number records without copying', () => {
    const strings = ['one', 'two'];
    const numbers = { one: 1, two: 2 };
    expect(asStringArray(strings)).toBe(strings);
    expect(asNumberRecord(numbers)).toBe(numbers);
  });

  it('returns the original VM callable and preserves its receiver', () => {
    const callable = function (this: { value: number }): number {
      return this.value;
    };
    const receiver = { value: 42, callable: asVmFunction(callable) };

    expect(receiver.callable).toBe(callable);
    expect(receiver.callable()).toBe(42);
  });
});
