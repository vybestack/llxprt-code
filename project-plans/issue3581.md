# Issue #3581: cli-args integration tests must not write fixtures into the ambient config dir

Issue: https://github.com/vybestack/llxprt-code/issues/3581

## Problem

`packages/cli/src/integration-tests/cli-args.integration.test.ts` wrote the
invalid-settings fixture (`{"telemetry":{"logConversations":true}}`) through
`Storage.getGlobalConfigDir()`, which resolves `LLXPRT_CONFIG_HOME` from the
test process environment. When that variable points at a real config directory
the suite overwrote the real user-global `settings.json`.

## Current state on main (base c214b23f)

The `CLI --version and --help flags` describe block already overrides
`process.env.LLXPRT_CONFIG_HOME` to `<tempDir>/config-home` in `beforeEach`, so
the ordinary run no longer reaches the real directory. The two fixture writes
still depend on that process-wide mutation and on `Storage.getGlobalConfigDir()`
instead of naming the directory they write to. If the override regresses, the
fixture silently lands in whatever the ambient environment resolves to.

## Scope

- `packages/cli/src/integration-tests/cli-args.integration.test.ts`
- `project-plans/issue3581.md` (this file)

Out of scope: production code, `runCli` and the shared test helpers, the
profile-loading describe blocks, any `.llxprt/`, workflow, tooling or
dependency file. No new public abstraction; support code stays test-local in the
same file.

## Behavior to guarantee

1. Both invalid-settings fixtures are written explicitly below the per-test
   temp config directory (`<tempDir>/config-home`), and the spawned CLI is given
   exactly that directory through an explicit child `LLXPRT_CONFIG_HOME`.
2. An ambient `LLXPRT_CONFIG_HOME` that holds a settings file keeps that file
   byte-for-byte after the invalid-settings flows run. The flows also work with
   the ambient variable unset. The original environment is restored afterwards.
3. `--help` with invalid settings exits 0, prints help, and does not contain
   `Invalid configuration`.
4. No args with invalid settings exits non-zero and contains
   `Invalid configuration` (which also proves the CLI read the fixture dir).

## Test-first plan

All regression evidence is behavioral: real files, a real spawned CLI, no mocks.

1. Add a test-local fixture helper and a runner helper to the same file:
   `writeInvalidSettingsFixture(configDir)` writes the fixture beneath an
   explicit directory and `runCliWithConfigHome(args, home, configDir)` passes
   the directory as the child `LLXPRT_CONFIG_HOME`.
2. Add a describe block, `invalid settings fixture isolation from ambient
   LLXPRT_CONFIG_HOME`. Each case builds a disposable sentinel root under the
   per-test temp dir, points the test-process `LLXPRT_CONFIG_HOME` at it (or
   unsets it), runs the `--help` and no-args flows against the explicit test
   config dir, then asserts:
   - sentinel `settings.json` bytes are unchanged (sentinel case),
   - the fixture exists in the explicit test config dir,
   - `--help` exits 0 with help text and no `Invalid configuration`,
   - no args exits non-zero with `Invalid configuration`,
   - an `afterAll` check confirms `HOME` and `LLXPRT_CONFIG_HOME` are back to
     their original values once the enclosing `afterEach` has run.
3. Switch the two existing tests to the same helpers so the production fixture
   path and the regression path are one code path.

### Red evidence (the baseline is already green)

Because main already mitigates the issue through the `beforeEach` override, the
unmodified suite is green. Red evidence comes from a mutation applied to a
disposable copy of the candidate test file (deleted afterwards, never kept in
the tree): the fixture helper is changed back to
`Storage.getGlobalConfigDir()`. With the ambient variable pointing at a
disposable sentinel root, the mutant overwrites the sentinel and the CLI never
sees the fixture in the test config dir. The "unset ambient" case is excluded
from the mutation run because the old write would then resolve a default
location that is not provably disposable.

## Safety

- Every ambient root used by the tests is a directory under the per-test temp
  dir. The old unsafe write is never aimed at the real global config.
- Verification runs set the shell's `LLXPRT_CONFIG_HOME` to a disposable root
  under `tmp/verify3581/` when exercising the file directly.
- Logs go to `tmp/verify3581/` (gitignored).

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, the `lunahigh` smoke run, `npm run lint:ci`,
`npm run lint:eslint-guard`, and a test-audit scan comparison between base and
candidate for the modified file.

Policy invariance: no new `eslint-disable*`, `@ts-ignore`, `@ts-expect-error`,
`@ts-nocheck`, no severity downgrades, no ignore-block changes.

Review: OCR skipped per Andrew 2026-10-09.
