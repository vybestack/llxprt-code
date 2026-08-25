/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Type-only corrections to `bun:test`.
 *
 * Bun's `.rejects` and `.resolves` accessors return the same `Matchers` object
 * as a synchronous assertion, so every matcher reached through them is declared
 * as returning `void`. At runtime they return a promise that settles when the
 * assertion completes, and every call site awaits it — which is required, or a
 * rejected expectation would escape the test. The `void` declaration makes
 * `@typescript-eslint/await-thenable` fire on each of those awaits.
 *
 * `Matchers` is an interface that extends `MatchersBuiltin`, so the two
 * accessors can be narrowed here. A derived member only has to stay assignable
 * to the one it overrides, and a function returning `Promise<void>` is
 * assignable to one returning `void`.
 *
 * This adds no runtime behaviour and re-exports nothing; it only describes what
 * Bun already does.
 */

declare module 'bun:test' {
  /** Every matcher on `M`, re-typed to return the promise it actually returns. */
  type AwaitedMatchers<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => unknown
      ? (...args: A) => Promise<void>
      : M[K];
  };

  interface Matchers<T = unknown> {
    rejects: AwaitedMatchers<MatchersBuiltin<unknown>>;
    resolves: AwaitedMatchers<MatchersBuiltin<Awaited<T>>>;
    /**
     * Implemented by Bun's `expect` at runtime (verified against Bun 1.3.14)
     * but not declared by `bun-types`. Declared here rather than in one
     * package because more than one workspace asserts with it.
     */
    toHaveBeenCalledOnce(): T;
  }
}
