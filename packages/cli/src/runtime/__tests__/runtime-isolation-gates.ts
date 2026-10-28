/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export function createBarrier(expected: number): () => Promise<void> {
  let count = 0;
  const waiters: Array<() => void> = [];
  return () =>
    new Promise<void>((resolve) => {
      count += 1;
      waiters.push(resolve);
      if (count === expected) {
        for (const release of waiters) {
          release();
        }
      }
    });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
