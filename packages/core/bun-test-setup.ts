/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local Bun preload for `packages/core`.
 *
 * Bun's native test runner (`bun test`) exposes a `vi` object on `bun:test`,
 * but that object only implements a subset of the Vitest `vi` surface. The
 * core suite relies on several Vitest helpers that Bun does not ship natively
 * (`vi.mocked`, `vi.hoisted`, `vi.stubEnv`, `vi.stubGlobal`, `vi.waitFor`,
 * `vi.setSystemTime`, the async timer helpers, `it.runIf`, ...). This preload
 * augments the shared `bun:test` `vi`/`it` objects in place so the migrated
 * `import ... from 'bun:test'` test files behave the same under Bun as they did
 * under Vitest.
 *
 * It also performs the runtime bootstrapping that `test-setup.ts` provided to
 * the Vitest runner (registering a provider runtime context so tests do not
 * throw `MissingProviderRuntimeError`). Under Vitest this file is aliased to
 * `vitest` and `setupFiles: ['./test-setup.ts']` runs the bootstrap; under Bun
 * the `[test] preload` in `bunfig.toml` loads this module instead.
 */

import {
  vi as bunVi,
  it as bunIt,
  beforeAll,
  beforeEach,
  afterEach,
  setSystemTime,
} from 'bun:test';
import { StubRegistry, waitFor, isMockFunction } from '../../test-setup/stub-helpers.js';
import { setSimulate429 } from './src/utils/testUtils.js';
import { clearActiveProviderRuntimeContext } from './src/runtime/providerRuntimeContext.js';
import { initializeTestProviderRuntime } from './src/test-utils/runtime.js';

// ---------------------------------------------------------------------------
// vi augmentation
// ---------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

const viRecord = bunVi as unknown as UnknownRecord;

const envRegistry = new StubRegistry(process.env as UnknownRecord);
const globalRegistry = new StubRegistry(globalThis as unknown as UnknownRecord);

/**
 * Vitest's async timer helpers drain the microtask queue after advancing fake
 * time so timer callbacks and their promise chains settle before the awaiting
 * test resumes. Under Bun's fake timers a real macrotask (`setTimeout(fn, 0)`)
 * never fires while fake time is frozen, so we must flush via microtasks only.
 * A bounded loop of `await Promise.resolve()` alternates microtask boundaries
 * so chained `.then()` callbacks settle without hanging.
 */
const MAX_MICROTASK_ITERATIONS = 100;

const flushPendingTasks = async (): Promise<void> => {
  for (let i = 0; i < MAX_MICROTASK_ITERATIONS; i++) {
    await Promise.resolve();
  }
};

/**
 * Assigns a helper onto the shared `vi` object only when Bun does not already
 * provide it, so we never clobber a native implementation.
 */
const definePolyfill = (name: string, impl: unknown): void => {
  if (typeof viRecord[name] !== 'function') {
    viRecord[name] = impl;
  }
};

definePolyfill('mocked', <T>(item: T): T => item);
definePolyfill('hoisted', <T>(factory: () => T): T => factory());
definePolyfill('stubEnv', (key: string, value: string): void => {
  envRegistry.stub(key, value);
});
definePolyfill('unstubAllEnvs', (): void => {
  envRegistry.restoreAll();
});
definePolyfill('stubGlobal', (key: string, value: unknown): void => {
  globalRegistry.stub(key, value);
});
definePolyfill('unstubAllGlobals', (): void => {
  globalRegistry.restoreAll();
});
definePolyfill('waitFor', waitFor);
definePolyfill('isMockFunction', isMockFunction);
definePolyfill('setSystemTime', setSystemTime);

// Bun has no module-reset primitive; keep code that calls these from crashing.
definePolyfill('resetModules', (): void => {});
definePolyfill('unmock', (): void => {});
definePolyfill('doUnmock', (): void => {});

const nativeAdvanceTimersByTime = bunVi.advanceTimersByTime.bind(bunVi);
const nativeRunAllTimers = bunVi.runAllTimers.bind(bunVi);
const nativeRunOnlyPendingTimers = bunVi.runOnlyPendingTimers.bind(bunVi);

definePolyfill(
  'advanceTimersByTimeAsync',
  async (ms: number): Promise<void> => {
    nativeAdvanceTimersByTime(ms);
    await flushPendingTasks();
  },
);
definePolyfill('runAllTimersAsync', async (): Promise<void> => {
  nativeRunAllTimers();
  await flushPendingTasks();
});
definePolyfill('runOnlyPendingTimersAsync', async (): Promise<void> => {
  nativeRunOnlyPendingTimers();
  await flushPendingTasks();
});

// ---------------------------------------------------------------------------
// it augmentation
// ---------------------------------------------------------------------------

interface RunIfCapable {
  runIf?: (condition: boolean) => typeof bunIt;
  skip: typeof bunIt;
}

const itWithRunIf = bunIt as unknown as RunIfCapable;
if (typeof itWithRunIf.runIf !== 'function') {
  itWithRunIf.runIf = (condition: boolean): typeof bunIt =>
    condition ? bunIt : bunIt.skip;
}

// ---------------------------------------------------------------------------
// Global stub restoration (mirrors the shared compat shim)
// ---------------------------------------------------------------------------

afterEach(() => {
  envRegistry.restoreAll();
  globalRegistry.restoreAll();
});

// ---------------------------------------------------------------------------
// Runtime bootstrapping (mirrors test-setup.ts under Vitest)
// ---------------------------------------------------------------------------

// Unset NO_COLOR so theme behavior is consistent between local and CI runs.
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
}

// Disable 429 simulation globally for all tests.
setSimulate429(false);

function bootstrapRuntime(scope: string): void {
  initializeTestProviderRuntime({
    runtimeId: `test-global-runtime.${scope}`,
    metadata: { source: `bun-test-setup.ts:${scope}` },
  });
}

beforeAll(() => {
  bootstrapRuntime('beforeAll');
});

// Set up a runtime context for all tests to prevent MissingProviderRuntimeError.
beforeEach(() => {
  bootstrapRuntime('beforeEach');
});

afterEach(() => {
  clearActiveProviderRuntimeContext();
});
