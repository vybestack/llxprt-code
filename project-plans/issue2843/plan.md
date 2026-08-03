# Issue #2843 — Migrate the CLI workspace to Bun-native test execution

## Behavior to deliver

The `cli` workspace must execute its entire unit-test suite with Bun's native
test runner instead of Vitest.

1. `packages/cli/package.json` `test` and `test:ci` run Bun; `test:vitest`
   remains as the transitional fallback.
2. Every non-integration test file under `packages/cli/` is discovered and
   executed. No manifest, allow-list, or exclusion list filters the run.
3. No test is dropped, filtered, or newly skipped relative to the Vitest run.
4. Vitest-only APIs that Bun cannot support are refactored in the affected
   test files rather than silenced.
5. CI runs the CLI workspace under Bun on the required platforms.

## Inputs and boundaries

- **Discovery root**: `src/`, `test/`, `test-bun/`, `test-utils/`.
- **Selected**: `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`.
- **Excluded**: `*.integration.test.*` / `*.integration.spec.*`. These remain
  owned by `test:integration`, exactly as under `vitest.config.ts`.
- **Isolation**: one `bun test` process per file. Bun's `mock.module` registry
  is process-wide, so a shared process would leak module mocks between files.
- **Discovered count**: 649 unit test files (675 total minus 26 integration).

## Baseline measurement

`bun run-bun-tests.ts` against unmodified sources: **472 / 649 files passing**.

The 177 failures fell into a small number of root causes, all confirmed by
direct probes rather than inspection:

| Root cause | Scope |
| --- | --- |
| `vi.mock()` with an `async` factory never registered the mock | shared shim |
| Preload cleanup helpers replaced by a test's `@vybestack/llxprt-code-core` mock | cli preload |
| `describe`/`it`/`expect` used as globals (Vitest `globals: true`) | cli preload |
| Automock invoked prototype getters (`node:child_process`) and threw | shared shim |
| `.js` specifiers that map to `.tsx` sources failed to resolve | shared shim |
| `vi.resetModules()` / `vi.unmock()` (unsupported by Bun) | per-file refactor |
| Module-scope capture of a mock before its `vi.mock()` call | per-file refactor |
| `resolves.not.toThrow()` (broken under Bun) | per-file refactor |
| `@fast-check/vitest` | per-file refactor |
| Chai-style `expect(x).equals(y)` | per-file refactor |

## Infrastructure changes (shared)

`test-setup/augment-bun-vi.ts`

- Async `vi.mock` factories are now settled synchronously with
  `drainMicrotasks()` from `bun:jsc` and registered before the test module body
  continues. Vitest hoists `vi.mock`, so registration must not be deferred to a
  microtask. A genuinely pending factory still falls back to deferred
  re-registration, and that fallback now also registers the absolute resolved
  specifier because Bun resolves a relative `mock.module` specifier against the
  module executing at call time.
- Automock copies accessor properties as accessors instead of reading them, so
  a prototype getter such as `ChildProcess.prototype.stdin` cannot abort the
  automock.

`test-setup/module-resolution.ts`

- A `.js` specifier now falls back to `.ts` **and** `.tsx`.

`packages/cli/bun-test-setup.ts`

- Captures `DebugLogger.resetForTesting` and
  `clearActiveProviderRuntimeContext` at preload time so a test that mocks the
  core package cannot break the shared `afterEach` cleanup.
- Publishes the `bun:test` lifecycle/assertion functions as globals, matching
  the `globals: true` contract of `vitest.config.ts`.

## Tests that prove it

Behavioral, no mock theater:

1. `packages/cli/run-bun-tests.test.ts` — discovery contract: unit test files
   are selected, integration files and non-test files are not.
2. `test-setup/augment-bun-vi.test.ts` — an async `vi.mock` factory is visible
   to a module-scope capture taken after the `vi.mock` call, and automocking a
   module with a throwing prototype getter succeeds.
3. `scripts/tests/bun-workspaces.test.ts` — the CLI package scripts and CI
   workflow run the workspace under Bun.
4. The suite itself: `bun run-bun-tests.ts` exits 0 with every discovered file
   passing, and the discovered file count matches the file system.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and the CLI smoke test.
