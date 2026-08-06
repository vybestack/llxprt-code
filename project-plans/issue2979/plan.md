# Issue #2979 — Delete the Bun compatibility job and manifest allowlist; run every test by discovery

## 1. Measured starting state (this branch, `main` @ 42ca2a989)

The issue text was written against an earlier tree. The following numbers were
measured on the current checkout and supersede the ones in the issue body.

`bun scripts/run_bun_tests.ts --dry-run` resolves **1030** files across 19
manifest roots.

`bun_native_test_parity` (`.github/workflows/ci.yml:882-919`) no longer executes
tests — it runs `bun scripts/run_bun_tests.ts --dry-run` only. Problems 1 and 2
from the issue body (duplicate execution, bypassing affected-package selection)
have therefore already been fixed by intervening work. **Problem 3 — the
manifest silently omits real tests — is live and is what this change fixes.**

### Measured drift (files on disk vs. files any job executes)

Only workspaces whose primary runner is the shared manifest runner can drift.
Measured with a repo walk over `*.{test,spec,bun}.{ts,tsx,js}` minus
`node_modules`/`dist`/`coverage`/hidden dirs, diffed against `--dry-run`:

| Root                | On disk | Executed | Never executed |
| ------------------- | ------: | -------: | -------------: |
| `packages/providers` |     544 |      503 |         **41** |
| `packages/tools`     |      88 |       87 |          **1** |
| `packages/storage`   |      38 |       37 |          **1** |
| all other manifest roots | — |        — |              0 |

`packages/{cli,core,agents,auth,lsp}` have their own discovery-based runners and
are not manifest-gated for their primary selection, so their apparent "drift" is
not drift.

### Result of executing the 43 never-executed files

Each was run with its workspace's real preloads. **40 pass. 3 fail:**

| File | Failure |
| ---- | ------- |
| `packages/providers/src/runtime/promptEnvelopeProjections.test.ts` | 1 assertion fails (`projectAnthropicPromptEnvelope` protocol/method identification) |
| `packages/providers/src/openai/OpenAIRequestPreparation.issue2853.test.ts` | `Cannot find module '../../prompt-config/subagent-delegation.js'` |
| `packages/tools/src/tools/check-async-tasks-shell-formatter.test.ts` | 1 of 14 cases fails |

These are the concrete instances of the silent-omission class the issue is
about, and fixing them is in scope ("If any fail, fix them or fix the code they
cover").

### Dead / redundant manifest roots found

- **`cli`** (2 entries, 30 files) — `packages/cli/package.json` `test` runs only
  `bun run-bun-tests.ts`, which discovers `src`, `test`, `test-bun`,
  `test-utils` with pattern `\.(test|spec|bun)\.(ts|tsx)$`. Nothing invokes
  `--workspace cli`. Redundant; already asserted by
  `scripts/tests/bun-manifest-root-ownership.bun.test.ts`
  (`COVERED_BY_BESPOKE_RUNNER`).
- **`core`** (4 entries) — same situation via `packages/core/run-bun-tests.ts`.
- **`agents`** (10 entries) — `packages/agents/package.json` runs *both* the
  bespoke runner *and* `--workspace agents`. The bespoke runner scans `src`, so
  the 4 `src/**` entries in the manifest **execute twice per CI run today**.
  Only the 6 `test-bun/*.bun.ts` entries need the shared root.
- **`policy`'s `exclude: ['src/research/**']`** — `packages/policy/src/research`
  does not exist. Dead exclusion.

### `telemetry` and `cli` per the issue's acceptance criteria

The issue asked that telemetry's and cli's manifest coverage "either be folded
into their migration issues or documented as redundant with a reason". Both are
now resolved by merged work and are documented here as redundant:

- **telemetry** migrated under #2836. `packages/telemetry/package.json` `test`
  is `bun ../../scripts/run_bun_tests.ts --workspace telemetry`; the root is
  already glob-driven and covers all 13 files. Vitest no longer runs it.
- **cli** migrated under #2843. `packages/cli/run-bun-tests.ts` discovers all
  670 files with no allowlist and no exclusion list. The shared `cli` root is
  strictly redundant and is deleted.

## 2. Accepted behavior (acceptance criteria)

**AC1 — No allowlist.** `scripts/run_bun_tests.ts` selects the files it executes
by walking the filesystem. No file list, and no exclusion pattern that removes a
discovered test file from execution, exists anywhere in the selection path.

**AC2 — Every discovered test runs.** For every shared root, every file under
the root's scanned directories matching the root's test-file pattern is
executed. Adding a new test file to a shared-root workspace makes it run with no
configuration edit.

**AC3 — Per-root execution settings are preserved.** A root may still declare
`cwd`, `preload` (one or many), `tsconfig`, `timeout`, `retries`,
`globalSetup`, and `credentialed`, with behavior identical to today. These
control *how* a discovered file runs, never *whether* it runs.

**AC4 — Per-file timeout overrides, not exclusions.** The slow release-install
smoke keeps its larger budget without a separate curated root. A root may
declare timeout overrides keyed by a filename pattern; an override changes only
the budget, never membership.

**AC5 — Non-package roots survive.** `test-setup`, `scripts-tests`, `evals` and
`integration-tests` keep executing under discovery with explicit scanned
directories. `evals` keeps its `*.eval.ts` pattern, `globalSetup`, 300 s
timeout, and `credentialed` gating. `integration-tests` keeps `globalSetup`,
300 s timeout, `retries: 2`, and `credentialed` gating. Credentialed roots stay
out of an unfiltered run.

**AC6 — Previously-omitted files execute and pass.** All 41 providers, 1 tools
and 1 storage files listed above run under their workspace's primary `test`
script. The 3 failing files are fixed (test or product code, whichever is
wrong). None is skipped, excluded, or deleted.

**AC7 — No duplicate execution.** No test file is executed by two different
executors in one CI run. Specifically the 4 `agents/src/**` files stop running
twice, and the redundant `cli`/`core` roots are removed.

**AC8 — Repo-wide coverage guard.** A guard fails when a test file exists on
disk and no executor runs it. Its covered set is derived from the executors'
own discovery code, not from a restatement of it. It runs in CI as part of the
scripts shard, and it currently reports zero uncovered files.

**AC9 — The compatibility job is gone.** `bun_native_test_parity` is removed
from `.github/workflows/ci.yml`. The resolution check it performed is subsumed
by AC8's guard, which additionally validates that resolution is *complete*.

**AC10 — Manifest module deleted.** `scripts/bun-test-manifest.ts`, its four
`bun-test-manifest-data-*.ts` files, `bun-test-manifest-validation.ts`, and
`scripts/tests/bun-test-manifest.bun.test.ts` no longer exist. No replacement
file contains a per-file list.

**AC11 — Full verification passes:** `npm run test`, `lint`, `typecheck`,
`format`, `build`, plus the CLI smoke.

### Explicitly out of scope

Migrating remaining workspaces (#2843/#2845/#2846/#2847), removing Vitest
(#2970), rewriting the `vitest` specifier (#2969), re-recording CI timings in
#2702 (a measurement to be taken after merge, not a code change), and any
change to workflow structure beyond deleting the one job.

## 3. Boundary cases the tests must pin

1. A root whose scanned directory contains no matching file → fail loudly
   (today's `include` matched-nothing behavior), never silently run zero files.
2. A declared `preload` / `tsconfig` / `globalSetup` path that does not exist →
   fail loudly. (Discovery removes the need to validate *test file* existence,
   but these config paths are still hand-written.)
3. An unknown `--root`/`--workspace` name → non-zero exit with a clear message.
4. `cwd: '.'` resolves to the repo root; `cwd: undefined` resolves to
   `packages/<root>`; a relative `cwd` joins under the repo root.
5. Credentialed roots are excluded from an unfiltered run and included when
   named explicitly.
6. Symlink cycles under a scanned directory must not cause unbounded recursion.
7. Discovery must skip `node_modules`, `dist`, `coverage`, `tmp`, `bundle`,
   `__snapshots__` and dotted directories.
8. `--exclude`, positional path filters, `--testNamePattern`, `--dry-run`,
   `--junit`, `--json-report` keep working unchanged (these are *invocation*
   filters, not configuration allowlists, and the e2e workflow depends on them).
9. Timeout overrides: a file matching an override gets the override's per-test
   timeout and the correspondingly scaled process timeout; a non-matching file
   in the same root keeps the root/CLI timeout.
10. Coverage guard: a test file added under a scanned directory is reported as
    covered; a test file added where no executor scans is reported as uncovered.

## 4. Design

### 4.1 `scripts/bun-test-roots.ts` (new; replaces the manifest modules)

```ts
export interface BunTestRoot {
  readonly root: string;                  // --root / --workspace token
  readonly cwd?: string;                  // repo-relative; default packages/<root>
  readonly directories?: readonly string[]; // scanned dirs under cwd; default: cwd itself
  readonly pattern?: RegExp;              // default DEFAULT_TEST_FILE_PATTERN
  readonly preload?: string | readonly string[];
  readonly tsconfig?: string;
  readonly timeout?: number;
  readonly retries?: number;
  readonly globalSetup?: string;
  readonly credentialed?: boolean;
  readonly timeoutOverrides?: readonly { readonly pattern: RegExp; readonly timeout: number }[];
}
```

There is deliberately **no** `files`, `include`, or `exclude` member. The
default pattern is `/\.(test|spec|bun)\.(ts|tsx|js)$/` (the union of the
conventions in use, matching `packages/cli/run-bun-tests.ts`).

`resolveBunTestFiles(repoRoot, rootFilter?, deps?)` returns the same
`BunTestFile[]` shape the runner consumes today (`file`, `cwd`, `preloads`,
`tsconfig`, `timeout`, `retries`, `globalSetup`) so the runner's downstream
code is untouched. Directory walking is behind an injectable dependency so the
resolver stays testable against a temp fixture rather than the real tree.

Root table (19 → 17 roots): `a2a-server`, `agents` (directories: `['test-bun']`),
`providers`, `tools`, `mcp`, `telemetry`, `storage`, `test-utils`, `settings`,
`ide-integration`, `vscode-ide-companion`, `policy`, `test-setup`
(`cwd: '.'`, directories `['test-setup']`), `scripts-tests` (`cwd: '.'`,
directories `['scripts/tests']`, timeout override for
`issue-2603-release-install.test.ts` → 300 s), `evals`, `integration-tests`.
`cli`, `core` and `scripts-tests-slow` are deleted.

### 4.2 `scripts/run_bun_tests.ts`

Swap the `resolveFiles` dependency to the new resolver; update the "Roots must
be declared in …" diagnostic; update the module docblock. Invocation-time
`--exclude` / positional filters / `--testNamePattern` are unchanged.

### 4.3 Bespoke-runner exports (small, required for a truthful guard)

`packages/{core,agents,auth}/run-bun-tests.ts` currently call `main()` at module
scope. Add an `import.meta.main` guard (matching `packages/cli/run-bun-tests.ts`)
and export a `discoverTestFiles(root: string): string[]` that returns what the
runner already computes. No behavior change when executed as a script.

### 4.4 `scripts/check-test-file-coverage.ts` (new) + its test

Exports a table of executors, each contributing absolute paths from its own
discovery code:

- the shared runner, via `resolveBunTestFiles(repoRoot)` over **all** roots
  including credentialed ones;
- `packages/cli`, `packages/core`, `packages/agents`, `packages/auth`, via each
  runner's exported `discoverTestFiles`;
- `packages/lsp`, whose `test` script is a bare `bun test`, modelled with Bun's
  default discovery over the workspace.

`findUncoveredTestFiles(repoRoot)` walks the repo for test files and returns
those no executor claims. `scripts/tests/test-file-coverage.bun.test.ts`
asserts the real repository returns `[]`, and exercises the boundary cases in
§3.10 against temp fixtures. It runs in the `scripts-tests` root, i.e. in the
scripts CI shard.

### 4.5 Call sites to update

`scripts/tests/bun-manifest-root-ownership.bun.test.ts` (imports the manifest),
`scripts/test.ts` (`SCRIPTS_SHARD_ROOTS` drops `scripts-tests-slow`),
`scripts/check-affected-test-shards.ts` (stale comment),
`packages/agents/package.json` (keep both commands; the shared one now covers
only `test-bun`), `tsconfig.scripts.json` (file list),
`dev-docs/test-runner-inventory.md` (the #2578 inventory documents the
manifest), `.github/workflows/ci.yml` (delete the job).

## 5. Test-first plan (behavioral, per `dev-docs/RULES.md`)

New/changed suites, all `bun:test`:

1. `scripts/tests/bun-test-roots.bun.test.ts` — replaces the manifest suite.
   Behavioral against temp fixtures + the real tree:
   - a file dropped into a scanned directory is resolved without config edits
     (AC2);
   - a file in a skipped directory (`dist`, `node_modules`, dotted) is not;
   - `cwd` resolution for `undefined` / `'.'` / relative (§3.4);
   - credentialed selection semantics (§3.5);
   - empty scan result fails loudly (§3.1);
   - missing `preload`/`tsconfig`/`globalSetup` fails loudly (§3.2);
   - unknown root produces the runner's non-zero exit (§3.3);
   - symlink cycle terminates (§3.6);
   - timeout override applies to the matching file only (§3.9);
   - the real `providers` root resolves the previously-omitted files (AC6) and
     the real root table exposes no `files`/`include`/`exclude` member (AC1).
2. `scripts/tests/test-file-coverage.bun.test.ts` — AC8, including
   `findUncoveredTestFiles(repoRoot)` returning `[]` for the real repository.
3. `scripts/tests/bun-manifest-root-ownership.bun.test.ts` — retargeted at the
   new root table; extended with an assertion that no file is claimed by two
   executors (AC7).
4. `scripts/tests/run_bun_tests*.test.ts` — updated for the new resolver
   dependency; existing invocation-filter coverage retained (§3.8).
5. The 3 failing previously-omitted files are fixed and must pass unchanged in
   intent (AC6).

## 6. Risks

- Providers grows 503 → 544 executed files (+8 %) in its shard. The deleted
  parity job frees far more than that.
- The 3 fixes touch product-adjacent code; each must be justified by what the
  test asserts, not by making the test pass.
- Removing the `cli`/`core` roots relies on the bespoke runners' discovery;
  AC8's guard is what proves that claim mechanically rather than by assertion.
