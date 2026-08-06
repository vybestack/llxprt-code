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
 *    is `void | Promise<void>`. Registration is synchronous and no caller
 *    awaits it.
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
 * corrections applied. It adds no behaviour; every member it exposes is
 * Bun's own.
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
// (a) vi — correct the declared return type of mock().
// ---------------------------------------------------------------------------

interface ViTypeCorrections {
  /**
   * Bun types `vi.mock` as `typeof mock.module`, whose return type includes a
   * `Promise<void>` arm. Registration is synchronous and no call site awaits
   * it, so the declared promise makes `no-floating-promises` fire on every
   * top-level `vi.mock(...)`.
   */
  mock: (path: string, factory?: () => unknown) => void;
}

/** Bun's `vi` minus the `mock` member we are overriding. */
type BunViWithoutMock = Omit<typeof bunVi, 'mock'>;

export type Vi = BunViWithoutMock & ViTypeCorrections;

/**
 * The runtime `vi` object. The cast only corrects the declared return type of
 * `mock`; every member consumers use is Bun's own.
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
