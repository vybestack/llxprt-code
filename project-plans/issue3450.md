# Issue #3450: Isolate sandbox project dependencies from the host

Plan ID: `PLAN-20260831-ISSUE3450`

Issue: <https://github.com/vybestack/llxprt-code/issues/3450>

## Scope

This issue covers the normal installed-mode container workflow:

1. The user starts LLxprt with Docker or Podman in an existing repository.
2. The sandbox starts the image-global `llxprt`. It does not load the mounted
   project's dependencies to start the agent.
3. The agent works in the same read-write repository mounted from the host.
4. The agent may run the repository's installer, build, and tests inside that
   sandbox run.
5. The host does not run an installer, build, or test command while that sandbox
   run is active.

The source workspace remains one shared read-write bind mount. Source edits made
inside the sandbox remain visible on the host, and host source edits remain
visible inside the sandbox. There is no private workspace copy, second checkout,
source synchronization, or copy-back step.

Project-local `node_modules` directories are untracked, ignored installation
output. They must not cross the host and Linux-container platform boundary. The
container receives fresh private, writable directories at the protected
`node_modules` paths. An install, build, or test inside the container therefore
cannot read or change the host's project-local dependency contents.

Concurrent host and container builds are outside this issue. The acceptance
workflow has one sandbox writer and no host package-manager, build, or test
process during the run.

## Current behavior

`buildContainerRunArgs()` in
`packages/cli/src/utils/sandbox-containers.ts` creates one read-write workspace
bind. `prepareContainerImageAndArgs()` in
`packages/cli/src/utils/sandbox-exec.ts` assembles the remaining mounts. A child
`node_modules` path currently remains part of the parent workspace bind, so host
and container installs can consume or replace each other's platform-specific
files.

Normal installed mode already runs the image-global `llxprt` from
`packages/cli/src/utils/sandbox-entrypoint.ts`. That agent can start before the
mounted project has dependencies and can later invoke an installer through its
shell tool. This is the startup path covered by this issue.

The root manifest in this repository declares literal nested workspace package
roots. Root-only isolation would leave those package-local `node_modules` paths
on the shared workspace bind.

## Verified storage choice

Docker and Podman experiments established the implementation choice:

- A nested mount hides the corresponding child of the parent workspace bind in
  both engines.
- A root `node_modules` mount does not also hide a nested package's
  `node_modules`; each protected package root needs its own destination.
- Fresh anonymous or named volumes are not reliably writable by the image's
  normal UID 1000 process in Docker.
- Fresh host directories beneath LLxprt's platform-standard user cache/state
  area are writable by the normal main-container user in both Docker and Podman.
- A user-home cache/state path is available to macOS Podman without relying on
  `/tmp` or an external volume being shared with its VM.
- Docker-only `volume-nocopy` is not portable to Podman.

Use a unique per-run directory beneath the existing LLxprt cache/state resolver.
Create one fresh child as the bind source for each protected destination. Mount
only those fresh children, not the surrounding cache directory. Remove the run
directory through the existing handled sandbox cleanup lifecycle.

## Accepted behavior

### AC-1: Normal image-global startup remains independent of project dependencies

The normal sandbox entrypoint starts the image-global `llxprt` while the
project's protected `node_modules` destinations are empty private mounts. Startup
does not read the host's project dependencies and does not require an install
before the agent can run an installer itself.

The image-global LLxprt installation and `/usr/local/bun` remain available and
are not over-mounted, copied, or replaced.

### AC-2: Private dependencies persist for one sandbox run

Each Docker or Podman sandbox run gets fresh, writable private storage at:

1. `<workspace>/node_modules`; and
2. `node_modules` beneath each contained nested Node package root declared by
   the root manifest's ordinary workspace list, including the literal workspace
   entries used by this repository.

The same private directories remain mounted from agent startup through the
agent's install, build, and test commands. Later commands in that run can use
what the installer wrote. A later sandbox run receives fresh storage and cannot
see private dependency files from the earlier run.

Root protection does not depend on a root manifest being present or valid.
Nested-root selection reads the valid manifest declaration needed for normal
workspace behavior. Paths are normalized, deduplicated, and required to remain
inside the mounted workspace. This issue does not recursively search the entire
repository for every `package.json` or orphan `node_modules` directory.

### AC-3: Shared source remains read-write

Files outside the protected `node_modules` destinations remain on the existing
single read-write workspace bind. The container can edit source, and those bytes
are immediately visible in the original host repository. Host source changes
are visible in the running container.

No private source tree, synchronization protocol, read-only source conversion,
or agent-specific worktree is introduced.

### AC-4: Container install, build, and test leave host dependencies unchanged

Start with known host contents at every protected project-local `node_modules`
path. During one normal image-global agent session, run the fixture's installer,
build, and tests only inside the sandbox. The container commands must use the
private mounted dependencies.

After the sandbox exits, compare the host dependency trees with their pre-launch
snapshots. Relative paths, file bytes, file kinds, and symlink targets must be
identical. A protected host path that was absent before launch must still be
absent. Expected source output outside `node_modules` remains shared and is not
part of this dependency snapshot.

### AC-5: Recognized wrong-platform host contamination fails before launch

Before private mounts hide existing host dependency trees, perform a read-only
host preflight over the protected roots. Traversal covers the protected trees
in full (a truncation that could miss contamination is deliberately not
applied); what stays bounded is artifact recognition, whose reads are limited
to a fixed-size header probe plus at most one positioned follow-up read. Fail
before launching the main container when a path that is likely to be executed
is clearly from the wrong operating-system platform. Required recognized cases
are:

- an ELF native addon or executable on a non-Linux host;
- a Mach-O native addon or executable on a non-macOS host;
- a PE native addon or executable on a non-Windows host; and
- a `.bin` symlink with a dangling absolute target in a known Linux
  image-global location, such as `/usr/local/bun/bin/bun`.

Limit executable inspection to `.node` native addons and entries reached through
protected `.bin` directories. Recognition may use the minimum validated magic
and header bytes needed to distinguish ELF, Mach-O, and PE for these cases. It is
not a general executable inspection subsystem and does not need architecture
catalogs, universal-binary policy, or diagnosis of unknown formats.

The failure names the affected path relative to the workspace, the recognized
platform or dangling target, and the host platform. It tells the user to remove
the affected project-local `node_modules`, reinstall on the host, and retry.
Unknown, truncated, script, and matching-host files do not produce a
wrong-platform error.

### AC-6: Private storage is writable, portable, and cleaned up

The private bind sources use the verified host-backed LLxprt cache/state
location and are writable by the existing selected main-container user in both
Docker and Podman. Do not fall back to the shared workspace path, an engine
volume, or an arbitrary `/tmp` path.

A handled normal exit, launch failure, or interruption removes the dedicated
per-run subtree. Creation, mount preparation, or cleanup failure reports the
specific operation and path. Container `--rm` remains enabled.

Persistent dependency caching and reuse across runs are not part of this issue.

## Boundary decisions

| Case | Required result |
| --- | --- |
| Docker selected | Use fresh writable host-backed private dependency mounts. |
| Podman selected | Use the same behavior without Docker-only mount options. |
| Seatbelt selected | Unchanged. This issue addresses Linux container isolation. |
| Root manifest absent or invalid | Protect root `node_modules`; do not invent nested roots. |
| Valid literal nested workspace root inside the repository | Protect its `node_modules`, whether or not that directory exists yet. |
| Declared nested path escapes the repository | Fail before launch with the declaration and path. |
| Duplicate declared package root | Create one private destination. |
| Existing orphan `node_modules` outside the root and declared package roots | Outside this issue; do not recursively discover it. |
| Host dependency path absent before launch | Do not create it on the host; it remains absent after exit. |
| Unknown or benign executable bytes | Do not report wrong-platform contamination. |
| Recognized wrong-platform `.node` or `.bin` executable | Fail on the host with repair guidance before main-container launch. |
| Agent writes source outside protected paths | The write appears in the original host repository. |
| Agent installs, then builds and tests in one run | Later commands use the same private dependency storage. |
| Second sandbox run | It starts with fresh private dependency storage. |

## Behavioral test evidence

Tests must exercise production argument generation or the production launch
path. They use real temporary directories and inspect filesystem and process
outcomes rather than mocked call counts.

### Focused Bun tests

Add RED cases before implementation for:

1. root plus the literal manifest-declared nested package roots used by this
   repository;
2. path containment, normalization, and deduplication;
3. no recursive orphan discovery;
4. private mount sources under a unique LLxprt cache/state run directory;
5. one nested destination per accepted package root after the shared workspace
   bind;
6. host paths remaining absent or byte-identical after argument preparation;
7. recognized ELF, Mach-O, PE, and dangling absolute `.bin` link failures through
   the production host preparation path;
8. scripts, unknown/truncated bytes, matching-host formats, empty trees, and
   absent trees continuing without a contamination error; and
9. cleanup after a handled preparation failure.

Expected diagnostics use independent literal values rather than production
format tables.

### Real Docker and Podman behavior

Add a focused real-container test using the existing runtime and image gating
pattern in `integration-tests/sandboxPrivilege.real.test.ts`. Exercise Docker and
Podman when each is available.

The fixture contains a root Node package, a manifest-declared nested package,
shared source, and pre-existing benign host markers in both protected dependency
trees. Snapshot each host dependency tree before launch.

Use the production sandbox launch path and normal main-container user. Start the
image-global LLxprt with a deterministic local response fixture, then have the
agent invoke an offline installer followed by fixture build and test commands in
the same sandbox session. The fixture may use only local/file dependencies so no
registry access is required. The host test process only orchestrates the
sandbox and inspects results; it does not run the fixture's installer, build, or
tests.

The real-engine assertions prove that:

- image-global LLxprt starts before project dependencies exist in the private
  mounts;
- host markers are hidden inside the container;
- install output is writable and remains available to the later build and test;
- build and test execute against private container dependencies;
- a source result outside `node_modules` appears in the host repository;
- all protected host dependency snapshots are byte-for-byte unchanged after
  exit;
- a previously absent protected host path remains absent;
- the private per-run storage is removed after exit; and
- a second run cannot see a marker from the first run.

Do not replace this test with argv-only assertions or hand-built mount flags.

## Test-first implementation sequence

1. **RED: package roots and mount topology.** Add real-filesystem Bun tests for
   the root and manifest-declared nested roots, containment, private source
   placement, and generated argument ordering. Confirm the current shared bind
   exposes the host dependency paths.
2. **GREEN: private per-run mounts.** Resolve only the accepted package roots,
   create the fresh writable host-backed sources, append the nested binds, and
   carry cleanup through the existing sandbox lifecycle.
3. **RED: bounded contamination preflight.** Add real `.bin`, symlink, and
   `.node` fixtures for the required recognized and non-error cases. Confirm the
   current preparation path does not stop recognized contamination.
4. **GREEN: host fail-fast.** Add the minimum package-internal byte and symlink
   inspection needed for AC-5. Run it before private mounts hide host contents.
5. **RED then GREEN: real engines and exact workflow.** Add the deterministic
   image-global agent test. Prove install, build, test, shared source, unchanged
   host dependencies, cleanup, and run-to-run freshness under Docker and Podman.
6. **REFACTOR and document.** Keep helpers package-internal, update sandbox user
   documentation, and run focused and full verification.

Do not add a dependency, setting, schema entry, workflow, package script, test
runner, daemon, or public abstraction.

## Chosen implementation shape

1. Keep the existing single read-write workspace bind.
2. Resolve the root and valid literal package roots declared by the root
   manifest's workspace list. Reject declared paths that escape the workspace.
3. Inspect only those existing host dependency trees for the recognized
   contamination in AC-5.
4. Create one fresh writable source per protected destination beneath a unique
   child of the existing LLxprt cache/state directory.
5. Add one nested bind per protected `node_modules` after the workspace bind and
   before launching the main container.
6. Start the existing image-global LLxprt entrypoint unchanged. The agent may
   then run the repository's installer, build, and tests inside the same run.
7. Remove the dedicated run subtree through the existing handled cleanup path.

No source synchronization, package-manager selection, automatic pre-agent
install, host package-manager cache mount, host global module mount, engine
volume, or fake home directory is introduced.

## Likely affected files during implementation

- `packages/cli/src/utils/sandbox-containers.ts`
- `packages/cli/src/utils/sandbox-containers.test.ts`
- `packages/cli/src/utils/sandbox-exec.ts`
- `packages/cli/src/utils/sandbox-node-modules.ts` (new package-internal helper)
- `packages/cli/src/utils/sandbox-node-modules.test.ts` (new Bun test)
- `integration-tests/sandboxNodeModulesIsolation.real.test.ts` (new real-engine
  Bun test with a 2026 copyright header)
- `docs/sandbox.md`

`packages/cli/src/utils/sandbox-entrypoint.ts` is not expected to change because
normal image-global startup already has the required dependency-independent
behavior.

Dependencies, lockfiles, settings, schemas, package exports, Dockerfiles,
workflows, package scripts, and quality-tool configuration are not affected.

## Finding classification

Only **Blocker-Fix** and **In-scope-Fix** findings authorize implementation
changes for issue #3450.

| Finding or proposal | Class | Disposition |
| --- | --- | --- |
| Root or manifest-declared nested dependencies remain visible through the shared workspace bind | Blocker-Fix | Add a fresh writable nested bind for each accepted destination. |
| Private storage is not writable by the normal main-container user in Docker or Podman | Blocker-Fix | Use the verified host-backed LLxprt cache/state approach and prove both engines. |
| Normal image-global LLxprt cannot start before a project install | Blocker-Fix | Preserve installed-mode startup and prove the agent starts before running the installer. |
| Container install, build, or test changes host dependency bytes or symlink targets | Blocker-Fix | Fix mount topology or lifecycle and retain the real behavioral regression test. |
| Recognized wrong-platform contamination reaches main-container launch | Blocker-Fix | Run the bounded host preflight before adding private mounts and return repair guidance. |
| Shared source outside protected dependency paths stops being read-write | Blocker-Fix | Preserve the existing workspace bind and prove source writes in both directions. |
| Per-run host-backed sources, contained package-root resolution, and handled cleanup | In-scope-Fix | Implement within existing sandbox preparation and execution code. |
| Focused internal helper for accepted root resolution and contamination checks | In-scope-Fix | Keep it package-internal with Bun behavioral tests. |
| Anonymous/named dependency volumes or Docker-only `volume-nocopy` | Reject | They do not meet verified Docker and Podman writability and portability. |
| Private workspace copy, source synchronization, second checkout, or copy-back | Reject | The accepted workflow uses the original shared read-write source tree. |
| Mount host dependency trees, global modules, or package-manager caches into the container | Reject | This recreates cross-platform dependency sharing. |
| Automatically run an installer before the image-global agent starts | Reject | The agent starts from the image and chooses project commands after startup. |
| Exhaustively recurse through the repository for package manifests or orphan dependency trees | Reject | Protect the root and manifest-declared nested Node package roots required by the normal workflow. |
| General executable-format, architecture, integrity, or package-corruption subsystem | Reject | Implement only the bounded recognized wrong-platform checks in AC-5. |
| Broad custom-mount parsing or collision policy | Defer | Normal acceptance does not target protected paths with custom mounts. Handle general mount-policy questions in a separate issue. |
| Explicit `NODE_ENV=development` source-entrypoint bootstrap behavior | Defer | Existing issue #3455 owns source-development startup and dependency provisioning. It is outside normal installed-mode acceptance and does not block #3450. |
| Persistent dependency cache, cross-run reuse, invalidation, or migration | Defer | This issue requires fresh per-run storage only. |
| Other package-manager workspace metadata forms beyond the ordinary list needed here | Defer | Add them only with a separate behavior requirement and tests. |
| Rust, Python, C, or unrelated build-artifact isolation | Defer | Issue #3450 covers project-local Node dependencies. |
| New dependencies, settings, workflows, or public abstractions | Defer | No accepted behavior requires them. |

## Approval status

There is no remaining approval blocker for the normal installed-mode design.
The image-global sandbox agent can start without project dependencies, then run
an installer, build, and tests against private writable dependency mounts while
continuing to edit the shared source workspace.

The explicit `NODE_ENV=development` source-entrypoint path is deferred to issue
#3455. It must not widen or delay issue #3450.

## Implementation evidence

Implementation completed on branch `issue3450` (uncommitted). All RED/GREEN and
verification logs are preserved under `tmp/issue3450/`.

### Change inventory

| File | Change |
| --- | --- |
| `packages/cli/src/utils/sandbox-node-modules.ts` | New package-internal helper: protected-destination resolution, bounded wrong-platform preflight, per-run private mounts, cleanup closure. |
| `packages/cli/src/utils/sandbox-exec.ts` | Calls the helper after `addContainerVolumeMounts`, releases storage on every aborting preparation step, carries the cleanup into `wireCleanupHandlers`. Credential-proxy setup extracted into `prepareCredentialProxyBridge` to hold the function-size lint budget. |
| `packages/cli/src/utils/sandbox-containers.ts` | `ContainerSandboxPrepared.dependencyStorageCleanup` field; `wireCleanupHandlers` wires an idempotent removal on exit/SIGINT/SIGTERM/close. |
| `packages/cli/src/utils/sandbox-containers.test.ts` | Failed-launch lifecycle test: storage is removed when a later preparation step aborts. |
| `packages/cli/src/utils/sandbox-node-modules.test.ts` | 30 focused Bun tests over resolution, preflight, mounts, host immutability, and cleanup. |
| `integration-tests/sandboxNodeModulesIsolation.real.test.ts` | Real Docker/Podman suites driving production argv, plus a gated full-CLI-relaunch suite whose image-global agent installs, builds, and tests in one session. |
| `docs/sandbox.md` | Filesystem subsection on per-run private `node_modules`, and a Troubleshooting entry for the preflight error. |

`sandbox-entrypoint.ts` is unchanged: installed-mode startup was already
image-global.

### Recovered RED/GREEN evidence (prior run)

- `tmp/issue3450/unit-red.log`, `integration-red.log`: both new test files
  failed before the module existed.
- `unit-green3.log`: 30/30 focused unit tests pass.
- `containers-wiring4.log`: 42/42 container tests pass including the new
  failed-launch lifecycle test.
- `integration-green5.log`: both Docker engine suites pass; the image-global
  agent suites were skipped before the gate defect was understood.

### Completion-run RED/GREEN evidence (this session)

| Concern | RED | GREEN |
| --- | --- | --- |
| `npm run build` on the new helper | `build-cycle.log`: TS2339, object-destructured `fs.readSync` return typed `number` | `build-cycle2.log`: `npm run build` exit 0 after switching to the numeric return |
| Full typecheck | `verify-typecheck.log`: 3 errors (mock stdout typing; two stale 4-arg calls) | `verify-typecheck2.log`: exit 0 |
| Full lint | 18 errors in the new files (expression complexity, redundant assertions, loop breaks, unused symbols) | `verify-lint.log`: exit 0 |
| Gate could never engage | `integration-docker-freshimage-gate-red.log`: bootable image present, gated suites still skip (`sh -lc` resets PATH) | `integration-docker-freshimage-green3.log`: 4/4 pass with `sh -c` |
| Gated agent sessions failed | ENOENT on the responses fixture: host `TMPDIR` prefix (`/var/folders`) differs from the bind's realpath (`/private/var/folders`), and the fixture lived outside the workspace bind | fixtures moved into the repo; `realpathSync` forwarded; both engines green |
| Audit SELF_CONFIRMING | `test-audit-summary.log` flagged the before/after snapshot test | snapshots anchored to known marker entries (`unit-green-audit-fix2.log`, `test-audit-final`) |

### Acceptance-criteria evidence

- **AC-1** (startup independent of project deps): the gated suites start the
  image-global `llxprt` while protected mounts are empty private binds
  (`env-check.sh` proves `llxprt` and `/usr/local/bun` are present and
  unover-mounted). Docker `integration-docker-freshimage-green3.log`, Podman
  `integration-podman-freshimage-green.log`.
- **AC-2** (fresh private storage per run, same storage across one run):
  install writes `node_modules/.bin/fixture-tool` and a run marker; the later
  build and test consume them; run two sees no run-one marker. Proven in both
  engines, both suite styles.
- **AC-3** (shared read-write source): in-container `results/*` files appear in
  the host fixture repository in every suite.
- **AC-4** (host dependencies unchanged): every suite snapshots both protected
  host trees before launch and byte-compares relative paths, kinds, contents,
  and symlink targets after exit; the absent protected path gains nothing.
- **AC-5** (wrong-platform preflight): focused unit tests cover ELF, Mach-O
  (thin and fat), PE via `.bin`, dangling `/usr/local/bun/bin/bun`, plus the
  no-error cases (scripts, unknown/truncated bytes, matching host, `prebuilds`,
  empty/absent trees), driven through the production host preparation path.
- **AC-6** (writable, portable, cleaned storage): private sources under
  `Storage.getGlobalCacheDir()` per run; Docker mounts unlabeled, Podman mounts
  `:z` (matching the existing config-mount convention); per-run subtree removed
  on handled exits (both engines) and on failed launch (unit lifecycle test).

### Real-engine results (final tree)

| Engine | Suites | Result |
| --- | --- | --- |
| Docker (locally built `0.11.0` image) | 2 engine-path + 2 image-global agent | 4 pass, 0 fail (`integration-docker-freshimage-green3.log`) |
| Podman (same image via `docker save \| podman load`) | 2 engine-path + 2 image-global agent | 4 pass, 0 fail (`integration-podman-freshimage-green.log`) |

The registry-published `0.11.0` image (built 2026-08-04) cannot boot its
global CLI standalone (`Cannot find module '@ast-grep/napi'`; probe logs
`image-global-cli-probe*.log`), so the gated suites skip against it. Building
`npm run build:sandbox` from this tree produces a bootable image. That image
defect is tracked separately as issue #3456 and is outside #3450.

### Verification cycle (final tree)

- `npm run lint` — exit 0 (`verify-lint.log`)
- `npm run typecheck` — exit 0 (`verify-typecheck2.log`)
- `npm run format` — exit 0, change set unchanged (`verify-format.log`)
- `npm run build` — exit 0 (`verify-build.log`)
- `npm run test` — exit 0 (`verify-npm-test2.log`, zero failures; a first
  pass in `verify-npm-test.log` ran concurrently with `npm run build` and
  recorded environment-induced failures from `dist/` being rewritten mid-run,
  including the since-fixed `sandbox-proxy-integration` source-order finding
  below; the clean sequential re-run is authoritative)
- Smoke: `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` — exit 0, haiku
  returned (`verify-smoke.log`)
- Test audit (`scripts/test-audit/scan.ts`): touched files carry no
  MOCK_MIRROR findings; one SELF_CONFIRMING flag on the before/after snapshot
  test, mitigated by anchoring both snapshots to known marker entries
  (`test-audit-summary-final2.log`, `test-audit-final2/findings.tsv`).

### Session note (environment, not code)

`build:sandbox`'s `prepack` step requires the repo's `patch-package` ink patch
(`scripts/postinstall.cjs`). This checkout's `node_modules` predated the patch,
so the standard remedy (re-running the repo postinstall) was applied before the
image build. No repository file changed as a result.

### Completion-run finding triage

| Finding | Class | Disposition |
| --- | --- | --- |
| New helper used the object form of `fs.readSync`, breaking `npm run build`/typecheck | Blocker-Fix | Switched to the numeric-return form; build and typecheck green. |
| Test gate used `sh -lc`, whose login-shell PATH reset can never find the image-global CLI | Blocker-Fix | Changed to `sh -c`; corrected the skip-reason comments; gated suites now engage and pass on both engines. |
| Gated agent suites read a responses fixture outside the workspace bind, and forwarded the symlinked `TMPDIR` prefix instead of its realpath | Blocker-Fix | Fixtures moved inside the fixture repo; `realpathSync` used for the forwarded path. |
| 18 lint errors in the new files (complexity, redundant assertions, loop-break budget, unused symbols) | Blocker-Fix | Header classifier split into `hasMagicPrefix`/`readUint32BE`/`readUint32LE`/`classifyPeHeader`; single literal-root guard; unused parameter/variable removed; non-null assertions dropped. |
| 3 typecheck errors (mock `stdout` typed `EventEmitter`; two stale 4-arg calls) | Blocker-Fix | Mock emits through a real `Readable.from`; call sites updated after the unused `containerWorkdir` parameter was removed. |
| `prepareContainerSandbox` exceeded the 80-line budget after cleanup wiring | In-scope-Fix | Extracted behavior-preserving `prepareCredentialProxyBridge`; the pre-existing source-structure test `sandbox-proxy-integration.test.ts` requires `await setupCredentialProxy` to remain textually between `prepareContainerSandbox` and the container spawn, so the helper definition is placed after `prepareContainerSandbox` (RED `verify-npm-test.log` FAIL 656/718, GREEN `proxy-structure-test.log` 26/26). |
| Duplicated `afterEach` block (prior-run debug artifact) in `sandbox-containers.test.ts` | In-scope-Fix | Removed. |
| `docs/sandbox.md` documentation missing | In-scope-Fix | Added the per-run private `node_modules` subsection and the preflight Troubleshooting entry. |
| Audit SELF_CONFIRMING on the before/after snapshot unit test | In-scope-Fix | Anchored snapshots to the known marker files. |
| Engines materialize an empty host mountpoint directory for a protected path that was absent | Reject (no change) | No bytes ever leak into it; strict absence through argument preparation is asserted in the unit suite; the integration assertion permits an empty directory and documents why. |
| Persistent dependency caching, custom-mount collision policy, other manifest forms | Defer | Unchanged from the plan's boundary decisions. |

## Remediation review (implementation-review findings F1–F9)

The implementation review of the uncommitted #3450 tree returned nine
findings. All Blocker-Fix and In-scope-Fix findings were remediated with
RED/GREEN evidence under `tmp/issue3450/remediation/`; the one outside-scope
behavior was removed. No finding broadened the feature.

### Finding triage and dispositions

| Finding | Class | Disposition |
| --- | --- | --- |
| F1: private bind children mode 0755 may be unwritable under a container UID that differs from the host owner | Blocker-Fix | Each private dependency directory is created `0777` (`mkdir mode` + explicit `chmod`, umask-proof); the random mkdtemp run parent keeps `0700`. Real-engine proof below. |
| F2: preflight missed regular executables directly in `.bin`, symlinked `.node` files, real universal/fat Mach-O headers, and PE headers whose validated e_lfanew lies beyond the initial buffer | Blocker-Fix | Regular files in `.bin` are header-checked; symlinked `*.node` entries are followed to contained targets (read-only, never executed); a big-endian fat magic (`0xcafebabe`/`0xcafebabf`) with an `nfat_arch` sanity bound (1..128) is recognized only when the complete declared architecture table (`8 + 20·n` fat_arch / `8 + 32·n` fat_arch_64 bytes) is readable — see the final F2 correction below; a validated `pe-continuation` triggers one positioned read for the `PE\0\0` signature (offset bound 0x40..2^24). |
| F3: generic missing `/usr/bin`, `/bin`, `/usr/local/bin` targets were falsely described as LLxprt image-only | In-scope-Fix | Dangling absolute `.bin` links now fail only for the validated image-global prefix `/usr/local/bun/bin/` (the Dockerfile's `BUN_INSTALL` location, covering `bun`/`bunx`); unknown absolute targets never fail. |
| F4: lexical containment let existing manifest roots or executable-link targets escape through symlinks | In-scope-Fix | Destinations resolve through `realpath` of the nearest existing ancestor (missing contained tails stay supported); both lexical and real-tree escapes fail before launch; existing destinations deduplicate by filesystem identity; contained destinations re-anchor onto the launch workspace path; `.bin`/`.node` symlink targets are inspected only when their resolved nearest-existing identity stays inside the real workspace. |
| F5: an absent protected host path could remain as an engine-created empty mountpoint after exit (supersedes the prior "Reject (no change)" triage row above) | Blocker-Fix | Originally absent destinations are recorded at preparation; every handled cleanup path removes the per-run subtree and then removes those destinations only while they are empty directories (`rmdir`, never recursive, nonempty/symlink untouched). Real Docker and Podman suites now require strict absence. |
| F6: dependency storage cleanup was registered too late (signal/sidecar/main-launch windows) and failures were debug-only | In-scope-Fix | Idempotent cleanup registers on process `exit`/`SIGINT`/`SIGTERM` immediately after run-root creation and unregisters itself on completion; `executeContainerSandbox` wraps the launch section so a sidecar or main-launch failure releases storage; removal failures emit a user-visible `process.stderr.write` warning naming operation and path (existing style) plus a debug log. No new public lifecycle subsystem. |
| F7: excluded `NODE_ENV=development` behavior must stay unchanged | In-scope-Fix | `addPrivateDependencyMounts` is a no-op (no preflight, no mounts, no storage) under `NODE_ENV=development`; #3455 remains deferred and nothing is provisioned or installed in development mode. |
| F8: missing behavioral evidence and a SELF_CONFIRMING audit finding; unit tests inspected the shared live global cache | In-scope-Fix | Added: nested private dependency write/use/persistence (root and nested tree in one run, consumed by the later build/test); host-to-running-container live source visibility (async launch, host writes while the container polls); host symlink fixtures in both protected trees preserved through full sessions (including two live unknown-prefix dangling absolute `.bin` links proving F3 tolerance); production launch preflight stopping before engine invocation (only the read-only `images` probe spawn occurs); isolated `LLXPRT_CACHE_HOME` per test suite; deterministic non-directory destination failure naming operation and path; signal cleanup via a subprocess that self-SIGINTs; post-preparation launch-failure cleanup; UID-mismatch real-engine proofs. Unit snapshot expectations use literal Maps (SELF_CONFIRMING removed); the containers lifecycle suite also isolates the cache. |
| F9: `workspaces.packages` object-form support was outside the accepted scope | Reject | Removed the object-form interpretation from `readLiteralWorkspaceDeclarations` (list form only) and replaced its test with one asserting the object form protects only the root tree. |

### Remediation RED/GREEN evidence

| Concern | RED | GREEN |
| --- | --- | --- |
| F1–F9 unit behavior (one rewrite) | `unit-red1.log`: exactly 20 failures mapping 1:1 to the finding list | `unit-green3.log` → 52/52 (final `unit-final3.log`, 110 assertions) |
| F6 launch-failure window | `containers-red2.log`: rejects with `engine launch failed` but leaks `sandbox-node-modules-d5nh93` (try/catch temporarily reverted) | `containers-green1.log` 44/44 incl. the new launch-failure and preflight-before-engine tests |
| F5 strict absence on real Docker | `integration-docker-red1.log`: 5 failures — the engine-created empty mountpoint at `packages/absent/node_modules` survives (mountpoint removal temporarily neutered) | `integration-docker-green2.log`: 7 pass / 0 fail |
| F5 strict absence on real Podman | (same production change; suite rerun clean) | `integration-podman-green1.log`: 7 pass / 0 fail |
| Test audit | First scan flagged 4 findings on the touched unit file (1 DUP_ASSERT, 3 SELF_CONFIRMING on listener-count baselines) | `test-audit3/findings.tsv`: 0 findings on all touched files |

### F1 real-engine UID-mismatch evidence

On this macOS host, host-backed binds cross virtiofs on BOTH engines and
virtiofs does not enforce mode bits (probe evidence under
`tmp/issue3450/probe/`: a root-owned 0755 host bind accepted writes from
`--user 54321:54321`), so the denial cannot be reproduced through the
workspace bind here. The requirement is therefore proven where the engines
keep state on real Linux kernels:

- Docker named volume (VM ext4): root-owned `0755` + uid 54321 →
  `Permission denied`; `0777` → write succeeds.
- Podman (rootless machine): named volumes are idmapped (appear owned by the
  container uid, `idmap=off` unsupported), so the enforced path is a
  root-owned tmpfs: `mode=0755` + `su nobody` → denied; `mode=0777` → allowed.
- Both engines also prove the delivered behavior end to end through the
  production argv: a mismatched `--user 54321:54321` container completes the
  fixture install/build/test against the private mounts
  (`accepts mismatched-container-UID writes into the private dependency
  mounts`).

### Remediation verification cycle

See `tmp/issue3450/remediation/` for every log. Focused: unit 52/52 before
the lint-budget split; after splitting the oversized test files (see below)
96/96 across five files (`unit-after-split2.log`), containers 44/44,
proxy-structure 26/26, Docker 7/7 (`integration-docker-green3.log`), Podman
7/7 (`integration-podman-green2.log`), audit 0 findings on touched files
(`test-audit-final3/findings.tsv`).

Final full-cycle rerun after the lint fixes: `npm run typecheck` exit 0
(`verify-typecheck3.log`), `npm run build` exit 0 (`verify-build2.log`),
`npm run format` exit 0 with no change-set delta (`verify-format2.log`),
`npm run lint` exit 0 (`verify-lint4.log`; an earlier 136-error full-tree
run, `verify-lint2.log`, had measured type-aware rules against the pre-build
`dist/` type state — after the rebuild those untouched-file errors resolve,
and a canary file confirms rule enforcement is live), `npm run test` exit 0
zero failures (`verify-npm-test3.log`), and the stepfun-37 smoke haiku
(`verify-smoke2.log`).

Late remediation-session lint budget: the two grown test files exceeded the
800 non-comment/non-blank line budget (819 and 814) and carried one
floating-promise, one collapsible-if, and one unnecessary-condition error.
Fixes: split the preflight and lifecycle describes into
`sandbox-node-modules-preflight.test.ts`,
`sandbox-node-modules-lifecycle.test.ts`, and
`sandbox-launch-lifecycle.test.ts` (tests unchanged, only moved; helpers
duplicated per file), merged the collapsible conditions in the production
walk, dropped the unnecessary nullish coalescing, and prefixed the auth
boundary `vi.mock` with `void` per the repo pattern. All 96 tests re-ran
green after the split; the audit was re-run clean on the new files.

## Final F2 correction (truncated universal headers)

The final blocker-fix review found one remaining F2 defect: the
universal/fat classifier accepted an eight-byte magic-plus-`nfat_arch`
prefix as a complete file, so a truncated universal header produced a
wrong-platform contamination error instead of the accepted benign
truncated-file behavior, and the positive fixtures encoded that same
truncated representation. Apple fat structures are stored big-endian, so
the `FAT_CIGAM` byte-swapped constants are host-memory comparison values,
not additional little-endian on-disk formats; recognizing them through a
big-endian on-disk read was incorrect and was removed.

Correction, strictly within the existing preflight behavior:

- `classifyFatHeader` now requires the COMPLETE declared architecture
  table to be readable before classifying as Mach-O: `8 + 20·nfat_arch`
  bytes for 32-bit fat (`0xcafebabe`) and `8 + 32·nfat_arch` bytes for
  64-bit fat (`0xcafebabf`), with the existing 1..128 `nfat_arch` bound
  kept. When the declared table extends beyond the 512-byte probe, one
  positioned read proves the table's final byte exists (a `fat-continuation`
  mirroring the existing `pe-continuation`); a short read stays benign.
- Only the on-disk big-endian fat magics are recognized; the byte-swapped
  `0xbebafeca`/`0xbfbafaca` values were removed from the magic set.
- Thin Mach-O behavior is unchanged.
- Positive fixtures now build complete valid big-endian universal headers
  (declared `fat_arch`/`fat_arch_64` records included); RED cases cover the
  bare 8-byte prefixes, one-byte-short tables, a table truncated past the
  probe, and the byte-swapped CIGAM byte orders.

RED/GREEN and verification evidence is preserved under
`tmp/issue3450/final-f2/`: `red-preflight.log` (25 pass / 4 fail — exactly
the four truncated-header/CIGAM no-error cases fail against the prior
classifier), `green-preflight2.log` (32/32 after the fix and an
audit-driven reorganization of the new cases into `it.each` form),
`unit-issue-focused2.log` (130/130 across the six issue-focused files),
`integration-docker.log` and `integration-podman.log` (7 pass / 0 fail per
engine, image-global agent suites engaged on both), and
`test-audit2/findings.tsv` (0 findings on all touched files).

## OCR remediation (open-code-review findings F1–F14)

The first full local open-code-review of the uncommitted #3450 tree returned
14 findings (`tmp/issue3450/ocr/review1.json`; readable extract at
`tmp/issue3450/ocr-remediation/ocr-review-extract.txt`). This F1–F14
numbering is the OCR review's own and is separate from the
implementation-review F1–F9 numbering used above. The triage was fixed
before any change; only the one Blocker-Fix and the In-scope-Fix findings
changed code or tests. Every log for this pass lives under
`tmp/issue3450/ocr-remediation/`.

### Finding triage and dispositions

| Finding | Class | Disposition |
| --- | --- | --- |
| F1: the 0o777 private bind children are writable by any local user while the session runs | Reject | The random `mkdtemp` run parent keeps its 0700 mode, so other local users cannot traverse to the children. The wide child mode is what delivers the accepted arbitrary-container-UID writability (proven by the mismatched-UID suites on both engines); the review's sticky-bit and ownership alternatives are speculative narrowing with no accepted requirement behind them. No change; no ownership subsystem added. |
| F2: glob workspace declarations are skipped, so nested trees in glob-configured monorepos stay on the shared bind | Defer (#3468) | Accepted #3450 scope is the root plus valid literal entries in the ordinary workspaces list. No glob expansion was implemented and launch behavior was not changed. |
| F3: `fs.realpathSync` calls can escape as raw ENOENT/ELOOP instead of `FatalSandboxError` | Defer | Optional malformed-workspace hardening beyond the accepted inputs; behavior unchanged. |
| F4: `assertBinSymlinkResolvesOnHost` and `assertNodeSymlinkMatchesHost` duplicate the readlink/resolve/containment/stat/header sequence | Reject | An unrelated optional refactor; both routines stay as they are. |
| F5: the word "bounded" misdescribes a preflight whose traversal covers the full protected trees | In-scope-Fix | Comments and docs now state precisely that artifact recognition is bounded (one fixed-size header probe plus at most one positioned follow-up read per candidate) while traversal covers the full protected trees. No truncation was added, deliberately, because truncation could miss contamination. Corrected: the module header comment, the `addPrivateDependencyMounts` doc comment, the `docs/sandbox.md` preflight paragraph, and the AC-5 wording in this plan. |
| F6: a late preparation-step throw releases only the dependency storage and leaks the SSH tunnel and port-forwarding resources | Defer (#3469) | Not broadened in this patch; the repository's older SSH/proxy lifecycle is untouched. |
| F7: the dependency-storage lifecycle is registered through two parallel paths (its own registrar plus a duplicate wrapper in `wireCleanupHandlers`) | In-scope-Fix | `registerStorageLifecycle` in `sandbox-node-modules.ts` is now the single storage lifecycle owner: process `exit`/`SIGINT`/`SIGTERM` registration, idempotency, and signal termination semantics live there exactly once. `wireCleanupHandlers` only wires the sandbox child's `close` trigger to the same idempotent cleanup; the duplicate wrapper and its re-registration were deleted. All accepted cleanup behavior is retained (launch-failure suites, containers suite, and both real engines green). |
| F8: a launch-lifecycle test comment claims a Linux host passes the credential-bridge check while the platform spy still reports darwin | In-scope-Fix | Comment corrected: networking is unset (the macOS requirement fires only with `network: off`) and the `os.platform` spy still reports darwin, so platform is not what makes that test pass. |
| F9: the new SIGINT/SIGTERM handlers swallowed default signal termination, leaving the process alive with its storage already deleted | Blocker-Fix | `registerStorageLifecycle`'s signal handlers now run the idempotent removal and then restore default termination by re-raising the signal when no other handler owns it. When another lifecycle's handler is registered on the same signal (the repository's older SSH/proxy handlers after launch), that owner decides how the process ends, so the older lifecycle was not refactored. Node and Bun semantics were verified by probe rather than assumed (`signal-probe.log`, bun 1.3.14 and node v25.2.1: after the owning listener removes itself and no other listener remains, `process.kill(process.pid, signal)` terminates with the default disposition, exit 130 for SIGINT; with another listener present the process continues by design). No `process.exit(0)` was used: the process dies from the signal itself, so the terminated state is observable to the parent. The lifecycle test that had enshrined the swallow behavior was replaced with the correct contract. |
| F10: SIGKILL/OOM leaves an abandoned per-run storage subtree that nothing ever reaps | Defer (#3470) | No stale-run reclamation was added. |
| F11: a main-launch throw after `startProxyContainer` succeeds releases the storage but leaks the credential proxy sidecar | Defer (#3469) | Not broadened in this patch. |
| F12: the cache-storage creation failure test relies on chmod and fails spuriously when the runner is root | In-scope-Fix | Rewritten deterministically: the cache root the production code uses is pointed at a path whose parent is a regular file, so `mkdtemp` fails with ENOTDIR identically under root and non-root. Assertions still verify the user-visible `FatalSandboxError` naming the operation and path, and that no run root leaks. |
| F13: the removal-failure warning test relies on chmod and fails spuriously when the runner is root | In-scope-Fix | Rewritten deterministically: the recursive-removal fault is injected at the filesystem boundary (`fs.rmSync` throws EPERM for the run root and delegates to the real implementation otherwise; allowed infrastructure fault injection). Assertions still verify the user-visible stderr warning naming the operation and path, and that cleanup does not throw. No mock-interaction assertions were added. |
| F14: the `prepareCredentialProxyBridge` extraction left an always-undefined `credentialProxyBridgeResult` whose cleanup call is a guaranteed no-op | In-scope-Fix | The dead variable, its no-op `runBestEffortSyncCleanup` call, and the misleading "releasing partial proxy state" JSDoc were removed, along with the vestigial outer `credentialProxyBridgeCleanup` shadow assignment in `prepareContainerSandbox`. Credential-proxy behavior is unchanged; `stopProxy()` remains the real cleanup on that path. |

No deferred finding (F2, F3, F6, F10, F11) was fixed by this remediation, and
both rejected findings (F1, F4) left the tree unchanged.

### OCR RED/GREEN evidence

| Concern | RED | GREEN |
| --- | --- | --- |
| F9: a child terminated by SIGINT/SIGTERM must both remove the private storage and reach a terminated state rather than continuing | `red-f9-signal.log`: both replacement tests fail; the child swallows the signal, runs the marker timer, prints the continuation marker, and exits `status` 4 instead of dying by the signal | `green-f9-f7-focused.log` and `green-all-fixes-focused.log`: children die with `status` null and `signal` SIGINT/SIGTERM in a fraction of the marker-timer window, stdout contains no continuation marker, and the run roots are gone |
| F7: one storage lifecycle owner | The F9 signal tests exercise the single owner; the duplicate wrapper registration is deleted from `wireCleanupHandlers` | `green-f9-f7-focused.log` 105/105 (lifecycle, mounts, preflight, launch-lifecycle, containers) and `green-f7-proxy-structure.log` 26/26 |
| F12/F13: failure-path tests deterministic under root and non-root | `red-root-f12f13.log`: run as uid 0 inside a Linux container, exactly the two chmod-based denial tests fail (26 pass, 2 fail across 28) | `green-f12f13-root.log` 29/29 as uid 0 in the same container (signal tests also pass on a Linux kernel) and `green-f12f13-host.log` 29/29 as uid 501 on the host |
| F5, F8, F14 | No behavioral RED is possible: they are comment/doc corrections and a no-op dead-code removal with no observable behavior delta | `green-all-fixes-focused.log` 131/131 and the full cycle below stay green with the changes in place |

### Root-run evidence environment (F12/F13)

The host cannot run the suites as root, so the two denial tests were executed
as uid 0 inside the locally built `ghcr.io/vybestack/llxprt-code/sandbox:0.11.0`
image, with the repository bind-mounted at its own path and the image's Linux
`@ast-grep/napi` binding bind-mounted over the repository's darwin-only slot
(`tmp/issue3450/ocr-remediation/linux-natives/`). The fixture and cache
directories live on the container's own Linux `/tmp`, where mode bits are
enforced, so the pre-fix run fails exactly the way a root CI runner would and
the post-fix run proves both tests are privilege-independent.

### OCR remediation verification cycle

Focused, before the final full cycle: six issue-focused files 131/131
(`green-all-fixes-focused.log`), re-run 131/131 after `npm run format`
reformatted one test file (`green-post-format-focused.log`); real Docker
suites 14/14 including both image-global agent suites
(`green-integration-docker.log`); real Podman 7 pass / 0 fail with the
image-global agent suites engaged (`green-integration-podman.log`; the 11
skips are the docker suites, the same skip pattern as the pre-remediation
baseline); root-container rerun 29/29 (`green-f12f13-root.log`).

Final full cycle on the final tree (after the last comment-only edits), all
logs prefixed `verify-final-` under `tmp/issue3450/ocr-remediation/`:

- `npm run format`: exit 0, change set stable afterward
- `npm run test`: exit 0, zero failures
- `npm run lint`: exit 0
- `npm run typecheck`: exit 0
- `npm run build`: exit 0
- focused six-file rerun after format: 131/131 (`verify-final-focused.log`)
- smoke `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and
  nothing else"`: exit 0, haiku returned (`verify-final-smoke.log`)
- test audit (`bun scripts/test-audit/scan.ts`): zero findings on every
  touched test file; repository totals unchanged from the pre-remediation
  scan (`test-audit-final2/`, `test-audit-final2.log`)

### OCR findings-only follow-up

The second local OCR round was limited to the original findings and regressions.
OCR used provider `zai-anthropic`, model `glm-5.2`, and exited 0 after reviewing
8 files. Artifacts are preserved at `tmp/issue3450/ocr/review2.json` and
`tmp/issue3450/ocr/review2.stderr`.

The follow-up verified that all original accepted findings, F5, F7, F8, F9,
F12, F13, and F14, are resolved. No original Blocker-Fix or In-scope-Fix
remains.

| Follow-up suggestion | Class | Disposition |
| --- | --- | --- |
| Make `wireCleanupHandlers` parameter `dependencyStorageCleanup` required | Reject | This is speculative future-caller hardening. The optional value represents legitimate no-storage cases, and current production passes it. It is neither an original finding nor a regression. |
| Change the unused `execSync` mock buffer newline | Reject | This is a test-only realism cleanup unrelated to the tested spawn-based image probe. It is neither an original finding nor a regression. |

Both local OCR rounds are exhausted.

## CodeRabbit remediation (PR #3471)

CodeRabbit's review of PR #3471 left two actionable inline threads on
`integration-tests/sandboxNodeModulesIsolation.real.test.ts`, one pre-merge
docstring-coverage warning, and one merge-conflict suggestion. Each finding
was verified against current source before triage; no claim was accepted
unverified. Every log for this pass lives under
`tmp/issue3450/coderabbit-remediation/`. No production code changed.

### Finding triage and dispositions

| Finding | Class | Disposition |
| --- | --- | --- |
| CR1: the live-source race timeout timer is never cleared, so a `close` win leaves a pending 180 s `SESSION_TIMEOUT_MS` timer that keeps the event loop alive after the test | In-scope-Fix | Verified in source: the `timedOut` executor discarded the `setTimeout` handle and the `finally` cleared only `writeHostEdit`, so every normal (child-closes-first) outcome leaked the timer. Fixed by declaring `raceTimer: ReturnType<typeof setTimeout> \| undefined`, assigning it inside the executor, and clearing it in the existing `finally` block, so every outcome (close win, timeout win, error, synchronous throw) clears both timers. Test-harness code only; no implementation-detail test added solely to test a test. |
| CR2: `describeEngine` probes `imageGlobalCliBoots` at collection time even when `ENGINES` excludes the engine, which can invoke an unintended registry image pull | In-scope-Fix | Verified in source: the probe ran `engine run --rm <image> sh -c 'timeout 60 llxprt --version'` unconditionally, while `detectEngines` excludes an engine exactly when the image is absent locally (or another runtime is selected) — so a usable daemon with a missing image pulls from ghcr.io and blocks collection for up to 90 s per excluded engine. Fixed by short-circuiting: `ENGINES.includes(engine) && imageGlobalCliBoots(engine, IMAGE)`; the skip outcome for excluded engines is unchanged (still skips), now without the container side effect. |
| Docstring coverage 38.55% vs the 80% external threshold (83 functions across 8 files) | Reject | Adding comments to satisfy an external percentage is not accepted behavior and conflicts with this repository's sparse-comment rule (comments explain non-obvious why, never satisfy metrics). No docstrings were added. |
| CodeRabbit "Resolve merge conflicts in branch `issue3450`" suggestion | Reject precondition not met — conflict is real; resolution is outside this remediation's scope | The Reject condition (origin/main an ancestor of the branch AND GitHub mergeability successful) fails both legs: `git merge-base --is-ancestor origin/main HEAD` exits nonzero (origin/main advanced `393a0080f` → `c1e0d1de1`, adding #3460 and #3461), and `gh pr view 3471` reports `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`, with both-side changes in `packages/cli/src/utils/sandbox-containers.ts` and `packages/cli/src/utils/sandbox-exec.ts`. Resolving requires merging origin/main into production files and a commit/push, which this remediation is explicitly barred from (no commit, no push, two-file scope). The conflict must be resolved at the PR merge step after this remediation lands. |

### Remediation verification

The harness fixes were exercised by re-running the suites they gate rather
than by new implementation-detail tests. All logs are under
`tmp/issue3450/coderabbit-remediation/`.

- Issue-focused six-file Bun suite: 131 pass / 0 fail
  (`focused-unit.log`); identical 131/131 after `npm run format`
  (`post-format-focused.log`; format left the diff byte-identical).
- Real Docker, docker selected: 7 pass / 0 fail / 11 skip, image-global
  agent suites engaged (`integration-docker.log`); the 11 skips are the
  podman suites, which now skip without the CR2-fixed collection-time
  podman probe. Same 7/0 after format
  (`post-format-integration-docker.log`).
- Real Podman, podman selected: 7 pass / 0 fail / 11 skip, image-global
  agent suites engaged (`integration-podman.log`; docker suites skip
  without a docker probe). Same 7/0 after format
  (`post-format-integration-podman.log`).
- `npm run test`: exit 0, zero failures across all result lines
  (`verify-npm-test.log`).
- `npm run lint`: exit 0 (`verify-lint.log`).
- `npm run typecheck`: exit 0 (`verify-typecheck.log`).
- `npm run format`: exit 0, change set unchanged (`verify-format.log`).
- `npm run build`: exit 0 (`verify-build.log`).
- Smoke `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku
  and nothing else"`: exit 0, haiku returned (`verify-smoke.log`).

Both pre-remediation engine baselines (7 pass / 0 fail per engine, agent
suites engaged) are preserved exactly. No commit or push was made.

## PR-CI diagnostics remediation (PR #3471)

Linux Docker CI run 33505381047, job 99848206646, reported six container
launches that exited nonzero without preserving their stdout or stderr. The raw
UID/mode semantics test passed in the same job. Nested-bind ordering was
investigated and disproven as the cause, so no speculative production change,
`mkdir`, or mount logic was added.

Capturing status, stdout, and stderr for those six native Linux launches is an
**In-scope-Fix**. The change is diagnostics-only and supplies the evidence
needed to diagnose the Linux failures without changing sandbox behavior.

### PR OCR triage

| Suggestion | Class | Disposition |
| --- | --- | --- |
| Remove or change `runRootsBeforeCleanup` | Reject | The assertion behaviorally proves private storage exists during the session and is removed afterward. |
| Guard teardown when `savedStorageEnv` was not assigned | In-scope-Fix | Both engine suites now skip environment restoration when setup failed before the snapshot, preserving the setup exception while still removing any temporary home that was created. |
| Replace `existsSync` plus `realpathSync` and add ELOOP/EACCES handling | Defer | Malformed or cyclic workspace realpath hardening was already explicitly deferred. The proposed fallback would weaken containment. |
| Make `dependencyStorageCleanup` required | Reject | Already classified in the second local OCR: no-storage callers are valid and the proposed type change does not address accepted behavior. |
| Increase external docstring coverage | Reject | The coverage warning does not identify missing behavior and does not justify metric-driven comments. |

No public abstraction, dependency, workflow, or setting was added.
