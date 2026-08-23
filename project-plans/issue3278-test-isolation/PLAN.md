# Issue #3278: Test isolation (ripgrep PATH, real user config writes)

## Accepted behavior

### AC1 — ripgrep resolver coverage does not read the real PATH

`getRipgrepPath`, `isRipgrepAvailable`, `clearRipgrepAvailabilityCache`, and
`ensureWindowsShortcut` keep behavioral coverage, and that coverage passes
identically on a machine with `rg` installed and on one without. The coverage
lives beside the implementation in `packages/tools`, not in `packages/core`.

Boundary cases covered:

- packaged `@lvce-editor/ripgrep` binary preferred when present
- packaged binary with an ELF header skipped on darwin, accepted on linux
- packaged path that does not exist falls through
- system binary found by walking `process.env.PATH`
- non-executable `rg` on PATH ignored
- hardcoded Unix fallbacks, including `/opt/homebrew/bin/rg`, and their order
- Windows `Program Files` fallbacks, and Unix paths not used on win32
- bundle fallback with and without `node_modules`
- the "ripgrep not found" message and its installation hints
- `ensureWindowsShortcut`: hard link, copy fallback, existing target, missing
  source, non-Windows no-op
- availability caching and cache clearing

### AC2 — no test process writes into the real user config/data/cache/log roots

A full `npm run test` leaves `~/Library/Preferences/llxprt-code`, `~/.llxprt`,
`~/.config/llxprt`, and `~/.gemini` unchanged.

### AC3 — reaching the real config root during a test fails the suite

`Storage.getGlobalConfigDir()` throws when a test process resolves the real
platform directory, instead of returning a path that would be written to. This
is the path the defect took: `new ProfileManager()` resolves
`Storage.getGlobalConfigDir()/profiles`.

### AC4 — every Bun test root is storage-isolated

Every workspace `bunfig.toml` and every non-credentialed `BUN_TEST_ROOTS` entry
declares the storage-isolation preload, so `npm run test` and a raw `bun test`
inside a workspace are both isolated. A regression test spawns a probe in each
workspace and fails if a root can run without isolation.

### AC5 — CLI integration tests construct `ProfileManager` explicitly

The CLI integration tests that build a `ProfileManager` pass an explicit
per-test directory instead of relying on the ambient global config root.

### Out of scope

- `integration-tests/` and `evals/` roots (credentialed end-to-end suites that
  are not part of `npm run test`).
- Any behavior change to `ProfileManager` or `ripgrepPathResolver`.

---

## Phase 1 — ripgrep resolver coverage

**New:** `packages/tools/src/utils/ripgrepResolution.test.ts`
**Deleted:** `packages/core/test/utils/ripgrepPathResolver.test.ts`
(`packages/core/src/utils/ripgrepPathResolver.ts` stays a re-export.)

Isolation strategy, in order of preference:

1. `process.env.PATH` points at a controlled temp directory holding a real
   executable, so `findInPath` runs against real `statSync`/`accessSync`
   semantics. The stale test's failure to do this IS the defect.
2. `process.cwd()` is redirected to a temp directory for the bundle cases, with
   a real `bundle/rg` and a real `node_modules`, so `tryBundledPath` runs
   against the real filesystem.
3. `@lvce-editor/ripgrep` is replaced per test with `mock.module`. Bun
   evaluates a mock factory once and snapshots the namespace, so the mock is
   re-registered rather than read from a mutable variable. A path that does not
   exist stands in for "package not installed": `tryPackagedRipgrep` returns
   null for a missing binary and a failed import alike.
4. `fs.existsSync` is spied only for the hardcoded absolute probes
   (`/usr/local/bin/rg`, `C:\Program Files\ripgrep\rg.exe`, ...), which cannot
   be relocated into a temp directory. Every other question still reaches the
   real filesystem, and PATH is empty first so the spy is the only thing the
   resolver can observe.
5. `os.platform` is spied where a platform branch is under test.

## Phase 2 — fail closed on the real storage roots

**New:** `packages/storage/src/config/assertTestStorageIsolation.ts`

`assertTestConfigIsolation(resolved)` throws when `LLXPRT_RUNNING_TESTS ===
'true'` and the resolved directory is the real platform config directory.
`LLXPRT_ALLOW_REAL_STORAGE_IN_TESTS=true` opts a test out, mirroring the
existing `LLXPRT_ALLOW_BROWSER_LAUNCH_IN_TESTS` seam. A platform default that
resolves under the temp root is exempt, so a child sandboxed by rewriting
`$HOME` is not accused of reaching the developer's directory.

Only `Storage.getGlobalConfigDir()` routes through it, and every config-derived
path (`getGlobalSettingsPath`, `getUserCommandsDir`, the `ProfileManager`
default) inherits it.

Two designs were tried and rejected on evidence:

- A `node:fs` monkey-patch. In Bun, replacing a method on the `node:fs` default
  export is invisible to `import * as fs` and to named imports, which is how
  most of this codebase imports it, so the guard would have covered almost
  nothing.
- Guarding the data, cache, and log roots as well. `LLXPRT_RUNNING_TESTS` is
  inherited by the real CLI when a test spawns it as a product smoke check, and
  that process opens a debug log at import time. Guarding the log root turned
  `scripts/tests/publish-integrity.test.ts` and `scripts/tests/issue-2342.test.ts`
  into hard failures over a file nobody minds losing. The config root, which is
  what the issue is about, is not read on a `--version` run.

**New:** `packages/storage/src/config/assertTestStorageIsolation.test.ts`,
including a subprocess case for the `$HOME`-sandboxed child.

## Phase 3 — wire isolation into every root

- Storage-isolation preload added to the `[test] preload` list of every
  workspace `bunfig.toml` that lacked it (`a2a-server`, `ide-integration`,
  `lsp`, `policy`, `providers`, `settings`, `telemetry`, `test-utils`,
  `vscode-ide-companion`), creating the per-package file for `lsp` and
  `test-utils`.
- Matching `preload` entries added to `BUN_TEST_ROOTS` for `agents`,
  `providers`, `test-utils`, `policy`, `lsp`, and `scripts-tests`.
- Root `bunfig.toml` preloads the new `scripts/tests/storage-isolation-guard.ts`
  so a raw `bun test` from the repo root is isolated.
- Isolation is always ordered before any preload that imports `Storage`.

## Phase 4 — regression guard

**New:** `scripts/tests/storage-isolation-workspace-config.test.ts`

- every non-credentialed `BUN_TEST_ROOTS` entry declares the preload
- a probe spawned with `bun test` in each workspace, and at the repo root,
  reports redirected roots; the child environment is stripped of every
  `LLXPRT_*` variable so it cannot inherit the parent's isolation
- a directory without a bunfig fails the same probe (negative control)

## Phase 5 — CLI integration tests

Explicit `ProfileManager` directories in `base-url-behavior`,
`compression-settings-apply`, `ephemeral-settings`, `profile-keyfile`,
`profile-system`, `tools-governance`, `cli-args`, and
`cli-args.profile-flag`. The two files that spawn the CLI also set
`LLXPRT_CONFIG_HOME` to the same per-test root, because `runCli` forwards it to
the child.

Stale comments claiming `process.env.HOME = tempDir` steers `ProfileManager`
were corrected: the platform paths come from `env-paths`, evaluated once at
module load, so a later `HOME` assignment has no effect.

`packages/settings/src/profiles/ProfileManager.isolation.test.ts` keeps its
no-argument construction. Its subject is the default directory, and it failed
under a bare `bun test` in that workspace before Phase 3.

---

## Verification

```bash
# ripgrep, both environments
cd packages/tools && bun test src/utils/ripgrepResolution.test.ts
mkdir -p /tmp/bunonly && ln -sf "$(which bun)" /tmp/bunonly/bun
cd packages/tools && PATH="/tmp/bunonly:/usr/bin:/bin" /tmp/bunonly/bun test src/utils/ripgrepResolution.test.ts

# config pollution
touch /tmp/iso_marker && npm run test
find ~/.llxprt ~/.gemini ~/Library/Preferences/llxprt-code ~/.config/llxprt -newer /tmp/iso_marker
```

Plus `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and the `stepfun-37` startup smoke.

## Known local noise

`packages/auth/src/interfaces/__tests__/debug-logger.test.js` is an untracked,
git-ignored artifact from an earlier local build (`.gitignore` line 91,
`debug-*.js`). It makes `scripts/tests/test-file-coverage.bun.test.ts` report an
uncovered test file locally. It is not part of the repository and not part of
this change.

---

## Review triage (round 1)

| Finding | Class | Action |
| --- | --- | --- |
| H1: guard broke 17 platform-default tests | Blocker-Fix | `path-resolver.test.ts` and `settings/.../Storage.test.ts` now set `LLXPRT_ALLOW_REAL_STORAGE_IN_TESTS` in the blocks whose subject IS the platform default, and restore it in `afterEach`. |
| H2: predicate accused HOME-sandboxed children | Blocker-Fix | The guard now exempts a platform default that resolves under the temp root, and the message says "unredirected" instead of "the real user". The reviewer's suggested `os.userInfo().homedir` fix does not work: Bun's `userInfo().homedir` honours `$HOME` (verified), so it cannot distinguish a sandbox. Covered by a subprocess case. |
| M1: `~/.llxprt`, `~/.agents`, `~/.gemini` unguarded | In-scope-Fix (documentation) | The boundary is now stated in the `assertTestStorageIsolation` header: those roots have no environment override, tests isolate them by rewriting `$HOME`, and guarding them would reject reads that legitimately find nothing. The marker-and-`find` check covers them empirically. |
| M2: dropped `process.pkg.entrypoint` coverage | In-scope-Fix | Added a case that sets `process.pkg` with `node_modules` present. Mutation-checked: reducing `isBundled` to `!nodeModulesExists` now fails it. |
| M3: `BUN_TEST_ROOTS` half was a string match | In-scope-Fix | Each audited root is resolved through `resolveRoot`, and its preloads are passed to a probe spawned from a directory with no bunfig. |
| M4: guard does not run under `npm run test` | Reject | It runs in CI: `.github/workflows/ci.yml` runs `bun scripts/test.ts --shard scripts`, which covers `scripts/tests/`. Recorded in the PR body. |
| L1: module mock never unregistered | In-scope-Fix | `afterAll` re-registers the real `rgPath`, captured before the first mock. |
| L2: positive availability cache uncovered | In-scope-Fix | Added the mirror case. |
| L3: two exemption predicates | In-scope-Fix | Audited roots now derive from `credentialed !== true`, the runner's own predicate. |
| L4: `HOME` assignment lost its rationale | In-scope-Fix | Comment now says HOME steers the home-relative roots and not `ProfileManager`. |
| L5: marker provenance comment | In-scope-Fix | Lists all five entry points that set `LLXPRT_RUNNING_TESTS`. |

## Round-2 remediation (full-suite evidence)

The first full `npm run test` plus `npm run test:scripts` on the branch produced
these guard-caused failures, each fixed at its source:

| Failure | Cause | Fix |
| --- | --- | --- |
| `packages/storage/src/config/path-resolver.test.ts` (4), `packages/settings/src/storage/__tests__/Storage.test.ts` (13) | Blocks whose subject is the platform default clear the overrides | `LLXPRT_ALLOW_REAL_STORAGE_IN_TESTS` in `beforeEach`, restored in `afterEach` |
| `packages/cli/src/utils/sandbox-containers.test.ts` (2 files' worth of cases) | The sandbox mounts the host's own config dir, so the unredirected path is the subject | Same opt-in |
| `packages/storage/src/secure-store/secure-store.fallback.test.ts` (2) | Data-root platform default | Resolved by narrowing the guard to the config root; the file is unchanged |
| `scripts/tests/publish-integrity.test.ts`, `scripts/tests/issue-2342.test.ts` | The real CLI, spawned as a product smoke, inherits the test marker and opens a debug log at import time | Narrowed the guard to the config root |
| `scripts/tests/legacy-paths-guard.test.ts` | The new module's JSDoc contained a literal home-anchored legacy path | Rephrased to name the `Storage` accessors instead |

Failures that did NOT reproduce in isolation and are attributable to machine
load (five other full suites were running concurrently on the same host):
24 in `packages/agents`, 7 in `packages/core`, 1 in `packages/lsp`, 1 in
`packages/telemetry` (a timing assertion), 1 in `packages/tools`,
`packages/cli/src/launcher/bun-launcher.test.ts`. Each passes on its own.

Separately pre-existing and unrelated to this change: the five
`packages/core/src/utils/*powershell*|*pwsh*` files fail on this host because
`tree-sitter-pwsh` is not installed in the workspace, so the grammar cannot load.

## Open Code Review triage (local, round 1)

| Finding | Class | Action |
| --- | --- | --- |
| bug/medium: the `$HOME`-sandboxed subprocess case fails on Windows, where env-paths reads `APPDATA`/`LOCALAPPDATA`; spawn errors were never surfaced | In-scope-Fix | The child env now moves `APPDATA`, `LOCALAPPDATA`, and `USERPROFILE` too, and the case asserts the spawn produced no error before reading its status |
| test/medium: the PATH-lookup cases create only a bare `rg`, which a Windows resolver never probes with `PATHEXT` cleared | In-scope-Fix | `installSystemRg` writes `rg.EXE` as well on a Windows host and returns the name the resolver will pick; the darwin-mocked cases keep the bare name |
| maintainability/low: `expect(auditedRoots.length).toBe(<same filter>.length)` compares a value with itself | In-scope-Fix | Replaced with an invariant that can fail: the credentialed set is exactly `evals` and `integration-tests` |
| bug/low: the per-test budget equals the spawn budget, so the runner's generic timeout would pre-empt the probe's diagnostics | In-scope-Fix | `TEST_TIMEOUT_MS = SUBPROCESS_TIMEOUT_MS + 30s` on all four cases |

## Evidence

- Content hashes of `~/Library/Preferences/llxprt-code` (3778 files) and of
  `~/.llxprt` + `~/.gemini` (25 files) are byte-identical across a full
  `npm run test`, `npm run test:scripts`, and `npm run build` on the branch.
  Hashes rather than the marker-and-`find` method, because this host runs
  several live agent sessions whose todo and perf writes move directory mtimes
  independently of the suite.
- `packages/tools/src/utils/ripgrepResolution.test.ts`: 24 pass / 0 fail both
  with `rg` at `/opt/homebrew/bin/rg` and under
  `PATH="/tmp/bunonly:/usr/bin:/bin"`.
- `scripts/tests/storage-isolation-workspace-config.test.ts`: 33 pass / 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build`, and the `stepfun-37`
  startup smoke all pass.
