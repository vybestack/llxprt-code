/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function assertDefined<T>(
  value: T,
  message = 'Expected value to be defined',
): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

export function assertTrue(
  value: boolean,
  message = 'Expected value to be true',
): asserts value is true {
  if (value !== true) {
    throw new Error(message);
  }
}

export function assertFalse(
  value: boolean,
  message = 'Expected value to be false',
): asserts value is false {
  if (value !== false) {
    throw new Error(message);
  }
}

export function assertTruthy<T>(
  value: T,
  message = 'Expected value to be truthy',
): asserts value is Exclude<T, false | null | undefined | '' | 0> {
  if (Boolean(value) !== true) {
    throw new Error(message);
  }
}
