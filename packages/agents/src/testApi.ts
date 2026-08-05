/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single owned facade over the test API that our suites and helpers consume.
 *
 * WHY THIS EXISTS
 *
 * The tests import from `'bun:test'` and run under `bun test`. Two of Bun's
 * type declarations, however, describe Bun's *own* API rather than the
 * augmented API that `test-setup/augment-bun-vi.ts` installs at runtime:
 *
 * 1. **`vi.mock`** — Bun types it as `typeof mock.module`, whose return type
 *    is `void | Promise<void>`. Our shim's `registerModuleMock` registers
 *    the mock **synchronously** and returns `unknown`; callers never await it.
 *    Bun's declared `Promise<void>` arm makes `@typescript-eslint/no-floating-promises`
 *    fire on every top-level `vi.mock(...)` call (323 errors).
 *
 * 2. **`.rejects` / `.resolves` matchers** — Bun declares every matcher
 *    (`.toBe`, `.toThrow`, …) as returning `void`. The `rejects` and
 *    `resolves` accessors simply return the same `Matchers<…>` object, so
 *    their matchers *also* return `void` statically. At runtime, however,
 *    Bun's `.rejects.toBe(...)` and `.resolves.toBe(...)` are awaitable
 *    (they return a Promise that resolves when the assertion completes),
 *    and every test site writes `await expect(x).rejects.toThrow(...)`.
 *    The static `void` return makes `@typescript-eslint/await-thenable`
 *    fire 159 times.
 *
 * The facade re-exports the full Bun test API with exactly these two
 * corrections applied, plus the `vi` shim-additions (`mocked`, `waitFor`,
 * `hoisted`, `stubEnv`, …) that `test-vi.ts` previously typed separately.
 * This replaces `test-vi.ts` so there is **one** import target, not two.
 *
 * CONSTRAINTS
 *
 * - Declare only what **we** add or correct; do not restate Bun's API.
 * - Casts are confined to this file (the boundary assertion) and each is
 *   commented with why it is sound.
 * - No `any` — use `unknown` / generics.
 */

import {
  describe,
  it,
  test,
  expect as bunExpect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  onTestFinished,
  vi as bunVi,
  type Mock,
  type Matchers,
} from 'bun:test';

// ---------------------------------------------------------------------------
// (a) vi — override mock() to return void, and fold in the shim additions.
// ---------------------------------------------------------------------------

/**
 * Narrows T:
 * - If T has a call signature (plain function) → Bun's `Mock<T>`.
 * - If T has a construct signature (class) → `Mock<(...args) => InstanceType<T>>`
 *   & original static members (so `.mockImplementation()` is available on
 *   mocked classes). Mirrors vitest's `MaybeMockedConstructor`.
 * - Otherwise → T unchanged.
 *
 * Uses `(...args: never[]) => unknown` as the function constraint to avoid
 * `any` while remaining permissive (all function types are assignable to it
 * because `never[]` is the bottom type for parameter arrays).
 */
type MaybeMocked<T> = T extends (...args: never[]) => unknown
  ? Mock<T>
  : T extends new (...args: never[]) => infer R
    ? Mock<(...args: ConstructorParameters<T>) => R> & {
        prototype: T extends { prototype: infer P } ? P : unknown;
      }
    : T;

/**
 * The set of members our shim adds on top of Bun's `vi`. Signatures match the
 * real runtime implementations in `test-setup/augment-bun-vi.ts` — not
 * invented. Only members the shim genuinely installs are listed.
 *
 * `mocked` is an identity function at runtime (the item is already a mock
 * after vi.mock replaces it), but its return type is `MaybeMocked<T>` so
 * callers get proper mock-method types (`.mockClear()`, `.mockResolvedValue()`, etc.).
 *
 * `mock` is overridden to return `void` because the shim's
 * `registerModuleMock` registers synchronously and its return value is never
 * consumed. The factory's `importOriginal` is typed as returning a Promise
 * because every call site is written to `await importOriginal()` and the
 * shim deliberately returns a sync value so the await resolves immediately.
 */
interface ViShimAdditions {
  mocked: {
    <T>(item: T): MaybeMocked<T>;
    <T>(item: T, deep: false): MaybeMocked<T>;
    <T>(item: T, deep: true): MaybeMocked<T>;
    <T>(item: T, options: { partial?: false; deep?: false }): MaybeMocked<T>;
    <T>(item: T, options: { partial?: false; deep: true }): MaybeMocked<T>;
    <T>(item: T, options: { partial: true; deep?: false }): MaybeMocked<T>;
    <T>(item: T, options: { partial: true; deep: true }): MaybeMocked<T>;
  };
  /** Async polling helper from test-setup/stub-helpers.ts. */
  waitFor: <T>(
    callback: () => T | Promise<T>,
    options?: number | { interval?: number; timeout?: number },
  ) => Promise<T>;
  hoisted: <T>(factory: () => T) => T;
  stubEnv: (key: string, value: string) => void;
  unstubAllEnvs: () => void;
  stubGlobal: (key: string, value: unknown) => void;
  unstubAllGlobals: () => void;
  importActual: (id: string) => Promise<unknown>;
  importActualSync: (id: string) => unknown;
  isMockFunction: (value: unknown) => value is ((
    ...args: unknown[]
  ) => unknown) & {
    mock: Record<string, unknown>;
  };
  advanceTimersByTimeAsync: (ms: number) => Promise<void>;
  runAllTimersAsync: () => Promise<void>;
  runOnlyPendingTimersAsync: () => Promise<void>;
  setSystemTime: (time?: number | Date) => void;
  resetModules: () => never;
  unmock: () => never;
  doUnmock: () => never;
  doMock: (
    id: string,
    factory?: (importOriginal: () => Promise<unknown>) => unknown,
  ) => unknown;
  /**
   * Corrected signature: the shim registers the mock synchronously and the
   * return value is never consumed. The factory's `importOriginal` is typed
   * as returning a Promise because every call site awaits it and the shim
   * deliberately returns a sync value so `await importOriginal()` resolves
   * immediately.
   */
  mock: (
    path: string,
    factory?: (importOriginal: <T>() => Promise<T>) => unknown,
  ) => void;
}

/** Bun's `vi` minus the `mock` member we are overriding. */
type BunViWithoutMock = Omit<typeof bunVi, 'mock'>;

export type Vi = BunViWithoutMock & ViShimAdditions;

/**
 * The runtime `vi` object — Bun's `vi` after the preload shim has augmented
 * it. The cast is sound because `augment-bun-vi.ts` installs every member of
 * `ViShimAdditions` (including the corrected `mock`) before any consumer
 * imports this module, and the shim's `registerModuleMock` returns `void`.
 */
export const vi = bunVi as Vi;

// ---------------------------------------------------------------------------
// (b) expect — make .rejects / .resolves matchers return Promise<void>.
// ---------------------------------------------------------------------------

/**
 * Maps over a matcher object, turning every function member into one that
 * returns `Promise<void>` instead of its original return type. Only applied
 * to the `rejects` and `resolves` members of Bun's `expect(...)` result, so
 * the static members of `expect` and the regular (non-rejects/resolves)
 * matchers are left untouched.
 */
type AwaitableMatchers<M> = {
  [K in keyof M]: M[K] extends (...args: infer A) => unknown
    ? (...args: A) => Promise<void>
    : M[K];
};

/**
 * `Matchers<T>` with the `rejects` and `resolves` accessors rewritten so
 * their nested matchers return `Promise<void>`. Every other member (`not`,
 * `toBe`, `toEqual`, `pass`, `fail`, …) is preserved as-is.
 *
 * The regular `.not` matcher chain also returns `Matchers`, but those are
 * synchronous assertions (not promise-chained), so we leave them as `void`.
 */
type MatchersWithAwaitableRejectsResolves<T> = Omit<
  Matchers<T>,
  'rejects' | 'resolves'
> & {
  rejects: AwaitableMatchers<Matchers<unknown>>;
  resolves: AwaitableMatchers<Matchers<Awaited<T>>>;
};

/**
 * Bun's `Expect` callable interface, but the call signatures return our
 * corrected `Matchers` (with awaitable `.rejects`/`.resolves`) instead of
 * Bun's original `Matchers`.
 *
 * We intersect with `typeof bunExpect` to preserve ALL static members
 * (`extend`, `any`, `objectContaining`, `not`, `hasAssertions`, …) rather
 * than restating them.
 */
type CorrectedExpect = typeof bunExpect & {
  <T = unknown>(
    actual: T,
    customFailMessage?: string,
  ): MatchersWithAwaitableRejectsResolves<T>;
  <T = unknown>(
    actual?: T,
    customFailMessage?: string,
  ): MatchersWithAwaitableRejectsResolves<T | undefined>;
};

/**
 * Corrected `expect`. The cast is sound because at runtime Bun's
 * `expect(x).rejects.toBe(...)` *does* return a thenable (every test site
 * awaits it); Bun's type declaration simply annotates the matcher return as
 * `void`. This facade asserts the corrected, awaitable return type so
 * `@typescript-eslint/await-thenable` no longer fires. The static members
 * are unchanged (preserved by the intersection with `typeof bunExpect`).
 */
export const expect = bunExpect as CorrectedExpect;

// ---------------------------------------------------------------------------
// Re-export the remaining test API unchanged.
// ---------------------------------------------------------------------------

export {
  describe,
  it,
  test,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  onTestFinished,
};
export type { Mock };
