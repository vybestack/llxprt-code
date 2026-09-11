# Issue #3622: Session-scoped fake system root (fake $HOME/TMPDIR) for every test process, with a real-home sentinel guard

## Targeted compliance remediation (2026-09-11)

All four assigned findings are addressed. This pass ran targeted checks only;
no full suite, full lint, build, commit, or push was run. Existing changes to
`bun.lock` and `packages/vscode-ide-companion/NOTICES.txt` were left untouched,
as was `.llxprt/`.

1. **Credentialed roots could reach the OS keyring.** Added
   `LLXPRT_TEST_DISABLE_OS_KEYRING: '1'` to `buildSessionEnv()` and its owned
   keys. The regression supplies an inherited `'0'` and requires `'1'`.
   `isolateStorageRoots()` retains its assignment for direct preloaded tests.
   No credentialed-root preload or global setup was changed.
   `remediation-a-keyring-red.log`: 5 passed, 1 failed on the inherited value.
   `remediation-a-keyring-green.log`: 6 passed.
2. **Sentinel diagnostics repeated changes against later files.** The guard
   retains the first observation by watched directory, change kind, and entry.
   Each assertion collects all fresh changes so simultaneous additions and
   removals are not deferred to later labels. Diagnostics say a change was
   detected while running a file and that per-file attribution is best-effort.
   A real unrelated-writer subprocess regression checks first detection,
   silence on later unchanged assertions, and reporting a later new entry.
   The real-filesystem pool test now verifies the run still fails at finalize
   without another diagnostic. `remediation-a-sentinel-red.log`: 17 passed,
   2 failed. `remediation-a-sentinel-green.log`: 29 passed across guard/helper
   tests, including the latched failure check.
3. **Catchable signals bypassed guard cleanup.** The shared runner now awaits
   asynchronous child execution while retaining serial file order; its old
   synchronous spawn prevented handling signals during a running test.
   All five mains use the signal teardown helper in
   `scripts/lib/bespoke-runner-isolation.ts`. It stops new work, kills active
   POSIX process groups, waits for child close, finalizes the guard, and exits
   non-zero. Finalization is idempotent and normal exits unregister listeners.
   The existing gated demo fixture now supports a cancellation test with a
   descendant process. Hermetic tests exercise the real shared runner and
   copies of all four bespoke runners with fake real homes.
   `remediation-a-signals-red.log`: all 5 failed; the shared runner did not
   exit during its blocked spawn, and bespoke runners exited by signal rather
   than through teardown. `remediation-a-signals-green.log`: all 5 passed,
   checking exit 143, removal of every sentinel, and descendant termination.
   These process-group tests are POSIX-only. SIGINT shares the teardown path;
   SIGTERM was exercised end to end. SIGKILL remains uncatchable.
4. **Documentation overstated detection and had stale runner details.** The
   sentinel header and `dev-docs/test-runner-inventory.md` separate structural
   environment redirection from snapshot detection and list the undetectable
   cases. The inventory now says core checks each settled file, documents the
   short `/tmp` socket-fixture exception, explains busy-machine false
   attribution and the guard-disable escape hatch, and records signal limits.

All evidence paths above are under `tmp/issue3622/`. Additional targeted
verification:

- `remediation-a-combined-green.log`: 102 passed across seven script test files,
  including all runner demos, session isolation, and contract checks.
- `remediation-a-bespoke-green.log`: 122 passed, 1 platform skip across
  CLI/core/auth runner tests.
- `remediation-a-agents-green.log`: 5 passed, including real timeout/retry
  children and JUnit handling.
- `remediation-a-targeted-types-green.log`: strict `tsc --noEmit` on changed
  runners, helpers, and tests passed. The first ad hoc invocation omitted the
  project's `allowImportingTsExtensions` option; its diagnostic is retained in
  `remediation-a-targeted-types.log`. The corrected invocation includes it.
- `remediation-a-format.log`: formatting of changed TypeScript files only.
- `remediation-a-doc-guard-green.log`: 40 passed, 1 CI-only skip in the
  legacy-path documentation guard. `git diff --check` passed.

No assigned fix remains deferred. Windows process-tree signal cleanup and a
separate SIGINT end-to-end test were not validated by this POSIX-focused pass.

## Post-audit fixes (2026-09-11)

Added a narrow inventory-doc allowlist entry for the two legacy-path references
in the test-isolation contract. The guard now accepts the migration-input and
sentinel-watch explanations without changing the documentation.

Excluded `research` from shared test discovery and extended the existing
filesystem skip-directory regression. The regression failed before the walker
change and passed afterward. AC8's reported 1,714 uncovered vendored research
tests were a pre-existing local-only finding, unrelated to session isolation;
CI does not contain those gitignored reference checkouts.

Targeted verification only (logs under `tmp/issue3622/`):

- `fix1-legacy-paths.log`: legacy-path guard tests, exit 0, 40 passed, 1 skipped.
- `fix2-walker-red.log`: regression before the fix, exit 1, 53 passed, 1 failed.
- `fix2-coverage.log`: coverage and walker tests, exit 0, 67 passed.
- `fixes-combined.log`: coverage and legacy-path guards together, exit 0,
  53 passed, 1 skipped. AC8 passes against the local repository.

The legacy-path test file is `scripts/tests/legacy-paths-guard.test.ts`, not
`check-legacy-paths*.test.ts`. No full suite, commit, or push was run for these
fixes.

## Bounded audit findings (2026-09-11)

AC2 remediation is implemented and targeted verification passes (33 tests).
Full verification is running; completion depends on its recorded results.

- Fixed shared-runner env capture to happen after global setup, preserving
  setup-provided storage roots and integration output settings. A regression
  assertion failed before this fix and passed afterward.
- The session probe already existed at audit start. The hermetic demo now
  launches it through the real shared runner and asserts one pass, not a skip.
  The demo also pre-provisions explicit fake config/log targets.
- Fixed contract coverage for string-valued preload declarations (tools/mcp)
  and included the CLI/core/auth storage preloads in the checks.
- Fixed the storage marker test's environment restoration: its fresh helper
  call changed the keyring and legacy-home vars without restoring them.
- Expanded the inventory docs with explicit XDG names and sentinel limits.

AC2 remediation (2026-09-11):

1. All four bespoke runner mains now finalize in an outer `finally`. Exit
   status is assigned without bypassing cleanup. Concurrent workers are awaited
   with `Promise.allSettled` before propagating errors, so the guard stays armed
   until every active worker finishes. Hermetic subprocess tests run copies of
   the actual runners and force report-write errors with a directory at
   `junit.xml`; every runner removes its sentinel and exits 1.
2. Baselines are retained incrementally. A failure after writing a target's
   sentinel also removes that sentinel before propagating. The bespoke factory
   cleans up if capture fails. Real-filesystem regressions force a later target
   to fail and verify earlier sentinels are removed without removing the
   pre-existing blocking directory.
3. The bespoke helper wraps each file (including retries) with in-flight
   tracking and a settlement check in `finally`. Diagnostics name the settled
   file and active peers. Core now checks per settlement rather than after a
   whole batch. A controlled concurrent-worker test proves attribution before
   the peer finishes, including a rejected worker. The shared runner has no
   pool mode: `runAllFiles` uses a synchronous serial loop, already checking
   after every file. No concurrency feature was added.

Regression evidence: `ac2-red.log` records three failing tests before helper
fixes; `ac2-mains-red.log` records report-error cleanup failures in core,
agents, and auth (CLI already handled that particular report error).
`ac2-green.log` records all 33 tests passing after the fixes.

Verification logs are under `tmp/issue3622/`: `audit-scripts-after.log`
(58 passed), `audit-storage-after.log` (16 passed), and
`audit-demo-final.log` (1 passed, including real-runner leak/control/probe
children). `audit-setup-env-red.log` and `audit-storage-red.log` preserve the
failing regression assertions. The initial `audit-scripts.log` records 40
passed and one probe skip under direct Bun invocation. No full suite, build,
lint, typecheck, formatter, commit, or push was run during this audit.

## Problem statement (verified on this machine, 2026-09-09)

The test suite redirects LLXPRT storage categories
(`isolateStorageRoots()` → `LLXPRT_{CONFIG,DATA,CACHE,LOG,AGENTS}_HOME`, set by
every workspace preload), but nothing points `HOME`/`TMPDIR` at a sandbox. Every
direct `os.homedir()` call site (34 production sites audited in the issue)
resolves the developer's real home, and the real config remains reachable by
construction for any process that misses a preload. Evidence on this branch-5
sandbox: ambient env exports
`LLXPRT_CONFIG_HOME=/Users/acoliver/Library/Preferences/llxprt-code` (the real,
host-mounted config). Any test process that runs without a storage preload and
writes via `Storage.getGlobalConfigDir()` clobbers the real `settings.json`
(the #3581 leak class). A direct repro of `cli-args.integration.test.ts` with
ambient `LLXPRT_CONFIG_HOME` pointing at a probe dir did NOT leak on current
main (the bunfig preload isolates), so the named #3581 path is fixed-or-latent,
but the class is open: the two `--help`/`--version` tests still write their
fixture into whatever the ambient process resolves, and an unpreloaded
execution path would leak again.

Key proven facts driving the design:

1. Bun's `os.homedir()` honors `$HOME` only when it is set at process start;
   mid-process mutation is ignored. Therefore isolation cannot be done in a
   preload; it must happen at spawn time in the runners.
2. All test processes are spawned by five runners: the shared
   `scripts/run_bun_tests.ts` (all workspaces except cli/core/auth; also
   scripts-tests, evals, integration-tests) and bespoke
   `packages/{cli,core,agents,auth}/run-bun-tests.ts`. Root `npm test`,
   `npm run test:bun` (`scripts/test.ts`), workspace `npm test`, and CI all
   funnel through these five.
3. Only `packages/agents/test-setup-storage-isolation.ts` sets
   `LLXPRT_TEST_DISABLE_OS_KEYRING=1`; other workspaces' credential-stack tests
   can reach the real OS keychain.
4. `Storage.getLegacyLlxprtDir()` (consumed by startup migration,
   `packages/cli/src/config/pathMigration.ts:601`) has no override; it is
   `os.homedir()/.llxprt` — the real home inside tests unless HOME is faked.
5. `envPaths` platform defaults are computed at module load from the process
   env, so a child spawned with a session env resolves llxprt platform dirs
   inside the sandbox even without `LLXPRT_*` overrides.

## Proposed fix

### 1. Session root + spawn-time env (new `scripts/lib/test-session-isolation.ts`)

- `createTestSessionRoot(baseTmpDir?)` → `<os.tmpdir()>/llxprt-tests/<sessionid>/`
  containing `home/user/`, `tmp/`, `home/user/.config`, `home/user/.cache`,
  `home/user/.local/share`. Session id = pid + timestamp + random suffix
  (sibling branch checkouts share /tmp; ids must never collide).
- `buildSessionEnv(env, session)` returns a NEW env object (never mutates the
  runner's own env — the runner must keep its real HOME for the guard):
  `HOME=$root/home/user`, `TMPDIR=$root/tmp`,
  `XDG_CONFIG_HOME=$root/home/user/.config`,
  `XDG_CACHE_HOME=$root/home/user/.cache`,
  `XDG_DATA_HOME=$root/home/user/.local/share`,
  `LLXPRT_TEST_SESSION_ROOT=$root`. Existing `LLXPRT_*` env values are left
  untouched (existing storage isolation keeps precedence). No cleanup of the
  root (matches `isolateStorageRoots()` convention; OS reclaims /tmp).
- Wired into: `scripts/run_bun_tests.ts` (session env becomes the env used for
  every per-file spawn; created once in `runBunTests()` so injected-dependency
  tests observe it) and the four bespoke runners (replace `env: process.env`
  with the session env for every spawn).

### 2. Real-home sentinel guard (new `scripts/lib/real-home-sentinel.ts`)

- Targets: the RUNNER's real home (runner env, not session env):
  `~/.llxprt`, `~/.agents/skills`, and the storage package's platform config
  and log dirs (reuse the same resolution the storage package uses — import
  from `packages/storage/src/config/path-resolver.js`, not a reimplementation).
- `captureBaseline()`: for each existing target dir, drop a sentinel file
  `.llxprt-sentinel-<sessionid>` (random content) and record sha256 + mtime +
  the dir listing (excluding all `.llxprt-sentinel-*` entries so concurrent
  sibling sessions cannot false-positive). Absent target dirs are recorded as
  must-not-appear.
- `assertUnchanged(label)`: fails with a `RealHomeSentinelViolation` naming the
  label (the test file) when a sentinel is modified/removed, when a dir
  appears that was absent, or when a non-sentinel entry is added to or removed
  from a watched dir. (In-place modification of pre-existing real files by an
  env-clobbering leak is prevented structurally by the session env; the
  sentinel layer proves the contract for direct/absolute-path writes. This
  boundary is documented, not hidden.)
- `cleanup()` removes the guard's sentinels (run in `finally`).
- Factory honors `LLXPRT_TEST_SENTINEL_GUARD=0` → disabled no-op guard.
- Wired into all five runners: baseline before the first file, `assertUnchanged`
  after each file (serial runners attribute exactly; pool runners attribute the
  finished file plus in-flight files), final assert + cleanup, violation ⇒
  exit code 1 with the file named on stderr.

### 3. Storage helper: uniform keyring disable + legacy-home override

- `isolateStorageRoots()` additionally sets
  `LLXPRT_TEST_DISABLE_OS_KEYRING='1'` and
  `LLXPRT_TEST_LEGACY_HOME=<testStorageRoot>/home/user` (created), and the
  marker-set branch validates both (fail fast on tampering).
- `Storage.getLegacyLlxprtDir()` returns
  `path.join(LLXPRT_TEST_LEGACY_HOME, '.llxprt')` when that env var is set and
  absolute; otherwise today's `os.homedir()/.llxprt`. Production never sets
  the var.
- Remove the now-redundant `LLXPRT_TEST_DISABLE_OS_KEYRING` assignment from
  `packages/agents/test-setup-storage-isolation.ts`.
- Existing tests asserting the un-overridden legacy behavior
  (`packages/storage/test-bun/storage.bun.ts`,
  `packages/settings/src/storage/__tests__/Storage.test.ts`) are updated to
  assert the override contract plus the unset fallback (save/restore pattern).

### 4. #3581: stop trusting ambient resolution for the fixture write

The two `cli-args.integration.test.ts` tests (`--help` with invalid
settings.json, and config-error with no args) write the fixture into a
per-test temp config dir by setting `process.env.LLXPRT_CONFIG_HOME` for the
test (mirroring the file's first describe block's save/restore pattern),
restoring afterwards. The write target is then provably isolated regardless of
ambient env or preload gaps. #3581 stays linked (not auto-closed): the named
tests are fixed and the class is closed by construction, but the PR reports
this rather than claiming the historical mechanism was reproduced (it was not
reproducible on current main).

### 5. Leak demonstration + permanent probe

- `scripts/tests/fixtures/sentinel-leak-fixture.test.ts`: env-gated
  (`LLXPRT_SENTINEL_DEMO=1`) test that writes to
  `$LLXPRT_SENTINEL_DEMO_TARGET` (an absolute path inside the demo's fake
  "real" home targets). Skipped in normal runs (fixtures dir is inside the
  scanned scripts/tests tree, so it is discovered and shows as skipped — same
  gating convention as credentialed `*.real.test.ts` files).
- `scripts/tests/real-home-sentinel.test.ts` (guard unit tests) plus a demo
  case that spawns `bun scripts/run_bun_tests.ts sentinel-leak-fixture` with
  `HOME=<tempFakeReal>` (clean env), pre-provisioned fake-real target dirs
  derived from the same platform resolver, and the gate vars. Asserts: exit 1,
  stderr names the fixture file and the violation, and a no-leak control run
  exits 0 with sentinels cleaned up.
- `scripts/tests/test-session-probe.test.ts`: permanent end-to-end proof —
  when `LLXPRT_TEST_SESSION_ROOT` is set (i.e. under any runner), asserts
  `os.homedir() === $root/home/user`, `os.tmpdir() === $root/tmp`, XDG vars
  inside the root; skips when unset (developer `bun test` outside a runner).

### 6. Contract enforcement + docs

- `scripts/tests/test-isolation-contract.test.ts`: (a) every workspace
  `test-setup-storage-isolation.ts`/`bun-preload.ts` calls
  `isolateStorageRoots()` (complementing the existing probe-based
  `storage-isolation-workspace-config.test.ts`); (b) each of the five runners
  imports the shared session-isolation and sentinel guard libs (wiring
  assertions, same file-reading precedent); (c) no
  `process.env.LLXPRT_TEST_DISABLE_OS_KEYRING =` assignment outside the
  allowlist (storage helper + keyring adapter's own tests).
- `dev-docs/test-runner-inventory.md`: new "Test isolation contract" section —
  session root layout, the env vars (`HOME`/`TMPDIR`/`XDG_*`/
  `LLXPRT_TEST_SESSION_ROOT`/`LLXPRT_TEST_LEGACY_HOME`/
  `LLXPRT_TEST_DISABLE_OS_KEYRING`), sentinel guard semantics + limits +
  `LLXPRT_TEST_SENTINEL_GUARD=0` escape hatch, and a checklist for adding a
  workspace/preload/runner. Notes the boundary: direct `bun test` outside the
  runners keeps storage isolation via preloads but has no session env (CI's
  few direct `bun test` lines run on throwaway runner homes).

## Acceptance criteria

AC1. Every test process spawned by the shared runner and the four bespoke
    runners runs with `HOME`/`TMPDIR`/`XDG_*` inside
    `<tmpdir>/llxprt-tests/<sessionid>/` and `LLXPRT_TEST_SESSION_ROOT` set;
    proven by the session probe test under the shared runner and env-capture
    unit tests; full suite passes on this machine (rich real config present).
AC2. The sentinel guard drops sentinels into the real-home targets, checks
    after each file and at run end, fails the run (exit 1) naming the
    offending test file; `LLXPRT_TEST_SENTINEL_GUARD=0` disables it; the
    deliberately leaking fixture demonstrates failure + attribution
    hermetically (temp fake-real home).
AC3. `LLXPRT_TEST_DISABLE_OS_KEYRING=1` is set centrally by
    `isolateStorageRoots()`; no preload assigns it directly anymore; enforced
    by the contract test.
AC4. `Storage.getLegacyLlxprtDir()` honors `LLXPRT_TEST_LEGACY_HOME` (absolute)
    → `<value>/.llxprt`; `isolateStorageRoots()` sets it; inside preloaded
    tests the legacy dir never resolves the real home; fallback to
    `os.homedir()/.llxprt` when unset (production path).
AC5. The two #3581 tests write their fixture into a per-test isolated config
    dir instead of the ambient-resolved `Storage.getGlobalConfigDir()`.
AC6. The isolation contract is documented in `dev-docs/test-runner-inventory.md`
    and enforced by contract tests (preload coverage, runner wiring, keyring
    assignment allowlist).

## Scope boundaries

- No production behavior changes outside the legacy-dir env override (which
  only activates when a TEST-scoped env var is set).
- No removal of existing per-test HOME provisioning in test files unless a
  test only used it for isolation AND still passes without it and the removal
  is trivially safe; the #3581 tests and the agents preload keyring line are
  the only mandated edits to existing tests.
- No changes to batch invocation (#3505), no keyring/credential behavior
  changes beyond the env disable sweep, no Windows-specific env handling
  (HOME/TMPDIR/XDG per the issue text; runners are POSIX in CI).
- Existing `assertTestConfigIsolation()` guard stays as is.
- Credentialed roots (evals, integration-tests) get the session env uniformly
  (their globalSetup keeps overriding storage env as today); verified via CI
  since they need credentials.

## Tests proving the behavior (written first, per dev-docs/RULES.md)

| Test file | Proves |
|---|---|
| `scripts/tests/test-session-isolation.test.ts` (new) | session root layout; env object overrides HOME/TMPDIR/XDG*/LLXPRT_TEST_SESSION_ROOT; runner env not mutated; LLXPRT_* preserved |
| `scripts/tests/real-home-sentinel.test.ts` (new) | baseline drop; untouched pass; sentinel modified/removed fail; dir appears fails; entry added/removed fails; other sessions' sentinels ignored; escape hatch; cleanup, including partial baseline failure (AC2 regression passing) |
| `scripts/tests/bespoke-runner-isolation.test.ts` (new) | factory cleanup after partial capture; per-settlement checks with active-peer attribution and rejected worker (AC2 regressions passing) |
| `scripts/tests/sentinel-guard-demo.test.ts` (new) | real shared-runner leak/control/probe; all four actual bespoke runner mains remove sentinels after report-write failure (AC2 regressions passing) |
| `scripts/tests/run_bun_tests.test.ts` (extend) | `runBunTests` spawns with session env (captured spawn options); guard baseline/assert/cleanup invoked; violation ⇒ exit 1 + file named |
| `scripts/tests/fixtures/sentinel-leak-fixture.test.ts` + demo case | end-to-end: leaking child fails the run, offending file named; control run passes clean |
| `scripts/tests/test-session-probe.test.ts` (new), launched by `scripts/tests/sentinel-guard-demo.test.ts` | under the real shared runner: homedir/tmpdir/XDG inside session root; demo asserts the probe passes rather than skips |
| `packages/storage/src/testing/isolateStorageRoots.test.ts` (extend) | keyring + legacy-home env set; marker branch validates them |
| `packages/storage/test-bun/storage.bun.ts`, `packages/settings/.../Storage.test.ts` (extend) | legacy override honored; unset → real-home fallback |
| `packages/cli/test/run-bun-tests.test.ts` (+ core/agents/auth equivalents where they exist) (extend) | bespoke runners use the shared session env + guard |
| `packages/cli/src/integration-tests/cli-args.integration.test.ts` (edit) | fixture write lands in the per-test isolated config dir |
| `scripts/tests/test-isolation-contract.test.ts` (new) | preload coverage; runner wiring; keyring assignment allowlist |

## Verification cycle (full, after implementation and after each remediation)

```bash
npm run test          # full suite (workspaces + scripts) — must pass on this machine
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
bun scripts/test-audit/scan.ts tmp/scan-branch   # no new findings on touched files
```

Also targeted during development: `bun scripts/run_bun_tests.ts --workspace storage`,
`--workspace scripts-tests`, and `cd packages/cli && bun run-bun-tests.ts` for
the bespoke-runner path.

## Review caps

- deepthinker compliance review: 1 initial + at most 1 remediation round.
- OCR: at most 2 local reviews for this issue effort; findings triaged as
  Blocker-Fix / In-scope-Fix / Reject / Defer; reviewer suggestions do not
  expand scope.

## Implementation phases (subagent briefs; implementer = fallbacktypescriptcoder)

1. **P1 Session env + guard libs + shared runner wiring** — files:
   `scripts/lib/test-session-isolation.ts`, `scripts/lib/real-home-sentinel.ts`,
   `scripts/run_bun_tests.ts`, tests above. TDD: tests first.
2. **P2 Storage helper + legacy override** — `isolateStorageRoots.ts`,
   `storage.ts` (getLegacyLlxprtDir), existing legacy tests updated, agents
   preload keyring line removed.
3. **P3 Bespoke runners + preload sweep** — `packages/{cli,core,agents,auth}/run-bun-tests.ts`
   session env + guard; contract test for wiring + preloads.
4. **P4 #3581 fixture isolation + leak demo** — cli-args tests, leak fixture,
   demo case, session probe test.
5. **P5 Docs** — `dev-docs/test-runner-inventory.md` isolation contract section.

## Second remediation evidence (2026-09-11)

### Finding A: enforce the environment wiring and root coverage

Changed `scripts/tests/test-isolation-contract.test.ts`,
`scripts/tests/sentinel-guard-demo.test.ts`, and
`scripts/tests/test-session-probe.test.ts`.

The contract now inspects TypeScript call expressions and spawn-options objects.
It requires the session-env argument in each bespoke retry callback, the env
property at each test spawn, and the shared runner's initial/retry dispatch
arguments. Mutation tests remove each link from an in-memory source copy and
require the same contract assertion to reject it. Removing an env property can
no longer satisfy a negative check against `process.env`.

All five entrypoints execute the same session probe. The four bespoke mains are
copied unchanged into temporary workspace layouts containing only the probe;
shared support modules are linked from the repository. Empty bespoke preloads
prevent a preload from concealing missing spawn-time wiring. Each successful
probe writes a completion receipt only after its HOME, TMPDIR, XDG, session-root,
and keyring-disable assertions pass. This also proves the CLI probe ran rather
than skipped, although the CLI suppresses passing Bun output. Each fake real
home has its own TMPDIR, keeping the spawned session roots inside the fixture.

Root coverage explicitly enumerates the shared roots, cross-checks every
`package.json` workspace, and checks the bespoke preload declarations. Every
shared root must declare a storage-isolation preload or match the credentialed
`evals`/`integration-tests` setup exceptions. The exceptions must declare their
global setup and retain the storage-env assignment loop. Negative tests reject
an unknown root and deletion of each existing isolation declaration.

Evidence:

- The initial contract mutation run exposed a missing shared `runSingleTestFile`
  argument check: 15 pass, 1 fail in
  `tmp/issue3622/remediation-b-contract-green.log` (the filename predates the
  result). Adding that check made every source-deletion mutation reject.
- Final targeted run: 45 pass, 0 fail across four suites, including 16 contract
  cases and all five live entrypoint probes, in
  `tmp/issue3622/remediation-b-green.log`.
- An earlier probe run passed all 15 demo cases but encountered a syntax error
  in the new contract regex. That test-edit error was corrected before the
  mutation and final runs; see `tmp/issue3622/remediation-b-a-first.log`.

### Finding B: assert filesystem effects instead of scripted guard calls

Changed `scripts/tests/bespoke-runner-isolation.test.ts` and
`scripts/tests/run_bun_tests.session-isolation.test.ts`.

Replaced scripted baseline flags, label arrays, cleanup counts, and sentinel
violations with real temporary targets and `RealHomeSentinelGuard`. Tests now
assert sentinel contents and removal, real leak diagnostics, directory
appearance at teardown, exit status, and output left by a later worker. The
shared-runner cases launch real Bun children to verify setup-env propagation,
file-leak attribution, continued execution, and cleanup after global teardown
modifies a sentinel. Existing partial-baseline and active-peer/rejected-worker
coverage remains.

Evidence:

- Mutation copies with `guard.assertUnchanged(...)` removed fail behavior
  assertions: bespoke 6 pass / 4 fail; shared 2 pass / 2 fail. Both exit 1.
  See `tmp/issue3622/remediation-b-mutation-red-final.log`. Production runner
  files were not modified for this experiment. The earlier mutation harness
  missed a side-effect import in the shared copy; its module-resolution failure
  in `remediation-b-mutation-red.log` is not used as behavior evidence.
- The final unchanged implementations pass all 14 isolation cases, as part of
  the 45-pass run in `tmp/issue3622/remediation-b-green.log`.
- Targeted TypeScript diagnostics for the five changed test files: zero,
  `tmp/issue3622/remediation-b-types.log`. Dependency diagnostics were excluded;
  this was not a full-project typecheck.
- Targeted formatting: `tmp/issue3622/remediation-b-format.log`.

One deterministic unexpected-error injection remains in the bespoke test. Its
baseline and cleanup delegate to the real guard, and assertions check the thrown
error and actual sentinel removal. Injecting that failure avoids OS-specific
permission behavior and root-user exceptions. The shared env-capture test keeps
its process-boundary spawn double. No call-order/count assertions remain in the
converted guard scenarios.

No full suite, build, or lint was run, per this remediation's scope. No commit or
push was made. This pass did not edit `.llxprt/`, `NOTICES.txt`, or `bun.lock`.

## Consolidated verification remediation, pass 3 (2026-09-11)

All requested targeted checks pass. This pass changes only tests, test-harness
helpers, runner configuration, and this log. No application or sandbox behavior
was changed. The optional native-keyring top-level-describe warnings were left
alone. No full suite, commit, or push was run. Existing changes to `bun.lock`
and `NOTICES.txt` were preserved; `.llxprt/` was not edited.

### Cluster 1: portable CLI fixtures

- `packages/cli/src/utils/sandbox-launch-release.test.ts`: allocate socket-bearing
  launch fixtures under `/tmp` on Unix, retaining the Windows temp base and
  existing cleanup. Session TMPDIR paths exceeded Darwin's socket-path limit.
- `packages/cli/src/utils/startup-fatal-log.test.ts`: compare the child's recorded
  cwd with `realpathSync(childCwd)`, accounting for macOS `/var` symlinks.

From `packages/cli`, `bun test src/utils/sandbox-launch-release.test.ts
src/utils/startup-fatal-log.test.ts` passed 41 tests, zero failures, exit 0:
`tmp/issue3622/fix3-cli-tests.log`. A second run spawned each file separately
with `createTestSessionRoot()` and `buildSessionEnv()`, matching runner isolation
and package cwd. It passed 12 sandbox and 29 startup tests, zero failures,
exit 0: `tmp/issue3622/fix3-cli-session-tests.log`. Its logged TMPDIR is under
`/var/folders/.../llxprt-tests/<session>/tmp`, reproducing the long-path and
symlink conditions.

### Cluster 2: lint refactors

- `packages/storage/src/testing/isolateStorageRoots.ts`: extract marked-state
  validation without changing its checks or errors.
- `scripts/run_bun_tests.ts`: extract global setup startup, preserving the
  started-list update before awaiting setup and the existing teardown behavior.
  Remove the unused intermediate pass count from exit-status calculation.
- `scripts/tests/sentinel-guard-demo.test.ts`: extract process-group termination
  and ESRCH handling into a helper, removing nested control flow and the direct
  throw statement from the finally block.
- `scripts/tests/test-isolation-contract.test.ts`: replace nested ternaries with
  branches and a runner lookup. Anchor the shorthand-env regex to a line and
  limit its whitespace to horizontal tabs/spaces so it cannot scan across lines.

The initial targeted lint reproduced nine diagnostics (the task grouped them
as eight): `tmp/issue3622/fix3-lint-red.log`. Final `npx eslint` on those four
files exited 0 with zero errors or warnings: `tmp/issue3622/fix3-lint.log`.
The contract, SIGTERM demo, shared runner, and session-isolation suites passed
84 tests, zero failures, exit 0: `tmp/issue3622/fix3-harness-tests.log`.
Storage isolation tests passed 16 tests, zero failures, exit 0:
`tmp/issue3622/fix3-storage-tests.log`.

### Cluster 3: type safety and runner project inputs

- `packages/storage/src/testing/isolateStorageRoots.test.ts`: narrow legacy-home
  and fixture-root values with explicit guards, removing undefined arguments
  and string coercions that could conceal missing setup.
- `packages/core/tsconfig.runner.json`: add the three imported isolation modules
  and their storage path-resolver dependency to the existing explicit include
  list. Core inherits composite mode, which requires imported source files in
  the project inputs. CLI, agents, and auth have no separate runner config and
  set composite false in their package configs. Root `tsconfig.scripts.json`
  also disables composite and already includes `scripts/lib/**/*.ts`.

All three requested commands exited 0 with no diagnostics:

- Storage: `npx tsc --noEmit`, `tmp/issue3622/fix3-storage-types.log`.
- Core: `npx tsc -p tsconfig.runner.json`,
  `tmp/issue3622/fix3-core-types.log`.
- Root: `npx tsc --project tsconfig.scripts.json`,
  `tmp/issue3622/fix3-scripts-types.log`.

Targeted Prettier write/check logs are `tmp/issue3622/fix3-format.log` and
`tmp/issue3622/fix3-format-check.log`; the final check exited 0.

## Fix pass 4: OCR round-1 remediation (2026-09-11)

Open Code Review (glm-5.3 on zai-anthropic, JSON manifest
`tmp/issue3622/ocr1.log`) reviewed 37 files and returned 24 comments.
All 20 actionable findings were fixed by the implementer subagent
(dispositions + evidence in `tmp/issue3622/fix4-summary.log`):

- HIGH: keyring opt-out preserved through `isolateStorageRoots()` so the
  documented real-keyring escape hatch and the CI `secure_store` keyring leg
  run tests instead of silently skipping (simulations show `skip=false`).
- HIGH: agents/auth runner timeout kills now use `killRunnerChild` (process
  group) matching the new `detached` spawns.
- HIGH: Windows session isolation (USERPROFILE/TEMP/TMP/APPDATA/LOCALAPPDATA)
  plus 0700 per-session roots.
- HIGH: shared-runner guard finalization logs unexpected errors and returns
  failure instead of rethrowing from `finally` (reports/exit path preserved).
- HIGH: core/cli runners hard-exit after reporting on fail-fast/timeout paths
  so unreaped children cannot hang the event loop; clean runs still exit soft.
- HIGH: sentinel target resolution reads the isolation marker from the
  injected environment (no more ambient-env divergence).
- MEDIUM/LOW: dead `sentinelViolations` param removed; worker-loop shadowing
  renamed + all rejections logged; bespoke `stop()` bounded to 5s close-wait
  with per-child kill isolation; `noteFileSettled` de-bound; optional timeout
  armed only when configured; legacy-home override gated on the isolation
  marker; no-op guard injected in shared-runner unit tests; explicit 180s
  budget on the triple-runner demo; junction symlinks on win32; legacy-home
  existence probe dropped from validation; finally-block assertions moved
  into try; trailing isolation recheck given its own env boundary; JSDoc
  placement; sentinel target descriptions surfaced in violation messages;
  env-key list deduplicated in storage tests.

Targeted verification: 14 test commands exit 0, eslint 0 errors on all
modified files, prettier check clean, storage/core/scripts typechecks exit 0.

## Full-suite flake ledger (same class, rotating populations)

- verify3: `sandbox-podman-diagnostics.test.ts` 2 cases (bridge timeout
  6.5-6.8s loaded vs ~1.6s isolated, 4/4 green isolated) and
  `Gpt56O200kPromptEstimator.test.ts > long` (41.2s vs 40s cap; isolated
  42/42 green, file total 7.8s).
- verify4: `grep-ripgrep-bounded-acquisition.test.ts` 3 cases (15s timeouts
  loaded; isolated 44/44 green, file total 3.3s).
- All populations: files untouched by this diff, passed on other full runs of
  the same tree, timing-class with 4-13x isolated speedups. CI runners are
  single-tenant and should not reproduce them.

## Final verification (2026-09-11 evening)

- verify5 (full chain, final post-fix4 tree): lint/typecheck/format/build/
  smoke/scan ALL EXIT=0; npm test EXIT=1 with a single flake
  (`shellBoundedAcquisition` producer exit 1 at 151ms; isolated 13/13 green
  in 1.7s) beyond the four intentional fixtures.
- verify6 attempt 1: aborted by machine-wide `ENOSPC` (Data volume at 100%,
  116 Mi free). Root cause: `~/Library/Logs/llxprt-code/tmp/` had
  accumulated 11 GB of session dirs (tool leak, filed as #3640). Cleaned
  (entries older than 2h) plus 344 stale `llxprt-tests` session roots; 12 Gi
  freed.
- verify6 attempt 2: npm test EXIT=143 — an external SIGTERM hit the whole
  `npm test` process 7.5 min in. The new runner teardown behaved exactly as
  designed: remaining files skipped with "test runner is terminating",
  exit 143, no corrupted reports.
- verify6 attempt 3 (22:17:17Z-22:31:17Z): **`npm run test` EXIT=0.** The
  only `(fail)` lines are the four intentional fixtures. AC1 met.

Complete cycle on the final tree: test GREEN (verify6-3) + lint, typecheck,
format, build, smoke, scan GREEN (verify5). Logs: `tmp/issue3622/verify5-*`,
`tmp/issue3622/verify6-*`, `tmp/issue3622/verify6-{enospc,sigterm}-*`.
