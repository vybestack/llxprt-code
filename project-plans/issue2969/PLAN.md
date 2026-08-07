# Issue #2969 — Rewrite all vitest imports to bun:test and delete the Vitest compatibility shim

## Goal

Every test source imports `bun:test` and calls genuine Bun APIs.
`test-setup/bun-vitest-compat.ts` and `test-setup/augment-bun-vi.ts` are deleted,
nothing monkey-patches Bun's `vi`, and no module re-exports or emulates the
Vitest module.

## Baseline (captured on `main` at 42ca2a989)

- Full suite: **20,592 passing test cases**, 1 pre-existing failure
  (`packages/cli/src/integration-tests/loadbalancer.integration.test.ts`, caused
  by a stale `packages/cli/bundle/llxprt.js`, unrelated to this work).
- 2,073 tracked files imported the `vitest` specifier; 198 imported `bun:test`.

## Native `bun:test` surface (Bun 1.3.14, verified by probe)

`vi` provides exactly: `fn`, `spyOn`, `mock`, `restoreAllMocks`, `clearAllMocks`,
`resetAllMocks`, `useFakeTimers`, `useRealTimers`, `advanceTimersByTime`,
`advanceTimersToNextTimer`, `runAllTimers`, `runOnlyPendingTimers`,
`getTimerCount`, `clearAllTimers`, `isFakeTimers`.

The module additionally exports `mock`, `spyOn`, `setSystemTime`, `expect`,
`expectTypeOf`, `describe`, `it`, `test`, the lifecycle hooks, `onTestFinished`,
`setDefaultTimeout` and the `Mock` type.

Everything else the suites call today is installed at runtime by
`augment-bun-vi.ts`. `vi` is declared as `export const vi: { … }` — an anonymous
object type on a const — so it **cannot** be extended by declaration merging.
Any approach that keeps the augmented `vi` therefore also requires a re-export
barrel, which the issue forbids. The augmented calls must be converted.

## Conversion mapping

| Shim API | Files | Conversion |
| --- | --- | --- |
| `vi.mocked(x)` | 291 | Runtime identity. Cast to `Mock<typeof x>`. |
| `vi.hoisted(f)` | 268 | The shim evaluates it eagerly as `f()`; inline it. |
| `vi.mock(id, importOriginal => …)` | 244 | Capture the real module before mocking, then `mock.module(id, () => ({ ...actual, … }))`. |
| `vi.importActual(id)` | 79 | Same capture-before-mock restructure. |
| `vi.waitFor` | 75 | `waitFor` from `test-setup/stub-helpers.ts` (retained; it is a polling utility, not Vitest emulation). |
| `advanceTimersByTimeAsync` / `runAllTimersAsync` / `runOnlyPendingTimersAsync` | ~70 | Bun's sync timer primitive plus the microtask-drain helper in `stub-helpers.ts`. |
| `vi.stubEnv` / `stubGlobal` / `unstubAll*` | ~50 | Explicit save in `beforeEach`, restore in `afterEach`. |
| `vi.clearAllTimers()` | 24 | Bun throws when fake timers are inactive; guard with `vi.isFakeTimers()`. |
| `toHaveBeenCalledExactlyOnceWith(…)` | 22 | `toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith(…)`. |
| `vi.setSystemTime` | 15 | `setSystemTime` imported from `bun:test`. |
| `it.runIf(c)` / `describe.runIf(c)` | 10 | `it.skipIf(!c)`. |
| `describe.sequential` | 7 | Plain `describe`; Bun runs a file's tests sequentially. |
| `vi.isMockFunction` | 4 | `isMockFunction` from `test-setup/stub-helpers.ts`. |
| `vi.doMock` / `doUnmock` / `unmock` | ~40 | `mock.module` registration / re-registration. |
| `vi.restoreAllMocks()` | 297 | Native. Bun keeps module mocks across it (verified by probe). |
| `vi.resetModules` | 12 | Comment-only references; nothing to convert. |

Type-only imports Bun does not export — `Mocked`, `MockedFunction`,
`MockInstance` (35 files) — map onto `Mock<T>` or the concrete interface,
decided per site.

Custom matchers (`toHaveOnlyValidCharacters`, `toHaveBeenCalledOnce`, …) are
declared by merging into the `Matchers` **interface**, which bun-types does
expose for extension.

## Verified conversion idioms

Each was executed against Bun 1.3.14 before adoption:

1. Capturing the real module with a top-level `await import(id)` before
   `mock.module(id, …)` yields the genuine exports and lets a factory spread
   them.
2. `setSystemTime` is a real `bun:test` export and moves the clock.
3. `it.skipIf(!condition)` reproduces `it.runIf(condition)`.
4. Bun's `restoreAllMocks()` leaves a `mock.module` registration in place.

## Sequencing

1. Rewrite the module specifier everywhere (**done**, 1996 files).
2. Convert the trivially-native calls.
3. Convert `vi.hoisted`, then `vi.mocked`.
4. Convert env/global stubbing.
5. Convert `waitFor` and the async timer helpers.
6. Convert the mock-factory and `importActual` restructures.
7. Resolve the remaining type-only imports and custom matchers.
8. Delete `augment-bun-vi.ts`, `bun-vitest-compat.ts`, their fixtures and their
   own tests; strip every preload reference.
9. Confirm test-case parity against the 20,592 baseline with no new skips.

## Out of scope

Removing the `vitest` devDependency, the Vitest config files and the
`test:vitest` scripts — those belong to the teardown issue (#2970).
