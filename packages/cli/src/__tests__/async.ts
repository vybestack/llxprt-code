/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value: T) => resolvePromise?.(value),
    reject: (error: Error) => rejectPromise?.(error),
  };
}

// The waitFor from vitest doesn't properly wrap in act(), so we have to
// implement our own like the one in @testing-library/react
// or @testing-library/react-native
// The version of waitFor from vitest is still fine to use if you aren't waiting
// for React state updates.
export async function waitFor(
  assertion: () => void | Promise<void>,
  { timeout = 1000, interval = 50 } = {},
): Promise<void> {
  const startTime = Date.now();

  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() - startTime > timeout) {
        throw error;
      }

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, interval));
      });
    }
  }
}
