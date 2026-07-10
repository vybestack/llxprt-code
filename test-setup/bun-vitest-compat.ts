/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mock } from 'bun:test';
import {
  expect,
  describe,
  it as bunIt,
  test,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  vi as bunVi,
  setSystemTime,
} from 'bun:test';
import { createRequire, isBuiltin } from 'node:module';
import { relative } from 'node:path';
import { StubRegistry, waitFor, isMockFunction } from './stub-helpers.js';

const localRequire = createRequire(import.meta.url);
const shimDir = import.meta.dir;

const envRegistry = new StubRegistry(process.env);
const globalRegistry = new StubRegistry(globalThis);

/**
 * Returns the real (un-mocked) exports for a module specifier.
 *
 * Bun's mock.module intercepts both ESM import and CJS require for local
 * modules, but there are two bypass mechanisms:
 *
 * 1. Node/bun builtins (e.g. "node:fs", "fs", "node:child_process"):
 *    require() resolves via the built-in CJS path, which mock.module does
 *    not intercept. isBuiltin() catches both the "node:" prefix form and
 *    bare names like "fs".
 * 2. Everything else: append a query string ("?__importActual") to the
 *    resolved file path. Bun treats specifiers with different query strings
 *    as distinct modules, so the query-suffixed import is not intercepted by
 *    a mock registered under the bare/relative specifier.
 *
 * Relative specifiers (e.g. "./foo.js") are resolved relative to the shim
 * module, not the calling test file, so they may not resolve correctly. Test
 * files that need importActual for relative paths should be migrated to the
 * Bun-native vi.spyOn pattern instead.
 */
const importActual = (id: string): Promise<unknown> => {
  if (isBuiltin(id)) {
    return Promise.resolve(localRequire(id));
  }
  try {
    const absPath = localRequire.resolve(id);
    const relPath = './' + relative(shimDir, absPath);
    return import(relPath + '?__importActual');
  } catch {
    return import(id);
  }
};

/**
 * Wraps a vi.mock factory so the factory's importOriginal callback resolves
 * to the real module for the mock's specifier. The id is captured at
 * registration time so the factory can call importOriginal() with no
 * arguments (matching Vitest's API).
 */
const wrapMockFactory =
  (
    id: string,
    factory: (importOriginal: () => Promise<unknown>) => unknown,
  ): (() => unknown) =>
  (): unknown =>
    factory(() => importActual(id));

/**
 * Capture the real setTimeout at module load time, before any test can call
 * vi.useFakeTimers(). This ensures flushPendingTasks always schedules on the
 * real event loop, not a fake-timer mock, so async timer helpers don't hang
 * when fake timers are active.
 */
const realSetTimeout = setTimeout;

/**
 * Vitest's async timer methods drain all pending microtasks and macrotasks
 * recursively. A single `await Promise.resolve()` only flushes one microtask
 * level. This bounded loop alternates macrotask boundaries so timer callbacks
 * fire and their promise chains settle. The iteration cap prevents infinite
 * hangs when timers reschedule themselves indefinitely.
 */
const MAX_TASK_ITERATIONS = 100;

const flushPendingTasks = async (): Promise<void> => {
  for (let i = 0; i < MAX_TASK_ITERATIONS; i++) {
    await new Promise<void>((resolve) => {
      realSetTimeout(resolve, 0);
    });
  }
};

/**
 * Bun has no module-reset primitive; its module cache is internal to the
 * runtime and cannot be flushed from JS. This no-op keeps code that calls
 * vi.resetModules() from crashing, but module isolation is NOT guaranteed.
 */
const resetModules = (): void => {};

/**
 * Bun 1.3.14 has no counterpart to Vitest's vi.unmock — once a module mock is
 * registered via mock.module it stays active for the process. This no-op
 * prevents crashes but does NOT actually unmock.
 */
const unmock = (): void => {};

/**
 * Same as unmock — Bun does not expose a per-call unmock for dynamic imports.
 */
const doUnmock = (): void => {};

const polyfilledVi = {
  ...bunVi,
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
  setSystemTime,
  importActual,
  resetModules,
  mock: (
    id: string,
    factory?: (importOriginal: () => Promise<unknown>) => unknown,
  ): unknown =>
    mock.module(id, factory ? wrapMockFactory(id, factory) : () => ({})),
  doMock: (
    id: string,
    factory: (importOriginal: () => Promise<unknown>) => unknown,
  ): unknown => mock.module(id, wrapMockFactory(id, factory)),
  doUnmock,
  unmock,
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
  /**
   * Bun does not expose its internal mock registry, so we cannot return the
   * real map. This empty object keeps destructuring callers from crashing.
   */
  mocks: {},
};

/**
 * Augment Bun's `it` with a `runIf` method that selects `it` when the
 * condition is truthy and `it.skip` when falsy, matching Vitest's semantics.
 */
type TestFn = typeof bunIt & {
  skip: typeof bunIt;
  only: typeof bunIt;
  todo: typeof bunIt;
  runIf: (condition: boolean) => typeof bunIt;
};

const augmentedIt = bunIt as TestFn;
augmentedIt.runIf = (condition: boolean): typeof bunIt =>
  condition ? bunIt : bunIt.skip;

afterEach(() => {
  envRegistry.restoreAll();
  globalRegistry.restoreAll();
});

const vitestShim = {
  describe,
  it: augmentedIt,
  test,
  expect,
  vi: polyfilledVi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  /**
   * Vitest type-only re-exports. These are types at the Vitest level; Bun has
   * no runtime equivalent, so we provide undefined placeholders so that
   * `import { Mock } from 'vitest'` (used only as a type) does not crash at
   * module-evaluation time.
   */
  Mock: undefined,
  MockInstance: undefined,
  Mocked: undefined,
  assert: undefined,
  expectTypeOf: undefined,
};

mock.module('vitest', () => vitestShim);
