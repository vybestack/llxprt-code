/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun's test runner injects its own partial vitest API for `import ... from
 * 'vitest'`. This built-in handling bypasses both mock.module and Bun plugins,
 * so we cannot redirect the specifier. Instead, we augment the injected `vi`
 * object in-place by adding the missing Vitest-compatible methods.
 *
 * This module must be imported as a preload BEFORE any test file that uses
 * `vi.hoisted`, `vi.mocked`, `vi.stubEnv`, etc.
 */

import { afterEach, vi as bunVi, mock } from 'bun:test';
import { createRequire, isBuiltin } from 'node:module';
import { relative } from 'node:path';
import { StubRegistry, waitFor, isMockFunction } from './stub-helpers.js';

const localRequire = createRequire(import.meta.url);
const shimDir = import.meta.dir;

const envRegistry = new StubRegistry(process.env);
const globalRegistry = new StubRegistry(globalThis);

const importActual = (id: string): Promise<unknown> => {
  afterEach(() => {
    try {
      envRegistry.restoreAll();
    } finally {
      globalRegistry.restoreAll();
    }
  });

  if (isBuiltin(id)) {
    return Promise.resolve(localRequire(id));
  }
  let absPath: string;
  try {
    absPath = localRequire.resolve(id);
  } catch (error: unknown) {
    return Promise.reject(
      error instanceof Error
        ? error
        : new Error(`importActual: cannot resolve "${id}"`),
    );
  }
  const relPath = './' + relative(shimDir, absPath);
  return import(relPath + '?__importActual');
};

const wrapMockFactory =
  (
    id: string,
    factory: (importOriginal: () => Promise<unknown>) => unknown,
  ): (() => unknown) =>
  (): unknown =>
    factory(() => importActual(id));

const realSetTimeout = setTimeout;
const realDateNow = Date.now;

const MAX_TASK_ITERATIONS = 100;
const FLUSH_TIMEOUT_MS = 5_000;

const flushPendingTasks = async (): Promise<void> => {
  const start = realDateNow();
  for (let i = 0; i < MAX_TASK_ITERATIONS; i++) {
    if (realDateNow() - start > FLUSH_TIMEOUT_MS) break;
    await new Promise<void>((resolve) => {
      realSetTimeout(resolve, 0);
    });
  }
};

// Augment Bun's vi in-place with Vitest-compatible methods that Bun's
// built-in test runner does not provide.
const viAugmentations = {
  mocked: <T>(item: T): T => item,
  hoisted: <T>(factory: () => T): T => factory(),
  stubEnv: (key: string, value: string): void => {
    envRegistry.stub(key, value);
  },
  unstubAllEnvs: (): void => {
    envRegistry.restoreAll();
  },
  stubGlobal: (key: string, value: unknown): void => {
    globalRegistry.stub(key, value);
  },
  unstubAllGlobals: (): void => {
    globalRegistry.restoreAll();
  },
  waitFor,
  importActual,
  resetModules: (): void => {},
  mock: (
    id: string,
    factory?: (importOriginal: () => Promise<unknown>) => unknown,
  ): unknown => {
    if (factory) {
      return mock.module(id, wrapMockFactory(id, factory));
    }
    return mock.module(id);
  },
  doMock: (
    id: string,
    factory?: (importOriginal: () => Promise<unknown>) => unknown,
  ): unknown => {
    if (factory) {
      return mock.module(id, wrapMockFactory(id, factory));
    }
    return mock.module(id);
  },
  doUnmock: (): void => {},
  unmock: (): void => {},
  isMockFunction,
  advanceTimersByTimeAsync: async (ms: number): Promise<void> => {
    bunVi.advanceTimersByTime(ms);
    await flushPendingTasks();
  },
  runAllTimersAsync: async (): Promise<void> => {
    bunVi.runAllTimers();
    await flushPendingTasks();
  },
  runOnlyPendingTimersAsync: async (): Promise<void> => {
    bunVi.runOnlyPendingTimers();
    await flushPendingTasks();
  },
  mocks: {},
};

// Apply augmentations to Bun's vi object. Bun's vi is a frozen-like object,
// but we can use Object.assign to add new properties. Existing Bun methods
// (fn, spyOn, etc.) are preserved. The `mock` and `doMock` methods are
// ALWAYS overridden because Bun's built-in vi.mock does not pass
// importOriginal to the factory, breaking Vitest-compatible factory
// signatures like vi.mock(id, (importOriginal) => ...).
const forceOverride = new Set([
  'mock',
  'doMock',
  'stubEnv',
  'unstubAllEnvs',
  'stubGlobal',
  'unstubAllGlobals',
  'restoreAllMocks',
]);

const originalRestoreAllMocks = bunVi.restoreAllMocks.bind(bunVi);
viAugmentations.restoreAllMocks = (): void => {
  try {
    originalRestoreAllMocks();
  } finally {
    try {
      envRegistry.restoreAll();
    } finally {
      globalRegistry.restoreAll();
    }
  }
};

for (const [key, value] of Object.entries(viAugmentations)) {
  if (forceOverride.has(key) || !(key in bunVi)) {
    try {
      Object.defineProperty(bunVi, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } catch {
      // If defineProperty fails (non-configurable), try direct assignment.
      try {
        (bunVi as Record<string, unknown>)[key] = value;
      } catch {
        // Property is truly read-only; skip.
      }
    }
  }
}

// Also register mock.module('vitest') as a fallback for environments where
// the built-in handler does NOT intercept (e.g., non-test contexts).
export { viAugmentations };
