# Issue #2847 — Migrate remaining workspaces and finalize CI to Bun-native

## Accepted behaviour

1. Every test file in `settings`, `ide-integration`, `vscode-ide-companion`,
   `a2a-server`, `policy`, `telemetry`, `test-utils` executes under Bun's
   native test runner as that workspace's primary `test` / `test:ci` script.
2. Every test file under `scripts/tests/`, `evals/` and `integration-tests/`
   executes under Bun's native test runner.
3. CI invokes Bun-native execution for all test jobs; `bun_native_test_parity`
   runs the complete Bun-native suite.
4. `scripts/test.ts` orchestrates Bun-native execution end to end.
5. `dev-docs/bun.md` and `CONTRIBUTING.md` document one canonical command.
6. Remaining vitest usage is enumerated and proven to be non-execution.
7. No test file is dropped, filtered, newly skipped, or deferred; discovery is
   glob-based so a new test file cannot be silently omitted.

## Preflight findings (measured, not assumed)

Probed by running each file with `bun test` in an isolated process.

| Root | Files | Bun pass | Notes |
| --- | --- | --- | --- |
| `packages/settings` | 15 | 14 | `profiles/__tests__/ProfileManager.test.ts` 1 case fails |
| `packages/ide-integration` | 10 | 6 | `ide-client`, `ide-installer`, `process-utils`, `lsp-entry-path` |
| `packages/vscode-ide-companion` | 7 | 1 | `vscode` module is unresolvable under Bun |
| `packages/policy` | 12 | 12 | already green |
| `packages/telemetry` | 13 | 13 | already green |
| `packages/test-utils` | 11 | 10 | `interactive-run.test.ts` (PTY) fails |
| `packages/a2a-server` | 21 | runs today under `bun test` | manifest lists 15 |
| `scripts/tests` | 197 (+5 `*.bun.test.ts`) | probe in progress | |
| `evals` | 1 `*.eval.ts` | needs global setup driver | |
| `integration-tests` | 31 | needs global setup driver | |

### Root causes identified

- `it.runIf` / `it.skipIf` are absent from Bun's injected `vitest` module.
  Augmenting the imported `it`/`test` objects from a preload works (verified).
- `vi.mock('vscode', factory)` fails because Bun cannot resolve the `vscode`
  specifier (VS Code injects it at runtime). Bun honours `--tsconfig-override`
  `paths`, and `mock.module` patches an already-imported namespace **in place**
  — so the stub must declare every export name the tests replace.
- `automockValue` walks `node:fs` getters and trips on private fields
  (`ide-installer.test.ts`).
- `evals` and `integration-tests` rely on vitest `globalSetup` (env mutated in
  the parent, inherited by test processes), `retry: 2`, `fileParallelism:false`
  and `@fast-check/vitest`'s `itProp` global.

## Design

### 1. Test-root descriptors (`scripts/bun-test-manifest.ts`)

Extend the entry shape, preserving all current fields:

- `preload?: string | readonly string[]` — multiple preloads per entry.
- `tsconfig?: string` — per-entry `--tsconfig-override`.
- `include?: readonly string[]` / `exclude?: readonly string[]` — glob-based
  discovery, replacing a vitest config's `include`/`exclude`. An entry declares
  either `files` (explicit, for partially migrated workspaces) or `include`.
- `timeout?: number` — per-entry test timeout (integration tests need 300000).
- `retries?: number` — per-file retry budget (replaces vitest `retry`).
- `globalSetup?: string` — module with `setup()`/`teardown()` run once in the
  parent process, before/after spawning any file.

Glob discovery is what makes "no file dropped" mechanically true: adding a test
file under a migrated root automatically runs it.

### 2. Runner (`scripts/run_bun_tests.ts`)

- Resolve entries through the descriptor above.
- `--root <name>` selects a single descriptor (alias of `--workspace`).
- Run `globalSetup.setup()` before the file loop and `teardown()` after
  (always, even on failure).
- Retry a failed file up to `retries` times.

### 3. Compatibility shim (`test-setup/augment-bun-vi.ts`)

- Augment `it` / `test` with `runIf` and `skipIf`.
- Fix `automockValue` to skip properties whose getters throw.

### 4. Workspace wiring

Each migrated workspace gets `test` = Bun-native runner invocation, `test:ci`
likewise, and its `vitest.config.ts` removed once nothing references it.

### 5. CI

- `test_shard` continues to call `bun scripts/test.ts --shard`, which now runs
  Bun-native everywhere.
- `bun_native_test_parity` runs the complete manifest (all roots).
- `test:scripts`, `test:integration:sandbox:*`, eval scripts switch to the
  Bun-native runner.

## Verification

- Full local suite: `npm run test`, `npm run lint`, `npm run typecheck`,
  `npm run format`, `npm run build`, plus the CLI smoke.
- Test-count parity per root recorded before and after.
