# Issue #2968 — Remove the Bun EXCLUDE list from packages/core

## Goal

Make the six core test files currently routed to Vitest execute under Bun's
native test runner, then delete the escape hatch (`EXCLUDE` in
`packages/core/run-bun-tests.ts`) and the `test:vitest` script from
`packages/core/package.json`.

## Measured baseline (captured on `main`, before any change)

### Vitest run of the six excluded files

    npx vitest run --reporter=verbose <the six files>

| File                                          | Vitest passing cases |
| --------------------------------------------- | -------------------- |
| src/recording/SessionRecordingService.test.ts   | 33                   |
| src/recording/resumeSession.test.ts             | 20                   |
| src/recording/sessionCleanupUtils.test.ts       | 28                   |
| src/recording/sessionManagement.test.ts         | 0 — SUITE FAILS      |
| src/hooks/hookRunner.consoleIsolation.test.ts   | 2                    |
| src/utils/retry.quota.test.ts                   | 27                   |
| **Total**                                       | **110 + 1 failed suite** |

The exact test-case name lists are captured under `/tmp/parity/*.vitest.txt`
and are the parity oracle for the migrated Bun run.

### Vitest run of the four non-excluded sibling recording files

| File                                     | Vitest | Bun (current `main`) |
| ---------------------------------------- | ------ | -------------------- |
| src/recording/SessionDiscovery.test.ts    | —      | 22 pass / 0 fail     |
| src/recording/SessionLockManager.test.ts  | —      | 31 pass / 0 fail     |
| src/recording/integration.basic.test.ts   | —      | 16 pass / 0 fail     |
| src/recording/integration.advanced.test.ts| —      | 20 pass / 0 fail     |
| **Total**                                 | **89** | **89**               |

These four files only mention `@fast-check/vitest` in a doc comment; they
import bare `fast-check` and `it` from `vitest`. They already achieve exact
count parity under Bun. **No code change is required for them** — the issue's
"reconcile" requirement is satisfied by this verification, which is recorded
here and in the PR description.

## Blockers found, with evidence

### B1 — `@fast-check/vitest` throws at import time under Bun

Affected: `SessionRecordingService.test.ts`, `resumeSession.test.ts`,
`sessionCleanupUtils.test.ts`.

    TypeError: undefined is not an object (evaluating 'testFn[key]')
        at buildTest (node_modules/@fast-check/vitest/lib/internals/TestBuilder.js:65:33)

The package walks the Vitest `it` object's sub-properties (`it.concurrent`,
`it.fails`, …). Bun's injected `vitest` shim does not expose the same shape,
so the module blows up on load and the whole file yields `0 pass / 1 fail`.

Fix: remove the `@fast-check/vitest` import from all three files.

- Plain `itProp('name', async () => { … })` (no `.prop`) is not a property
  test at all — it is a passthrough to `it`. Rewrite as `it('name', …)`.
- `it.prop([arb, …], opts?)('name', async (a, …) => { … })` becomes

      it('name', async () => {
        await fc.assert(
          fc.asyncProperty(arb, …, async (a, …) => { … }),
          opts,
        );
      });

  This is exactly the pattern already used by the passing sibling files
  (e.g. `sessionManagement.test.ts` `Property-Based Tests` block), so it is
  the established project convention, not a new invention.

  `fc.assert` fails on a falsy predicate return; the bodies here assert with
  `expect`, which throws — behaviour is preserved.

### B2 — `sessionManagement.test.ts` references an undefined `itProp`

The file imports `it` from `vitest` and never imports `itProp`, yet calls
`itProp(...)` three times (lines 406, 579, 599).

- Under **Vitest** this is a collection-time `ReferenceError` that fails the
  entire suite: all 20 of its tests currently run **zero** times, and
  `npm run test:vitest -w packages/core` is therefore red on `main`.
- Under **Bun** it produces two "unhandled error between tests" reports and
  silently drops those three cases (17 of 20 run).

Fix: these three calls pass no arbitraries — they are plain example-based
tests. Change `itProp` to `it`.

Result: **25 passing cases** under Bun, and **25 under Vitest** as well. Only
17 ran under Bun before the fix — the two aborted `describe` callbacks took
the 3 broken cases plus 5 healthy siblings down with them.

### B3 — `hookRunner.consoleIsolation.test.ts` reads a stale mock call index

The second test asserts on `vi.mocked(spawn).mock.calls[0][2]`, i.e. the
*first ever* recorded call. Under Vitest the module-level `vi.fn()` from the
`vi.mock` factory is reset between tests by `vi.restoreAllMocks()`; under Bun
`restoreAllMocks` does not clear a factory-created `vi.fn()`, so `calls[0]`
is still the `win32` call from the first test and `windowsHide` is `true`.

This is order-dependence in the test, not a `process.platform` limitation —
`Object.defineProperty(process, 'platform', …)` works correctly under Bun (the
`win32` test passes).

Fix: clear the spawn mock in `beforeEach` so each test observes only its own
call. Keeps both assertions intact; no assertion is weakened or skipped.

### B4 — `retry.quota.test.ts` deadlocks the Bun process

All 27 cases report `(pass)` and then the process never exits. Isolating each
case shows the hang is exactly:

    'retries a DOMException TimeoutError and succeeds when a later attempt succeeds'

which uses

    await Promise.all([
      expect(promise).resolves.toBe('success'),
      vi.runAllTimersAsync(),
    ]);

Racing an unsettled `expect(...).resolves` against the fake-timer drain
deadlocks under Bun. A scratch reproduction confirmed the sequential form

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('success');

passes in 2.7 ms. The sequential form is already what the very next test in
the same `describe` does, so this aligns the two.

Fix: sequence the drain before the assertion. Same assertions, same count.

## Changes to make

1. `packages/core/src/recording/SessionRecordingService.test.ts` — drop the
   `@fast-check/vitest` import, add `it` to the `vitest` import, convert the
   9 `it.prop` blocks to `fc.assert(fc.asyncProperty(...))`.
2. `packages/core/src/recording/resumeSession.test.ts` — drop the import,
   add `it` to the `vitest` import, rename 14 plain `itProp` → `it`, convert
   6 `itProp.prop` blocks.
3. `packages/core/src/recording/sessionCleanupUtils.test.ts` — same shape:
   16 plain → `it`, 12 `.prop` blocks converted.
4. `packages/core/src/recording/sessionManagement.test.ts` — 3 stray
   `itProp` → `it`.
5. `packages/core/src/hooks/hookRunner.consoleIsolation.test.ts` — clear the
   spawn mock between tests.
6. `packages/core/src/utils/retry.quota.test.ts` — sequence the timer drain.
7. `packages/core/run-bun-tests.ts` — delete `EXCLUDE`, its comment, the
   `!EXCLUDE.has(...)` condition and the now-unused `sep` import.
8. `packages/core/package.json` — delete the `test:vitest` script.
9. Update the stale doc-comment line in each migrated recording test that
   claims tests use `@fast-check/vitest`, so the comment matches reality.

## Knock-on lint work (not optional, not scope creep)

Removing the `@fast-check/vitest` indirection made `npm run lint` fail with 72
errors that had never been reported before:

- 71 × `vitest/no-conditional-expect` / `vitest/no-conditional-in-test`
- 1 × `max-lines` on `SessionRecordingService.test.ts` (812 > 800)

The lint errors are not new defects. `@vitest/eslint-plugin` only lints call
expressions it recognises as test declarations. While these files declared
tests through the aliased identifier `itProp`, the plugin saw nothing and the
bodies went unlinted. Plain `it(...)` is recognised, so the pre-existing smells
finally surfaced. Silencing them would defeat the purpose of the migration, so
they are fixed:

- **Conditional assertions.** Bodies used `if (result.ok) { …expects… }` purely
  to narrow a discriminated union. That means a regression flipping `ok` to
  `false` would silently skip every assertion inside. Replaced with two
  file-local helpers in `resumeSession.test.ts` that couple the runtime
  assertion to the narrowing, so the narrowed value cannot be obtained unless
  the assertion passed:

      function expectOk<T extends { ok: boolean }>(
        result: T,
      ): Extract<T, { ok: true }>;
      function expectNotOk<T extends { ok: boolean }>(
        result: T,
      ): Extract<T, { ok: false }>;

  The two single-site cases in `sessionManagement.test.ts` and
  `sessionCleanupUtils.test.ts` were made unconditional directly.

- **`max-lines`.** The threshold was NOT raised. The 9 property tests each
  repeated the same mkdtemp / mkdir / try-finally-rm scaffold; that was
  extracted into a generic `withTempChatsDir<T>(prefix, body)` helper, taking
  the file from 812 to 750 counted lines while removing the duplication.

`SessionLockManager.test.ts` also imported `it as itProp` from `vitest` — the
same plugin-blinding alias, with no fast-check involved at all. The alias is
removed; the file lints clean and still passes 31/31.

## Review findings and triage

Two independent reviews were run.

Accepted and fixed:

- `retry.quota.test.ts` attached its `.resolves` expectation only after
  `runAllTimersAsync()` had already driven the retry loop, leaving a window in
  which a rejection would surface with no handler attached. The promise is now
  settled into a tagged outcome up front and the outcome asserted after the
  drain.
- Stale header comments claiming `@fast-check/vitest` usage were corrected in
  all six migrated files and in the four sibling recording tests. The
  `SessionLockManager.test.ts` header additionally claimed property-based
  coverage it has never had; that claim is removed rather than restated.
- `dev-docs/test-runner-inventory.md` asserted that every migrated workspace
  keeps a `test:vitest` fallback. Core no longer does; the entry now says so.
- 20 inline `as Extract<typeof result, …>` casts in `resumeSession.test.ts`
  were centralised behind the two helpers above, so one cast is enforced by an
  assertion instead of 20 unchecked ones.

Rejected, with reasons:

- "Restore the `if (filePath !== null)` guard around the `expect`." The
  premise is wrong: `expect(filePath).not.toBeNull()` throws first, so the
  following `filePath!` is never evaluated when the value is null. The
  suggested fix would also reintroduce the `vitest/no-conditional-expect`
  error this work exists to remove.
- "Use `if (!result.ok) throw …` instead of the narrowing helper." That
  reintroduces a conditional in a test body and trips
  `vitest/no-conditional-in-test`.
- "The property tests leak a lock handle when an assertion fails, and the old
  `if (result.ok)` form avoided it." The `dispose()`/`release()` calls sit
  after the assertions in exactly the same order as on `main`; the old `if`
  form had the identical gap. Pre-existing, unchanged by this work, and only
  reachable on a failing test.

## Out of scope

- Any workspace other than `core`.
- Removing Vitest deps/config repo-wide, or the `test:vitest` script in other
  workspaces.
- `dev-docs/test-runner-inventory.md`'s general statement about per-workspace
  `test:vitest` scripts remains true for the other workspaces.

## Observed but deliberately not changed

Two more places in `packages/core` route test declarations through an
identifier `@vitest/eslint-plugin` does not recognise. Neither is named by the
issue, neither is excluded from Bun, and both pass:

- `src/recording/SessionLockManager.property.test.ts` — `import { it as itProp }
  from 'vitest'`, the same blinding alias removed from its sibling.
- `src/recording/integration.advanced.test.ts` — a local, correctly typed
  `it.prop` polyfill that already drives `fc.assert(fc.asyncProperty(...))`
  through `it`. This is a working adapter, not a stale shim.

`src/hooks/__tests__/hookSystem-lifecycle.test.ts` also has a header comment
claiming `@fast-check/vitest` while importing bare `fast-check`. It has no
`@fast-check/vitest` import, so it does not violate the acceptance criteria.

All three are adjacent cleanup outside this issue's scope and are left for a
follow-up.

## Acceptance evidence required

- `bun test --preload ./bun-preload.ts <file>` for each of the six files:
  exits 0, process terminates (no hang), no "unhandled error between tests".
- Per-file Bun test-name list diffed against `/tmp/parity/*.vitest.txt`:
  identical sets for the five files that collected under Vitest.
  `sessionManagement.test.ts` has no Vitest baseline (broken suite) and must
  reach 25 passing cases.

## Result

| File                                          | Vitest before | Bun after |
| --------------------------------------------- | ------------- | --------- |
| src/recording/SessionRecordingService.test.ts   | 33            | 33        |
| src/recording/resumeSession.test.ts             | 20            | 20        |
| src/recording/sessionCleanupUtils.test.ts       | 28            | 28        |
| src/recording/sessionManagement.test.ts         | 0 (suite red) | 25        |
| src/hooks/hookRunner.consoleIsolation.test.ts   | 2             | 2         |
| src/utils/retry.quota.test.ts                   | 27            | 27        |

For the five files that collected under Vitest, the sorted list of passing
test-case names is byte-identical between the Vitest baseline and the Bun
run — not merely the counts. `sessionManagement.test.ts` also now passes
25/25 under Vitest, confirming the `itProp` fix is a genuine repair rather
than a Bun-specific workaround.
- `grep -r "@fast-check/vitest" packages/core/` returns nothing.
- `grep -n EXCLUDE packages/core/run-bun-tests.ts` returns nothing.
- `npm run test`, `lint`, `typecheck`, `format`, `build` all pass.
