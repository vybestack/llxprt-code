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
 * This module is imported as a preload BEFORE any test file that uses
 * `vi.hoisted`, `vi.mocked`, `vi.stubEnv`, etc. It augments Bun's built-in
 * `vi` (not by using a base Vitest API — Bun does not provide one — but by
 * adding local compatibility implementations of the missing Vitest methods on
 * top of Bun's real fake-timer primitives).
 */

import { afterEach, vi as bunVi, mock } from 'bun:test';
import { createRequire, isBuiltin } from 'node:module';
import {
  StubRegistry,
  waitFor,
  isMockFunction,
  setWaitForScheduler,
  type WaitForScheduler,
} from './stub-helpers.js';
import { resolveModuleSpecifier } from './module-resolution.js';

/**
 * Models the surface of Bun's built-in `vi` object (from `bun:test`), which
 * provides sync fake-timer primitives (`advanceTimersByTime`, `runAllTimers`,
 * `runOnlyPendingTimers`, `isFakeTimers`, `useFakeTimers`, `useRealTimers`,
 * `restoreAllMocks`, etc.) but lacks the async variants and the env/global
 * stubbing helpers that Vitest provides. This interface documents the exact
 * subset of Bun's `vi` that the local compatibility implementation relies on,
 * so we call only genuinely available Bun APIs — never an absent base method.
 */
interface BunViBase {
  fn: typeof import('bun:test').vi.fn;
  spyOn: typeof import('bun:test').vi.spyOn;
  mock: typeof import('bun:test').vi.mock;
  restoreAllMocks: () => void;
  clearAllMocks: () => void;
  resetAllMocks: () => void;
  useFakeTimers: (options?: { now?: number | Date }) => unknown;
  useRealTimers: () => unknown;
  advanceTimersByTime: (milliseconds: number) => unknown;
  advanceTimersToNextTimer: () => unknown;
  runAllTimers: () => unknown;
  runOnlyPendingTimers: () => unknown;
  getTimerCount: () => number;
  clearAllTimers: () => void;
  isFakeTimers: () => boolean;
}

/**
 * Models the result of Bun.build() — the @types/bun BuildConfig omits `write`,
 * but Bun supports it at runtime. This interface lets us pass `write: false`
 * without suppressing type errors on the base declaration.
 */
interface BunBuildOptions {
  entrypoints: readonly string[];
  format?: 'esm' | 'cjs' | 'iife';
  target?: 'bun' | 'node' | 'browser' | 'bundler';
  write?: boolean;
}

interface BunBuildOutput {
  success: boolean;
  outputs: readonly { text(): Promise<string> }[];
  logs: readonly { message: string }[];
}

/**
 * Typed wrapper around Bun.build() that accepts the runtime-supported
 * `write: false` option without relying on the (incomplete) base type.
 */
async function bunBuild(options: BunBuildOptions): Promise<BunBuildOutput> {
  return (
    Bun as unknown as {
      build(opts: BunBuildOptions): Promise<BunBuildOutput>;
    }
  ).build(options);
}

const localRequire = createRequire(import.meta.url);

const envRegistry = new StubRegistry(
  process.env as unknown as Record<string | symbol, unknown>,
);
const globalRegistry = new StubRegistry(globalThis);

/**
 * Captured before any fake-timer activation or augmentation so async timer
 * helpers can call Bun's real sync timer primitives even after augmentation
 * overwrites some properties on `bunVi`.
 *
 * Bun does NOT provide async fake-timer methods (`advanceTimersByTimeAsync`,
 * `runAllTimersAsync`, `runOnlyPendingTimersAsync`); only the sync variants
 * exist. We implement the async behavior by calling the sync primitive and
 * then yielding to the real event loop via `flushPendingTasks()` to drain
 * microtasks that were queued by callbacks fired during advancement.
 */
const realAdvanceTimersByTime = (bunVi as BunViBase).advanceTimersByTime.bind(
  bunVi,
);
const realAdvanceTimersToNextTimer = (
  bunVi as BunViBase
).advanceTimersToNextTimer.bind(bunVi);
const realUseFakeTimers = (bunVi as BunViBase).useFakeTimers.bind(bunVi);
const realUseRealTimers = (bunVi as BunViBase).useRealTimers.bind(bunVi);
const realRunAllTimers = (bunVi as BunViBase).runAllTimers.bind(bunVi);
const realRunOnlyPendingTimers = (bunVi as BunViBase).runOnlyPendingTimers.bind(
  bunVi,
);
const realGetTimerCount = (bunVi as BunViBase).getTimerCount.bind(bunVi);

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

const MAX_TIMER_ADVANCE = 4_294_967_295;
const MAX_TIMER_DELAY = 2_147_483_647;
const MAX_ASYNC_TIMER_DRAIN_PASSES = 10_000;
let pendingTimerFraction = 0;

async function advanceTimerChunk(ms: number): Promise<void> {
  const target = Date.now() + ms;

  while (Date.now() < target) {
    const remaining = target - Date.now();
    if (realGetTimerCount() === 0) {
      realAdvanceTimersByTime(remaining);
      await flushPendingTasks();
      continue;
    }

    let reachedTarget = false;
    const targetTimer = setTimeout(() => {
      reachedTarget = true;
    }, remaining);
    const before = Date.now();

    realAdvanceTimersToNextTimer();
    clearTimeout(targetTimer);
    await flushPendingTasks();

    if (reachedTarget) return;
    if (Date.now() <= before) {
      realAdvanceTimersByTime(Math.min(remaining, 1));
      await flushPendingTasks();
    }
  }
}

const advanceTimersByTimeAsyncImpl = async (ms: number): Promise<void> => {
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_TIMER_ADVANCE) {
    realAdvanceTimersByTime(ms);
    await flushPendingTasks();
    return;
  }

  const total = pendingTimerFraction + ms;
  let remaining = Math.floor(total);
  pendingTimerFraction = total - remaining;

  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_TIMER_DELAY);
    await advanceTimerChunk(chunk);
    remaining -= chunk;
  }

  if (Math.floor(total) === 0) {
    await flushPendingTasks();
  }
};

const bunWaitForScheduler: WaitForScheduler = {
  isFakeTimers: () => (bunVi as BunViBase).isFakeTimers(),
  advanceTimersByTime: realAdvanceTimersByTime,
};

setWaitForScheduler(bunWaitForScheduler);

const resolveActualId = (id: string): string => {
  const resolvedId = resolveModuleSpecifier(id);
  return isBuiltin(resolvedId) ? resolvedId : localRequire.resolve(resolvedId);
};

const actualModules = new Map<string, Promise<unknown>>();
let actualImportSequence = 0;

const loadIsolatedModule = async (resolvedId: string): Promise<unknown> => {
  if (isBuiltin(resolvedId)) return localRequire(resolvedId);

  const result = await bunBuild({
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

function isClassFunction(value: unknown): boolean {
  return Function.prototype.toString.call(value).startsWith('class ');
}

function automockValue(
  value: unknown,
  references: Map<object, unknown>,
): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || !value) {
    return value;
  }
  const existing = references.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const mocked: unknown[] = [];
    references.set(value, mocked);
    return mocked;
  }

  if (typeof value === 'function') {
    if (isClassFunction(value)) {
      const state: { prototype: object | null } = { prototype: null };
      const MockedClass = function (): object {
        return Object.create(state.prototype);
      };
      const mockedConstructor = bunVi.fn(MockedClass);
      references.set(value, mockedConstructor);
      const mockedPrototype = automockValue(value.prototype, references);
      state.prototype =
        mockedPrototype !== null &&
        (typeof mockedPrototype === 'object' ||
          typeof mockedPrototype === 'function')
          ? mockedPrototype
          : null;
      Object.defineProperty(mockedConstructor, 'prototype', {
        value: state.prototype,
      });
      for (const key of Reflect.ownKeys(value)) {
        if (!['length', 'name', 'prototype'].includes(String(key))) {
          Object.defineProperty(mockedConstructor, key, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: automockValue(Reflect.get(value, key), references),
          });
        }
      }
      return mockedConstructor;
    }
    const mockedFunction = bunVi.fn();
    references.set(value, mockedFunction);
    return mockedFunction;
  }

  const mockedObject: Record<string | symbol, unknown> = {};
  references.set(value, mockedObject);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    Object.defineProperty(mockedObject, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      writable: true,
      value: automockValue(Reflect.get(value, key), references),
    });
  }
  return mockedObject;
}

const automockModule = async (resolvedId: string): Promise<object> => {
  const actual = await importResolvedActual(resolvedId);
  if ((typeof actual !== 'object' && typeof actual !== 'function') || !actual) {
    throw new TypeError(`Cannot automock non-object module "${resolvedId}"`);
  }
  const mocked = automockValue(actual, new Map());
  if (typeof mocked !== 'object' || !mocked) {
    throw new TypeError(`Cannot automock module "${resolvedId}"`);
  }
  return mocked;
};

const registerModuleMock = (
  id: string,
  factory?: (importOriginal: () => Promise<unknown>) => unknown,
): unknown => {
  const resolvedId = resolveActualId(id);
  if (!factory) {
    return mock.module(resolvedId, () => automockModule(resolvedId));
  }

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

// Capture the original restoreAllMocks BEFORE defining viAugmentations so
// the augmentation object can include restoreAllMocks in its initial type.
const originalRestoreAllMocks = (bunVi as BunViBase).restoreAllMocks.bind(
  bunVi,
);

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
  useFakeTimers: (options?: { now?: number | Date }): unknown => {
    pendingTimerFraction = 0;
    return realUseFakeTimers(options);
  },
  useRealTimers: (): unknown => {
    pendingTimerFraction = 0;
    return realUseRealTimers();
  },
  restoreAllMocks: (): void => {
    runCleanupSteps([
      () => originalRestoreAllMocks(),
      () => envRegistry.restoreAll(),
      () => globalRegistry.restoreAll(),
    ]);
  },
  waitFor,
  importActual,
  resetModules: unsupportedModuleIsolation,
  mock: registerModuleMock,
  doMock: registerModuleMock,
  doUnmock: unsupportedModuleIsolation,
  unmock: unsupportedModuleIsolation,
  isMockFunction,
  advanceTimersByTimeAsync: advanceTimersByTimeAsyncImpl,
  runAllTimersAsync: async (): Promise<void> => {
    for (let pass = 0; pass < MAX_ASYNC_TIMER_DRAIN_PASSES; pass++) {
      realRunAllTimers();
      await flushPendingTasks();
      if (realGetTimerCount() === 0) {
        return;
      }
    }
    throw new Error(
      `Aborting runAllTimersAsync after ${MAX_ASYNC_TIMER_DRAIN_PASSES} interleaved timer drains`,
    );
  },
  runOnlyPendingTimersAsync: async (): Promise<void> => {
    realRunOnlyPendingTimers();
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
  'useFakeTimers',
  'useRealTimers',
  'restoreAllMocks',
]);

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
