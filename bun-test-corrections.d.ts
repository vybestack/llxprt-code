/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Type-only corrections for the narrow `bun-types` split.
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
 *
 * `bun-types@1.3.14` also predates `expect.fail()`, which the Bun runtime has
 * provided since 1.1.x. The callable `Expect` interface is declared in
 * `bun:test`, so it can be merged here the same way.
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
  }

  interface Expect {
    /** Fails the test with the given message (always throws). */
    fail(message?: string | Error): never;
  }
}

/**
 * `import.meta.dir` is declared by `bun-types/globals`, which these projects
 * deliberately do not load: it also redeclares the global `fetch` with Bun's
 * `preconnect` member, which is not assignable from the plain `fetch` shape
 * that provider sources are written against. The projects therefore take the
 * narrow `bun-types/test` + `bun-types/test-globals` pair and restate the one
 * runtime member they still need here.
 *
 * Bun has provided this since 1.0; it is the directory containing the current
 * module, and the `run-bun-tests.ts` runners anchor their paths on it.
 */
interface ImportMeta {
  /** Absolute path of the directory containing this module. */
  readonly dir: string;
}
