Fixes #2847.

Migrates every test root named in #2847 to Bun's native test runner and moves CI's test execution onto it. `agents` and `cli` still run under Vitest and are tracked separately by #2578 — see "Remaining Vitest usage" below for the full, honest enumeration.

## Test roots replace curated file lists

`scripts/bun-test-manifest.ts` previously listed every Bun-ready file by hand, because a partially migrated workspace could not distinguish a Bun-ready file from one still owned by Vitest. A root now selects its files in one of two ways:

- **`include` / `exclude` globs** for fully migrated roots — the Bun-native equivalent of a Vitest config's `include`. This is what makes "no test file can be silently dropped" mechanically true: a newly added test file runs without a manifest edit.
- **`files`** for roots still finishing their migration.

A root may also declare `preload` (one or more, the equivalent of Vitest `setupFiles`), `tsconfig` (a test-only `--tsconfig-override`), `timeout`, `retries`, `globalSetup` (`setup()`/`teardown()` run once in the runner process, so the env it mutates is inherited by every spawned test process), and `credentialed`.

`credentialed` marks a root that calls a real provider. An unfiltered run covers every other root — the complete offline suite — so the PR gate never burns quota; `evals` and `integration-tests` are requested by name from their own workflows.

## What now runs under Bun

| Root | Files |
| --- | --- |
| `settings` | 15 |
| `ide-integration` | 10 |
| `vscode-ide-companion` | 7 |
| `policy` | 12 |
| `telemetry` | 13 |
| `test-utils` | 11 |
| `a2a-server` | 21 |
| `scripts/tests` | 202 |
| `evals` | 1 |
| `integration-tests` | 31 |

Each migrated workspace's `test` / `test:ci` invokes `scripts/run_bun_tests.ts` and still emits `junit.xml` for the CI test reporter. `scripts/test.ts`, the root `package.json` scripts, `.github/workflows/ci.yml`, `dev-docs/bun.md` and `CONTRIBUTING.md` all point at the Bun-native path, with `bun run test:bun` as the single canonical command.

Integration tests need real provider credentials, so they cannot pass locally; what was verified is that all 31 files load and collect under Bun, with the residual failure being the same `assertProviderConfig` error Vitest reports. `evals` was verified end to end: the report lands at `evals/logs/report.json` and `scripts/aggregate_evals.ts` parses it.

## Compatibility gaps closed in the shim

Each of these was a whole class of failures rather than a single file:

- `it` / `test` / `describe.runIf` — Bun ships `skipIf` but not `runIf`, so gated tests failed to even collect.
- `automockValue` now mirrors accessors instead of reading them. `node:fs` exposes getters backed by private class fields that throw off-instance, which aborted the automock of the whole module.
- `restoreAllMocks` also resets spy state, matching Vitest's `mockRestore`. Without it a spy installed over an automocked export kept its call history across tests.
- `waitFor` under Bun's fake timers: the loop advanced the clock but never yielded, so a promise chain resumed by a timer could not progress between attempts. It also attempts the callback at t=0 like the real-timer path, and no longer advances twice between retries after an async rejection.

## PTY

`@lydell/node-pty` never delivers `onData`/`onExit` under Bun on POSIX (https://github.com/oven-sh/bun/issues/25822), so the interactive harness selects `Bun.spawn`'s terminal backend (`packages/test-utils/src/pty-backend.ts`). It is not shared with `core`'s adapter because `core` already dev-depends on `test-utils`, and importing `core` here would close a dependency cycle.

## Bugs the migration exposed

- **`waitFor` deadlock.** The openai-responses abort suite hangs on `main` under Bun; it now passes.
- **Eval log directory was cwd-relative**, reproducing #2605 under the runner's working directory. It is now resolved from the module.
- **JUnit conversion double-counted.** Bun nests a `describe` suite inside the file-level suite; attributing the nested suite's cases to its parent doubled every count the evals aggregation reads.
- **`token-tracking-property.test.ts`'s 24 property tests were inert.** `@fast-check/vitest` v0.2 dropped the 3-argument `itProp(name, [arbs], fn)` form, so the arbitraries were swallowed as an options object and each predicate ran once with the Vitest context instead of generated values. Driving them through plain `fast-check` exposed three assertions that never held — `total` deliberately excludes cache tokens, `formatSessionTokenUsage` groups digits via `toLocaleString()`, and a freshly recorded entry is *inside* the 60-second window. Same test count (24 pass, 1 skip); now with real generated values.

## Retired Vitest configuration

Ten `vitest.config.ts` files are deleted. The invariants they guarded are re-expressed against the manifest rather than dropped: the evals report path (`scripts/tests/evals-report-path.test.ts`), the OCR workflow's test discovery, the scripts shard's two invocations, and the settings boundary alias check.

## Remaining Vitest usage

Vitest is no longer the runner for any root named in #2847, but it is **not** yet absent from the repository. Enumerated honestly:

**Still executes Vitest** (out of this issue's scope, tracked by #2578):

| Path | What runs it |
| --- | --- |
| `packages/agents` `test` / `test:ci` | the `agents` shard, via `scripts/test.ts` |
| `packages/cli` `test` / `test:ci` (+ `test:integration`, `test:ci:covered`, `test:ci:fast`, `test:legacy`) | the `cli` shard, via `scripts/test.ts` |
| `packages/storage` `test:vitest` | the `secure_store_backend` job in `ci.yml` and its nightly twin, which need the two backend-specific configs |
| `packages/test-utils/src/quota-guard-vitest-integration.test.ts` | spawns a nested Vitest deliberately — it is the test *of* Vitest integration |

**Does not execute** — `vitest` stays in `devDependencies` because migrated test files still import `describe`/`it`/`expect` from the `vitest` specifier, which Bun resolves through its own injected handler. `test:vitest` escape hatches remain on `auth`, `lsp`, `mcp`, `providers`, `storage` and `tools`; no workflow or `test` script invokes them.

So the issue's "CI uses Bun-native execution as the primary path for all workspaces" holds for every root this PR owns, and does not yet hold for `agents`, `cli` or the SecureStore backend matrix.

## Two decisions worth a second opinion

1. **Quota-guard semantics.** Under Vitest a tripped provider-quota sentinel *skipped* fresh tests (keeping the run green) and *threw* on retries. Bun has no way to skip from inside a hook, so it now always throws: the API is still never called, but a quota outage turns e2e red rather than skipped.
2. **`bun_native_test_parity` cost.** It now runs the complete 798-file non-credentialed manifest at a 90-minute cap, which substantially duplicates `test_shard`. Repurposing it as a manifest-completeness gate would give the same protection far more cheaply.

## Verification

`npm run typecheck` (all workspaces), `npx eslint`, `npx prettier --check`, `npm run lint:eslint-guard`, `npm run build`, and the CLI smoke (`bun scripts/start.ts --profile-load stepfun-37`) all pass. The complete non-credentialed manifest and every migrated workspace suite pass locally.

Open Code Review found six issues, all remediated in this branch. No test was dropped, skipped or filtered; no lint rule, complexity threshold or type suppression was loosened — the runner test file was split rather than raising `max-lines`.
