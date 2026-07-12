/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi as runnerVi, setSystemTime } from 'bun:test';
import { createRequire, isBuiltin } from 'node:module';

const localRequire = createRequire(import.meta.url);

const importActual = async <T>(specifier: string): Promise<T> => {
  if (isBuiltin(specifier)) {
    return localRequire(specifier) as T;
  }
  const resolved = localRequire.resolve(specifier);
  return import(`${resolved}?__importActual`) as Promise<T>;
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 100; index++) {
    await Promise.resolve();
  }
};

export const vi = {
  ...runnerVi,
  mocked: <T>(item: T): T => item,
  hoisted: <T>(factory: () => T): T => factory(),
  importActual,
  setSystemTime,
  advanceTimersByTimeAsync: async (milliseconds: number): Promise<void> => {
    runnerVi.advanceTimersByTime(milliseconds);
    await flushMicrotasks();
  },
  runAllTimersAsync: async (): Promise<void> => {
    runnerVi.runAllTimers();
    await flushMicrotasks();
  },
  runOnlyPendingTimersAsync: async (): Promise<void> => {
    runnerVi.runOnlyPendingTimers();
    await flushMicrotasks();
  },
};
