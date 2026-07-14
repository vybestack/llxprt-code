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
import { StubRegistry, waitFor, isMockFunction } from './stub-helpers.js';
import { resolveModuleSpecifier } from './module-resolution.js';

const localRequire = createRequire(import.meta.url);

const envRegistry = new StubRegistry(process.env);
const globalRegistry = new StubRegistry(globalThis);

/**
 * Captured before any fake-timer activation so async timer helpers can await
 * a real event-loop turn to drain recursively queued microtasks. Under Bun's
 * fake timers, `setImmediate` itself is faked and will not advance the real
 * event loop, so the captured reference is used instead.
 */
const realSetImmediate: (callback: () => void) => NodeJS.Immediate =
  setImmediate;

/**
 * Drains recursively queued microtasks by yielding to the real event loop.
 * A single `Promise.resolve()` only flushes one round of microtasks; nested
 * `.then()` chains (e.g. `Promise.resolve().then(() => Promise.resolve())`)
 * require a real macrotask boundary to settle completely.
 */
const flushPendingTasks = async (): Promise<void> => {
  await new Promise<void>((resolve) => realSetImmediate(resolve));
};

const resolveActualId = (id: string): string => {
  const resolvedId = resolveModuleSpecifier(id);
  return isBuiltin(resolvedId) ? resolvedId : localRequire.resolve(resolvedId);
};

const actualModules = new Map<string, Promise<unknown>>();
let actualImportSequence = 0;

const loadIsolatedModule = async (resolvedId: string): Promise<unknown> => {
  if (isBuiltin(resolvedId)) return localRequire(resolvedId);

  const result = await Bun.build({
    entrypoints: [resolvedId],
    format: 'esm',
    target: 'bun',
    write: false,
  });
  const output = result.outputs[0];
  if (!result.success || !output) {
    const message = result.logs.map((log) => log.message).join('\n');
    throw new Error(message || `importActual: cannot build "${resolvedId}"`);
  }

  actualImportSequence += 1;
  const source = await output.text();
  const encodedSource = Buffer.from(source).toString('base64');
  return import(
    `data:text/javascript;base64,${encodedSource}?actual=${actualImportSequence}`
  );
};

const importResolvedActual = (resolvedId: string): Promise<unknown> => {
  const cached = actualModules.get(resolvedId);
  if (cached) return cached;

  const actual = loadIsolatedModule(resolvedId);
  actualModules.set(resolvedId, actual);
  return actual;
};

const importActual = (id: string): Promise<unknown> => {
  try {
    return importResolvedActual(resolveActualId(id));
  } catch (error: unknown) {
    return Promise.reject(
      error instanceof Error
        ? error
        : new Error(`importActual: cannot resolve "${id}"`),
    );
  }
};

const registerModuleMock = (
  id: string,
  factory?: (importOriginal: () => Promise<unknown>) => unknown,
): unknown => {
  const resolvedId = resolveActualId(id);
  if (!factory) return mock.module(resolvedId);

  return mock.module(resolvedId, () =>
    factory(() => importResolvedActual(resolvedId)),
  );
};

/**
 * Runs every cleanup step, collecting all errors so that later failures do not
 * mask earlier ones. If exactly one step throws, that original error is
 * rethrown unchanged. If multiple steps throw, an AggregateError is raised
 * with errors in execution order.
 *
 * Exported as a test seam so behavioral unit tests can verify composition
 * without depending on the module-level registries.
 */
export function runCleanupSteps(steps: ReadonlyArray<() => void>): void {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Multiple cleanup steps failed');
  }
}

// Augment Bun's vi in-place with Vitest-compatible methods that Bun's
// built-in test runner does not provide.
const unsupportedModuleIsolation = (): never => {
  throw new Error(
    'Bun does not support resetting or unmocking modules; run the test in an isolated process',
  );
};

const unsupportedMockRegistry = new Proxy(Object.freeze({}), {
  get: (): never => {
    throw new Error('Bun does not expose its module mock registry');
  },
  set: (): never => {
    throw new Error('Bun does not expose its module mock registry');
  },
});

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
  resetModules: unsupportedModuleIsolation,
  mock: registerModuleMock,
  doMock: registerModuleMock,
  doUnmock: unsupportedModuleIsolation,
  unmock: unsupportedModuleIsolation,
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
  mocks: unsupportedMockRegistry,
};

afterEach(() => {
  runCleanupSteps([
    () => envRegistry.restoreAll(),
    () => globalRegistry.restoreAll(),
  ]);
});

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
  runCleanupSteps([
    () => originalRestoreAllMocks(),
    () => envRegistry.restoreAll(),
    () => globalRegistry.restoreAll(),
  ]);
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
