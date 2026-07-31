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

import {
  afterEach,
  vi as bunVi,
  mock,
  setSystemTime as bunSetSystemTime,
  describe as bunDescribe,
  expect,
} from 'bun:test';
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
const realClearAllTimers = (bunVi as BunViBase).clearAllTimers.bind(bunVi);
const realIsFakeTimers = (bunVi as BunViBase).isFakeTimers.bind(bunVi);

/**
 * Captured before any fake-timer activation so async timer helpers can await
 * a real event-loop turn to drain recursively queued microtasks. Under Bun's
 * fake timers, `setImmediate` itself is faked and will not advance the real
 * event loop, so the captured reference is used instead.
 */
const realSetImmediate: (callback: () => void) => NodeJS.Immediate =
  setImmediate;

/**
 * Drains recursively queued microtasks from async timer callbacks.
 *
 * On macOS, `setImmediate` fires promptly even under Bun's fake timers, so a
 * single macrotask boundary suffices. On Linux CI, `setImmediate` may not
 * fire under fake timers, causing tests that rely on async timer advancement
 * (e.g. proactive-renewal) to hang indefinitely.
 *
 * The portable approach drains microtasks via chained `Promise.resolve()`
 * calls first (each yielding one microtask round), then yields to a real
 * macrotask via `setImmediate` as a final settling boundary. This works on
 * both platforms without depending on `setImmediate` firing under fake timers.
 */
const MICROTASK_DRAIN_ROUNDS = 20;
const flushPendingTasks = async (): Promise<void> => {
  for (let i = 0; i < MICROTASK_DRAIN_ROUNDS; i++) {
    await Promise.resolve();
  }
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

/**
 * Pre-caches Node built-in modules before any mock.module() registration.
 *
 * When a test calls vi.mock('fs', (importOriginal) => ...), the factory's
 * importOriginal() must load the REAL module. But mock.module intercepts
 * require() too, so calling require() inside the factory deadlocks.
 *
 * This preload runs BEFORE any test file is loaded, so require() returns
 * the real built-in modules. We cache them so importActual can return
 * the cached copy later, even after mock.module intercepts require().
 */
const builtinCache = new Map<string, unknown>();
const COMMONLY_MOCKED_BUILTINS = [
  'fs',
  'node:fs',
  'path',
  'node:path',
  'os',
  'node:os',
  'child_process',
  'node:child_process',
  'crypto',
  'node:crypto',
  'net',
  'node:net',
  'http',
  'node:http',
  'https',
  'node:https',
  'stream',
  'node:stream',
  'fs/promises',
  'node:fs/promises',
  'url',
  'node:url',
  'util',
  'node:util',
  'events',
  'node:events',
  'readline',
  'node:readline',
  'tty',
  'node:tty',
];

for (const mod of COMMONLY_MOCKED_BUILTINS) {
  try {
    builtinCache.set(mod, localRequire(mod));
  } catch {
    // Module may not exist in this environment
  }
}

/**
 * Loads a module bypassing mock.module interception.
 *
 * For Node built-in modules, we use cached versions from preload time
 * (before mocks were registered) via require().
 *
 * For workspace/relative modules, we use require() which is NOT intercepted
 * by Bun's mock.module. Bun's mock.module intercepts import() (ESM dynamic
 * import) even inside factory functions, causing deadlocks when importOriginal
 * is called. require() bypasses mock.module entirely, returning the real
 * module namespace object. Bun supports require() of ESM modules, returning
 * the module namespace (same shape as import()).
 */
const loadIsolatedModule = (resolvedId: string): Promise<unknown> => {
  return Promise.resolve(loadIsolatedModuleSync(resolvedId));
};

/**
 * Synchronously loads a module bypassing mock.module interception.
 * Uses require() which is NOT intercepted by Bun's mock.module, unlike
 * ESM dynamic import() which IS intercepted and deadlocks inside factories.
 */
const loadIsolatedModuleSync = (resolvedId: string): unknown => {
  const builtinCached = builtinCache.get(resolvedId);
  if (builtinCached !== undefined) return builtinCached;
  return localRequire(resolvedId);
};

const importResolvedActual = (resolvedId: string): Promise<unknown> => {
  const cached = actualModules.get(resolvedId);
  if (cached) return cached;

  const promise = loadIsolatedModule(resolvedId);
  actualModules.set(resolvedId, promise);
  return promise;
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

const registerModuleMock = (
  id: string,
  factory?: (importOriginal: () => Promise<unknown>) => unknown,
): unknown => {
  const resolvedId = resolveActualId(id);

  // Bun's mock.module matches by the original module specifier (e.g.
  // 'mime-types', 'fs', './foo.js'), NOT by the resolved absolute file path.
  // Using the resolved path causes the factory to never be called, leaving
  // test code with the real module instead of the mock. Pass the original id
  // to mock.module and use the resolved path only for importActual lookups.
  const mockId = id;

  if (!factory) {
    // Pre-load and cache the real module BEFORE mock.module registration.
    // The automock factory runs lazily (when the module is first imported),
    // at which point require() would return the mocked namespace.
    const realModule = loadIsolatedModuleSync(resolvedId);
    const actualSnapshot: Record<string | symbol, unknown> = {};
    if (typeof realModule === 'object' && realModule !== null) {
      for (const key of Reflect.ownKeys(realModule)) {
        const descriptor = Object.getOwnPropertyDescriptor(realModule, key);
        if (descriptor) {
          Object.defineProperty(actualSnapshot, key, {
            configurable: true,
            enumerable: descriptor.enumerable,
            writable: true,
            value: descriptor.value,
          });
        }
      }
    } else {
      Object.assign(actualSnapshot, { default: realModule });
    }
    actualModules.set(resolvedId, Promise.resolve(actualSnapshot));
    return mock.module(mockId, () => automockValue(realModule, new Map()));
  }

  // Bun's mock.module does NOT drain the microtask queue inside factory
  // functions (Bun 1.3.x). If a factory returns a Promise, mock.module
  // deadlocks trying to await it. To work around this:
  //
  // 1. Call the factory eagerly at vi.mock() registration time (NOT inside
  //    mock.module's lazy evaluation). importOriginal returns a sync value
  //    via require() so `await importOriginal()` resolves immediately.
  // 2. If the factory returns a sync value, register it directly.
  // 3. If the factory returns a Promise, register a placeholder mock that
  //    returns the real module, then re-register with the resolved result
  //    once the Promise settles. This works because mock.module is reentrant
  //    — calling mock.module again with the same id replaces the previous
  //    registration.
  const syncActual = loadIsolatedModuleSync(resolvedId);
  // Cache a SHALLOW CLONE of the real module so vi.importActual returns the
  // REAL exports, not the mock.module-patched namespace. Bun's mock.module
  // patches the module namespace object IN PLACE, so storing a reference to
  // the namespace would later reflect the mocked values. A shallow clone
  // preserves the original export values at registration time.
  const actualSnapshot: Record<string | symbol, unknown> = {};
  if (typeof syncActual === 'object' && syncActual !== null) {
    for (const key of Reflect.ownKeys(syncActual)) {
      const descriptor = Object.getOwnPropertyDescriptor(syncActual, key);
      if (descriptor) {
        Object.defineProperty(actualSnapshot, key, {
          configurable: true,
          enumerable: descriptor.enumerable,
          writable: true,
          value: descriptor.value,
        });
      }
    }
  } else {
    Object.assign(actualSnapshot, { default: syncActual });
  }
  actualModules.set(resolvedId, Promise.resolve(actualSnapshot));
  const importOriginal = (): unknown => syncActual;
  const factoryResult = factory(importOriginal as () => Promise<unknown>);

  if (!(factoryResult instanceof Promise)) {
    // Sync factory result — register directly
    return mock.module(mockId, () => factoryResult as object);
  }

  // Async factory result — Bun can't await inside mock.module factories.
  // Register a placeholder (real module) and re-register when resolved.
  // This is a race: if the module is imported before the factory resolves,
  // the real module is returned. In practice, vi.mock() is called at module
  // evaluation time, well before the module is first imported by test code.
  // IMPORTANT: Factory bodies that call `await import('./local.js')` will
  // STILL hang because ESM import() inside factories is intercepted by
  // mock.module. Those test files must be refactored.
  mock.module(mockId, () => syncActual as object);
  factoryResult
    .then((exports) => {
      if (typeof exports === 'object' && exports !== null) {
        mock.module(mockId, () => exports as object);
      }
    })
    .catch(() => {
      // Factory error — leave the real module in place
    });
  return undefined;
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
  importActualSync: (id: string): unknown =>
    loadIsolatedModuleSync(resolveActualId(id)),
  resetModules: unsupportedModuleIsolation,
  mock: registerModuleMock,
  doMock: (
    id: string,
    factory?: (importOriginal: () => Promise<unknown>) => unknown,
  ): unknown => {
    // vi.doMock must NOT call the factory eagerly. Unlike vi.mock (which is
    // hoisted and needs eager evaluation to work around Bun's mock.module
    // async deadlock), vi.doMock is called at runtime and the factory should
    // only run when the module is actually imported.
    const mockId = resolveModuleSpecifier(id);
    if (!factory) {
      const resolvedId = resolveActualId(id);
      const realModule = loadIsolatedModuleSync(resolvedId);
      return mock.module(mockId, () => automockValue(realModule, new Map()));
    }
    return mock.module(mockId, () => {
      const result = factory(() => importResolvedActual(resolveActualId(id)));
      return result as object;
    });
  },
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
  clearAllTimers: (): void => {
    // Vitest's vi.clearAllTimers() is a no-op when fake timers are not active.
    // Bun's built-in implementation throws "Fake timers are not active" in
    // that case. Guard against the throw to match Vitest semantics, since 15
    // repository test files call vi.clearAllTimers() unconditionally in
    // afterEach hooks regardless of whether fake timers were activated.
    if (realIsFakeTimers()) {
      realClearAllTimers();
    }
  },
  setSystemTime: (time?: number | Date): void => {
    // Bun provides setSystemTime as a standalone function from bun:test,
    // not on vi. Delegate to it so vi.setSystemTime() works.
    if (time === undefined) {
      bunSetSystemTime();
    } else if (typeof time === 'number') {
      bunSetSystemTime(time);
    } else {
      bunSetSystemTime(time);
    }
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
  'clearAllTimers',
  'setSystemTime',
  'clearAllTimers',
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

// Add describe.sequential as an alias for describe. Bun runs tests
// sequentially by default (--max-concurrency 1 in bun test), so the
// semantic guarantee is preserved without explicit opt-in.
const describeRecord = bunDescribe as unknown as Record<string, unknown>;
if (!describeRecord.sequential) {
  try {
    Object.defineProperty(bunDescribe, 'sequential', {
      value: bunDescribe,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } catch {
    // If defineProperty fails (non-configurable), try direct assignment.
    try {
      describeRecord.sequential = bunDescribe;
    } catch {
      // Property is truly read-only; skip.
    }
  }
}

// Vitest-compatible custom matcher: toHaveBeenCalledExactlyOnceWith.
// Bun's expect does not provide this matcher, so we add it via expect.extend.
// Uses expect(...).toEqual(...) internally so that asymmetric matchers like
// expect.objectContaining / expect.any are handled correctly.
type MockLike = {
  mock?: { calls: unknown[][] };
};

expect.extend({
  toHaveBeenCalledExactlyOnceWith(
    received: unknown,
    ...expected: unknown[]
  ): { pass: boolean; message: () => string } {
    const mockObj = received as MockLike;
    const calls = mockObj?.mock?.calls;
    if (!calls || calls.length !== 1) {
      return {
        pass: false,
        message: () =>
          `Expected mock to be called exactly once, but it was called ${calls?.length ?? 0} times`,
      };
    }
    let pass = true;
    try {
      expect(calls[0]).toEqual(expected);
    } catch {
      pass = false;
    }
    return {
      pass,
      message: () =>
        pass
          ? 'Expected mock not to have been called exactly once with the given arguments'
          : `Expected mock to have been called exactly once with [${expected.map((a) => JSON.stringify(a)).join(', ')}], but was called with [${calls[0].map((a) => JSON.stringify(a)).join(', ')}]`,
    };
  },
});

// Also register mock.module('vitest') as a fallback for environments where
// the built-in handler does NOT intercept (e.g., non-test contexts).
export { viAugmentations };
