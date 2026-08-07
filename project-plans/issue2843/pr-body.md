Fixes #2843.

Migrates the `cli` workspace to Bun's native test runner and removes Vitest from
it entirely. There is no `test:vitest` fallback: keeping one would mean keeping
two runners green.

## What changed

- **`packages/cli/run-bun-tests.ts`** — discovers every test file under `src/`,
  `test/`, `test-bun/` and `test-utils/` and runs each in its own `bun test`
  process. A process per file is required because Bun's `mock.module` registry
  is process-wide, so a shared process leaks module mocks between files. Writes
  JUnit, passes `--timeout 30000` explicitly (Bun's 5s default is not enough,
  and the `bunfig` key is not honoured for single-file runs).
- **Vitest removed** — 9 config variants, `vitest.test-groups.ts`,
  `test-setup.ts`, `test-setup-base.ts`, `stryker.conf.json`.
- **`test-setup/augment-bun-vi.ts`** (shared with every workspace) — async
  `vi.mock` factories are settled synchronously with `drainMicrotasks()` so the
  mock exists before the module body runs, as Vitest's hoisting guarantees; a
  factory that rejects now fails loudly instead of silently leaving the real
  module installed; `restoreAllMocks` keeps module mocks registered and clears
  nested mock history.
- **`packages/cli/bun-test-setup.ts`** — Vitest `globals: true` parity, Ink
  teardown, credential-proxy env isolation, and `process.exitCode` reset per
  test.
- **Snapshots** — migrated from Vitest's key format to Bun's. Without this, Bun
  silently appended new entries and every snapshot assertion was vacuous.

## The exclusion list this removes

`vitest.test-groups.ts` carried a `baseExclude` list that hid ~37 test files,
and no CI job ever invoked the CLI's `test:integration`, hiding 24 more. Those
files had not run in a long time. This PR runs everything, which is why
previously invisible failures appear.

## Results

| | |
| --- | --- |
| CLI files | **643 / 653** |
| CLI cases | **8357** passing, 49 failing |
| snapshots written during a run | **0** |

Cross-workspace, to cover the shared shim: core 336/336, providers 493/493,
auth 33/33, test-setup 3/3. The 3 `agents` failures were verified against a
clean `main` worktree and fail identically there.

`lint` 0, `typecheck` 0, `prettier --check` clean, `build` 0, smoke test passes.

## What is not fixed here, and why

Every remaining failure and every deleted test is recorded in #3046 with
evidence. The substantive items:

- **Bun's `spawnSync` drops extra file descriptors.** `sandbox-bashrc.ts` reads
  payloads from fds 3 and 4; Node returns `output.length` 5 with both
  populated, Bun returns 3 and empty. All 16 cases fail and cannot be fixed in
  the test. This has production impact, since the repo is moving to Bun as the
  runtime.
- **Inline load-balancer profiles are rejected** while the file-based path
  works (`parseInlineProfile` has no `type: 'loadbalancer'` branch).
- **The prebuilt bundle cannot resolve provider aliases.** `bun-build.config.ts`
  emits `packages/cli/bundle/llxprt.js` with no assets, while
  `copy_bundle_assets.ts` still targets the pre-#2999 repo-root `bundle/` and is
  invoked by nothing. CI is unaffected because it never builds a bundle, but a
  stale or asset-less bundle silently shadows correct source.

24 tests were deleted: 13 asserted behaviour that no longer exists in the source
(e.g. a prop nothing reads), and 11 were placeholders whose only assertion was
`expect(true).toBe(true)`. Each is listed in #3046 with the behaviours lost.

## Verification notes

- Snapshot work must be checked with `CI=true` so Bun compares instead of
  writing. An early round of this migration committed fabricated snapshots
  recorded from error frames; they were found by diffing entry counts against
  `main` and reverted.
- Tests that spawn the built CLI are only meaningful after `npm run bundle` —
  `npm run build` does not regenerate it.
