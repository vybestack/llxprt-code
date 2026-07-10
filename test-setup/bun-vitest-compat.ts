/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  mock,
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
import { StubRegistry, waitFor, isMockFunction } from './stub-helpers.js';

const envRegistry = new StubRegistry(process.env);
const globalRegistry = new StubRegistry(globalThis);

/**
 * Bun 1.3.14 does not support the `mock.module(id, importOriginal => ...)`
 * form needed to bypass active mocks, so this is a best-effort dynamic import
 * that may still resolve to a mocked module when a mock is registered for the
 * same specifier.
 */
const importActual = (id: string): Promise<unknown> => import(id);

/**
 * Vitest's vi.mock(path, factory) passes importOriginal as the first argument
 * to the factory so it can spread-override individual exports. Bun 1.3.14's
 * mock.module calls the factory with no arguments, so we wrap the factory to
 * inject our importActual function. This means importOriginal() inside the
 * factory may return a mocked module rather than the real one — documented
 * limitation until Bun supports the importOriginal callback form natively.
 */
const wrapMockFactory =
  (
    factory: (importOriginal: () => Promise<unknown>) => unknown,
  ): (() => unknown) =>
  (): unknown =>
    factory(importActual);

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
      setTimeout(resolve, 0);
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
    mock.module(id, factory ? wrapMockFactory(factory) : () => ({})),
  doMock: (
    id: string,
    factory: (importOriginal: () => Promise<unknown>) => unknown,
  ): unknown => mock.module(id, wrapMockFactory(factory)),
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
