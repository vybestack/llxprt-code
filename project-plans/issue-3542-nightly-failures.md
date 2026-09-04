# Issue #3542 — Nightly workflow failed (run 33743091055, 2026-09-03)

## Scope and evidence base

Nightly run 33743091055 (head 7561710ac, an ancestor of current main) failed in
three jobs, all at the "Run shard tests (issue #3153)" step:

- macOS CI (Nightly) [cli] — job 100609296741
- Windows CI (Nightly) [core] — job 100609296605
- Windows CI (Nightly) [cli] — job 100609296783

Raw failure logs are archived under `tmp/issue3542/` (gitignored). PR CI
(ci.yml) runs only Linux and macOS shards, so none of the Windows failures were
catchable before merge; the nightly is the first Windows exposure for several
of these tests.

## Failure taxonomy and root causes

### M1 — macOS [cli]: sandbox-orphan-reaping it.each trio (3 cases)

Tests: "falls back when process start output has {impossible calendar day |
mismatched weekday | out-of-range hour}" in
`packages/cli/src/utils/sandbox-orphan-reaping.bun.test.ts`.

The tests prepend a fixture directory (containing a fake `docker`) to
`process.env.PATH`, then call `assignContainerName`, whose
`execSync(`${config.command} ps -a --format "{{.Names}}"`)`
(packages/cli/src/utils/sandbox-containers.ts:466) runs WITHOUT an `env`
option. Bun 1.3.14's execSync resolves the executable against the process
STARTUP environment, not the current mutated `process.env.PATH` (proven by
tmp/issue3542/envtest/repro3.ts: bare execSync ignores mutated PATH;
`env: process.env` sees it). macOS nightly runners have no docker
(`/bin/sh: docker: command not found`) → the trio throws. The same file's
non-UTC timezone test passes only because it re-execs a fresh bun child whose
startup env equals the mutated env. Windows passes the trio because the
startup PATH has a real docker.exe.

Fix (production): pass `env: process.env` to the four engine-invoking
`execSync` sites in sandbox-containers.ts (:437, :441, :466, :804). Identical
semantics in production (same process env); honors in-process PATH mutation.

### W1 — Windows [cli]: fake-dependency-engine-harness symlinks (≈60 cases)

`useFakeEngine()` (packages/cli/test-utils/fake-dependency-engine-harness.ts)
installs `docker`/`podman` as extensionless symlinks into a PATH-prepended
binDir. Windows CreateProcess cannot exec an extensionless symlink, so engine
resolution falls through to the REAL docker.exe (Windows-container daemon
rejects Linux mount paths: `invalid mount path: '/tmp/llxpert-deps-0'`,
`'/dependencies'`, `'/tmp/llxprt-checkpoint-init'`) or to missing podman
(`Executable not found in $PATH: "podman"`). Affects 13 files:
sandbox-checkpoint-storage init, dependency-volume-recovery, launch-lifecycle,
dependency-volumes, launch-release, node-modules ×4 + preflight + multiroot,
source-development, venv, orphan-reaping (reused-PID context).

Secondary symptom: `ps: unknown option -- o` — MSYS ps (no `-o`) answers the
owner-observation probe `execFileSync('ps', ['-o','lstart=', '-p', pid])` in
the dependency path; production falls back to an "estimated" owner (handled),
but it shows the harness provides no `ps` on Windows.

Fix (test-infra): on win32 the harness must install real executables via
`writePortableExecutable` (packages/cli/test-utils/sandbox-fixture-compiler.ts
— bun `--compile` → `.exe`), the same mechanism the orphan-reaping tests
already use and which demonstrably works on Windows nightlies. docker is
compiled once and copied to podman (the fake engine never reads argv[0]),
halving the per-suite compile cost. The harness does NOT install a fake `ps`:
no useFakeEngine suite sets the ps fixture env, so the probe outcome is the
estimated-owner fallback either way (same as MSYS ps failing on `-o` — a
handled production path). POSIX keeps the fast symlink path.

### W2 — Windows [cli]: checkpoint-storage projectKey derivation (1 case)

Test "derives the project key exactly as the in-container history dir does"
(sandbox-checkpoint-storage.test.ts:108-113) computes `sha256(workdir)` from
the RAW host path. Production hashes `getContainerPath(workdir)`
(sandbox-env.ts:19; on win32 `C:\a\b` → `/c/a/b`, identity elsewhere) —
correct, because the in-container project root is the POSIX form. The test's
"independent re-derivation" is only valid on POSIX. Fix (test-only): derive
the expectation as `sha256(getContainerPath(workdir))`.

### W3 — Windows [cli]: stanza idempotence readlink EINVAL (1 case)

"is idempotent across repeated launches" (sandbox-checkpoint-storage.test.ts
:425) runs the container entrypoint stanza under Git-bash and asserts
`fs.readlinkSync(history)`. First launch creates a native symlink (the first
stanza test passes on Windows), but Git-bash's second `ln -sfn` leaves a
non-symlink (MSYS quirk) → `EINVAL` on readlink. The stanza itself targets
container Linux (`/bin/sh`), where `ln -sfn` is properly idempotent. Fix
(test-only): assert the persistence contract platform-honestly — second run
status 0 and the history path still resolves into the store
(realpath equality/write-through) — keeping the strict link-type assertion
where native link semantics hold.

### W4 — Windows [cli]: orphan-reaping reused-PID (1 case; failed 09-02 AND 09-03)

"removes a reused-PID container without terminating the live process". The
row was retained, so `sandboxOwnerIsDead` returned false with no reap warning
(rm never ran). The test was added in #3465 and had NEVER run on Windows
before 09-02 (PR CI is Linux/macOS only). Evidence rules out PATH resolution
(the non-UTC timezone child passes on Windows, proving the fake ps resolves
and probes fine) and rules out probe-timeout enforcement (the PS_HANG test
completes in ~360ms on Windows). Remaining hypotheses: (a) the compiled
ps.exe probe intermittently exceeds the 250ms budget under Windows
Defender/runner load (506ms test duration is consistent with a burned 250ms
probe); (b) kill(pid, 0) semantics on Bun/Windows. Fix attempt (test-only):
warm the ps fixture executable immediately before the recovery pass so the
probe fits the production 250ms budget deterministically. Verify on the
dispatched Windows run; if it still fails, one evidence-driven iteration
(within review caps).

### W5 — Windows [cli]: fixture-compiler failure-output assertion (1 case)

"reports status and both output streams when compilation fails"
(test-utils/sandbox-fixture-compiler.bun.test.ts) matches a fixture-path
substring; on Windows bun prints backslashed paths
(`D:\\a\\...\\invalid-fixture.fixture.ts:1:22`) and the compiled fixture
name gains a `.exe` suffix. Fix (test-only): normalize separators and accept
the platform suffix so the shape assertion holds everywhere.

### C1 — Windows [core]: gitServiceCheckpoints restore CRLF (1 case)

"restore reverts tracked content and removes files added after the snapshot"
expects `'tracked v1\n'` and receives a visually identical value (±0 diff) —
`'tracked v1\r\n'`. Root cause: `setupShadowGitRepository` pins HOME and
XDG_CONFIG_HOME to the history dir (neutralizing the USER global gitconfig)
but Git-for-Windows' SYSTEM gitconfig still sets `core.autocrlf=true`, so
`git restore --source <hash> .` checks out CRLF. Checkpoints must restore
byte-identical content on every platform. Fix (production): pin
`[core]\n  autocrlf = false` in the shadow .gitconfig content, and update the
exact-content assertion in packages/core/src/services/gitService.test.ts:184
accordingly. No store migration needed: autocrlf=true already normalized to
LF at commit time, so repository objects are unaffected; only checkout
changes.

### C2 — Windows [core]: shellParser.background process-exit hang (1 item)

`TIMEOUT: src\utils\shellParser.background.test.ts (exceeded 300s) [REAP
FAILED (recovered on retry)]`. NOT a test-logic failure: all 14 tests passed
in 177ms on BOTH attempts; the bun test PROCESS failed to exit, and the
runner's own taskkill "reported failure and its tree did not close" (sick
runner). The file passed on 09-01 and 09-02; there are zero diffs to
shell-parser.ts, its test, bun.lock, or package.json between those heads and
7561710ac. Classification: environmental, one-off. No code change; the
verification gate is a green dispatched nightly on this branch. Runner-policy
unification remains tracked by open issue #3442.

## Acceptance criteria

1. AC1 (M1): engine-invoking `execSync` sites in sandbox-containers.ts pass
   `env: process.env`. Behavioral proof: the it.each trio passes locally under
   a no-docker PATH (`cd packages/cli && env -i HOME=$HOME PATH="/usr/bin:/bin"
   /opt/homebrew/bin/bun test src/utils/sandbox-orphan-reaping.bun.test.ts
   --test-name-pattern "falls back when process start output"` — the
   interpreter must be absolute because the stripped PATH has no bun),
   matching macOS runner conditions.
2. AC2 (W1): useFakeEngine installs real docker/podman executables on win32
   via writePortableExecutable (symlinks unchanged on POSIX). Behavioral
   proof: the dependency/checkpoint suites listed above pass on a dispatched
   Windows nightly; local macOS run of the same suites stays green.
3. AC3 (W2): projectKey expectation derived via getContainerPath.
4. AC4 (W3): stanza idempotence asserts the persistence contract
   cross-platform.
5. AC5 (W4): reused-PID test passes on the dispatched Windows nightly.
6. AC6 (W5): fixture-compiler failure-output assertion accepts both path
   separators.
7. AC7 (C1): shadow gitconfig pins autocrlf=false; gitService.test.ts
   exact-content assertion updated; checkpoint restore is byte-stable.
8. AC8 (C2): documented as environmental (this plan); Windows [core] shard
   green on the dispatched nightly.
9. Non-goals: #3442 runner unification, release failures (#3546/#3547),
   installing podman on Windows runners, changes to ci.yml/nightly.yml.

## Test-first plan

1. RED: local repro of M1 under `env -i` (no docker on PATH) — trio fails on
   main, passes after the env fix. Log under tmp/issue3542/.
2. GREEN: four execSync sites get `env: process.env`.
3. W2/W3/W5/W4: adjust the named assertions/fixture handling (test-only),
   keeping POSIX behavior identical; run each file locally.
4. W1: harness win32 branch + portable executables; local run of the affected
   suites on macOS (symlink path still exercised); Windows proof via nightly
   dispatch on the branch.
5. C1: update gitConfigContent (add `[core] autocrlf = false`), update
   gitService.test.ts exact-content test, verify gitServiceCheckpoints suite
   locally (LF machine proves no regression; the Windows behavior is proven by
   dispatch).
6. Full verification cycle per dev-docs/RULES.md and the issue-workflow skill;
   then dispatch nightly.yml on the branch for Windows evidence before PR.

## Verification

- Local (macOS): full verification cycle — npm run test, lint, typecheck,
  format, build, stepfun-37 smoke, `git diff --check`.
- Windows: `gh workflow run nightly.yml --ref issue3542` (workflow_dispatch)
  and watch; Windows shards green = AC2/AC4/AC5/AC6/AC7/AC8 proven.
- Reviews: deepthinker (≤2 rounds), OCR zai profile (≤2 rounds), PR via
  PR-creator, CI + CodeRabbit watch until green.

## Review record (round 1)

deepthinker's provider was rate-limited for the whole window; the compliance
review was performed by the architect subagent instead (opusthinking
profile). Verdict: PASS, 0 HIGH, 4 MEDIUM, 6 LOW. Triage:

- In-scope-Fix (done): narrowed the fake-dependency-engine.ts
  invokedAsScript catch so a plain import can never run main()
  (`!fs.existsSync(FAKE_ENGINE_SCRIPT_PATH)`); harness compiles docker once
  and copies to podman; dropped the never-answerable fake ps install;
  integration-tests/sandboxCheckpointPersistence.real.test.ts gitconfig
  model updated with the autocrlf line; plan doc drifts fixed.
- Defer (gated on the dispatched Windows nightly): W3 assertion outcome
  (MSYS may leave a magic file where realpath also fails — the nightly is
  the designated gate; iterate once if contradicted); W4 prewarm
  (hypothesis; nightly is the gate); C1 residuals (pre-existing CRLF
  snapshots restored as LF — information destroyed at commit time;
  project-level .gitattributes can still override core.autocrlf).
- Defer (follow-up issue): bare engine `execSync` string commands in
  sandbox-ssh.ts (~:451) and sandbox-podman.ts (~:297) share the M1
  startup-env PATH behavior but are not implicated in this nightly and are
  mocked in their tests.
- Reject: mock-interaction assertion style in the #1456 test (pre-existing;
  the plan explicitly required updating its call shape).

## Review record (OCR rounds 1-2, zai profile)

Round 1 (session 9a3342ab): 2 findings. (1) medium — autocrlf pin alone
does not defeat work-tree `.gitattributes` / `core.attributesfile` eol
rules → In-scope-Fix: setupShadowGitRepository now also writes the shadow
repo's `.git/info/attributes` with `* -text` (highest-precedence repo-level
override). (2) low — ps prewarm spawnSync result ignored → split triage:
the exit-47 rationale was a factual mistake (beforeEach sets
LLXPRT_TEST_PROCESS_STARTS and ownerFor() appends the owner row before the
spawn, so the fixture answers normally) — rejected; the throw-on-transport-
error part was adopted.

Round 2 (session 6ece9bec): 2 findings. (1) high (Blocker-Fix) — the
architect-suggested `!fs.existsSync(FAKE_ENGINE_SCRIPT_PATH)` catch fallback
is unreliable inside a bun build --compile executable (the embedded bunfs
still contains the module source, so existsSync may be true and main() would
never run for the compiled docker.exe/podman.exe). Fixed by replacing ALL
filesystem heuristics with an invocation-based signal:
`import.meta.main === true || argv[1] basename in ['docker','podman']`.
(2) low (In-scope-Fix) — added a gitService.test.ts assertion that the
attributes override was written (`* -text
`).

Verification after every remediation batch: full cycle (test 740/740 files,
lint, typecheck, format, build, stepfun-37 smoke, git diff --check) —
cycles 3, 4, 5 all green.
