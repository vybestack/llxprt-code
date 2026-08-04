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
- **Discovered count**: 650 unit test files.

## Runner

`packages/cli/run-bun-tests.ts` walks the test roots, runs each file in its own
`bun test` process with bounded concurrency, and writes `junit.xml`. It has no
allow-list: discovery is purely structural, and
`packages/cli/test/run-bun-tests.test.ts` pins that contract against a real
temporary directory tree so a filtered subset cannot be reintroduced silently.

CI needs no workflow change: `bun scripts/test.ts --shard cli` already expands
to the workspace's own `test` script, the same mechanism core, auth and
providers use.

## Shared compatibility shim

`test-setup/augment-bun-vi.ts` is shared with core, auth, providers and the
script suites, so every change below was verified against all of them.

| Divergence | Resolution |
| --- | --- |
| `vi.mock` async factories never registered | settle synchronously with `drainMicrotasks()` from `bun:jsc` |
| Deferred re-registration missed relative specifiers | also register the absolute resolved id |
| `vi.spyOn` reused an existing mock's call history | install a fresh delegating spy, matching Vitest |
| `restoreAllMocks` reverted `vi.mock` module mocks | re-apply the registered module mocks afterwards |
| Automock invoked prototype getters and threw | copy accessor properties as accessors |
| Automocked CommonJS modules had no `default` | synthesise one, matching Vitest's automocker |
| `vi.unmock` threw | restore the exports snapshotted before the mock was registered |
| `.js` specifiers resolving to `.tsx` sources failed | add `.tsx` to the resolution fallbacks |
| Built-in namespaces lost exports when snapshotted | read accessor properties when snapshotting |
| `advanceTimersByTimeAsync(0)` ran no timers | run the already-due timers |
| Mocking an async-ESM dependency threw at registration | register without a snapshot; `importOriginal` rethrows only if called |

### Deliberately NOT normalised

`vi.fn()` restore semantics. Vitest's `restoreAllMocks` / `mockRestore` return a
mock to the implementation it was constructed with; Bun's leave it cleared.
Wrapping `vi.fn` to hide that **broke mock-as-constructor** — `new someMock()`
stopped producing the object its implementation returns, which failed
`packages/core/src/code_assist/oauth-credential-storage.test.ts`. The wrapper
was removed. Tests that need a specific implementation after a restore set it
explicitly instead.

## CLI preload

`packages/cli/bun-test-setup.ts` additionally:

- captures `DebugLogger.resetForTesting` and
  `clearActiveProviderRuntimeContext` before any test can mock the core package;
- publishes the `bun:test` lifecycle/assertion functions as globals, matching
  the `globals: true` contract of `vitest.config.ts`;
- resets `process.exitCode` after each test, because a Bun test file *is* the
  process and code under test sets it to signal failure.

## Snapshots

Vitest stores snapshot keys as `Describe > test 1`; Bun uses `Describe test 1`.
Left alone, Bun silently *appended* fresh snapshots and every snapshot
assertion passed vacuously. All 24 `.snap` files were converted to Bun's key
format.

## Recurring per-file patterns

- Bun does not hoist `vi.mock`. A module-scope capture written before the
  matching `vi.mock` sees the real export; move the `vi.mock` above it, or load
  the module under test with a top-level `await import` after the mocks.
- `vi.fn().mockImplementation(function () { this.x = … })` used with `new` does
  not apply reliably. Use a real class.
- Fixed sleeps after a keystroke or a stream event are races. Poll with
  `waitFor`.
- Assertions on built-in error text differ between V8 and JavaScriptCore.
- yargs calls `process.exit` unless `.exitProcess(false)` is set, which under
  Bun terminates the test file mid-run.

## Test-count parity

`run-bun-tests.ts` aggregates each file's Bun summary and prints the totals, so
parity is checked mechanically rather than by eye:

```
Passed 607/650 CLI test files
Test cases: 7920 passed, 263 failed, 6 skipped, 13 todo (8202 total)
```

Only 6 skips and 13 todos exist across the whole workspace, and none were added
by this migration.

The Vitest side cannot produce a comparable total locally: `npx vitest run` in
this workspace dies with

```
FATAL ERROR: Ineffective mark-compacts near heap limit
Allocation failed - JavaScript heap out of memory
```

leaving a zero-byte `junit.xml`. The Bun runner completes the same workspace
because each file gets its own short-lived process. Parity therefore has to be
established per file rather than from a single Vitest total, and every file
fixed during this migration was checked on both runners individually.

## Verification

`npm run format`, `npm run build`, `tsc --noEmit`, `eslint`, the CLI smoke test,
and the Bun suites for core (326/326), providers (479/479), auth (33/33) and
test-setup (3/3).
