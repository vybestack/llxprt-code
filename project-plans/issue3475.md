# Issue #3475: Sandbox workspace path resolution can race concurrent filesystem changes

Issue: <https://github.com/vybestack/llxprt-code/issues/3475>

## Scope

Sandbox launch preparation resolves several paths to their real filesystem
identity before any engine or seatbelt process starts. Today those
canonicalizations call `fs.realpathSync` (or `fs.existsSync` followed by
`fs.realpathSync`) directly, so a path that another process removes, replaces,
or turns into a symlink cycle between discovery and resolution escapes as an
unclassified filesystem error (`ENOENT`, `ELOOP`, `EINVAL`, or a raw
`TypeError`), and the seatbelt Storage-root resolver answers the same failures
with a lexical `path.resolve` fallback that hands unresolved lexical paths to the
seatbelt profile.

This issue converts every audited sandbox canonicalization site to one small
fail-fast helper that:

1. canonicalizes with `realpath` exactly as before (containment semantics are
   unchanged; no lexical fallback is introduced anywhere);
2. converts concurrent removal/replacement, symlink cycles, and malformed
   paths into `FatalSandboxError` messages naming the affected path and the
   sandbox operation being performed; and
3. exposes a bounded filesystem seam (exactly `existsSync` and `realpathSync`)
   so the discovery-then-resolution race is exercised deterministically in
   tests.

The nearest-existing-ancestor resolver keeps its accepted #3450 behavior: the
nearest existing ancestor is resolved to its real path and the not-yet-existing tail is
appended lexically onto that real-path ancestor, preserving support for
missing contained destinations without weakening containment.

Out of scope: glob workspace expansion (#3468), `NODE_ENV=development`
(#3455), abandoned storage after uncatchable termination (#3470), and general
SSH/port-forward/proxy launch cleanup (#3469).

## Audit of sandbox path canonicalization sites

Every `realpath`/existence-check site in the code touched by #3450 and the
related container/seatbelt launch path:

| Site | Category | Before | After |
| --- | --- | --- | --- |
| `sandbox-node-modules.ts` `planPrivateDependencyMounts` workspace `realpathSync(workdir)` | workspace | raw throw on race/cycle/malformed | classified, names path + `resolve the sandbox workspace root` |
| `sandbox-node-modules.ts` `resolveProtectedNodeModulesDestinations` workspace `realpathSync(workdir)` | workspace | raw throw | classified (same operation) |
| `sandbox-node-modules.ts` `resolveNearestExistingPath` (used by `acceptDestination` and `isContainedTarget`) | workspace / dependency destination | `existsSync` then `realpathSync` with no handling: the race throws raw; symlink escapes still rejected by the existing containment checks | helper's nearest-existing canonicalization; race throws classified naming the discovered path + operation; escape/cycle/malformed behavior preserved |
| `sandbox-exec.ts` `realpathSync(process.argv[1])` | executable | raw throw | classified + `resolve the sandbox executable` |
| `sandbox-exec.ts` `realpathSync(os.tmpdir())` | tmpdir | raw throw | classified + `resolve the sandbox temporary directory` |
| `sandbox-seatbelt.ts` `TARGET_DIR` (`realpathSync(process.cwd())`) | workspace | raw throw | classified + `resolve the sandbox workspace` |
| `sandbox-seatbelt.ts` `TMP_DIR` (`realpathSync(os.tmpdir())`) | tmpdir | raw throw | classified + `resolve the sandbox temporary directory` |
| `sandbox-seatbelt.ts` `HOME_DIR` (`realpathSync(os.homedir())`) | workspace-adjacent home root | raw throw | classified + `resolve the sandbox home directory` |
| `sandbox-seatbelt.ts` `targetDir` (`realpathSync(getTargetDir())`) | workspace | raw throw | classified + `resolve the sandbox target directory` |
| `sandbox-seatbelt.ts` include directories (`realpathSync(dir)`) | include-directory | raw throw | classified + `resolve a sandbox include directory` |
| `sandbox-seatbelt.ts` `resolveRealpathSync` (Storage config/data/cache/log roots) | real-path root params | lexical `path.resolve` fallback after failed create | create-if-missing (0o700) is preserved; resolution failure is classified naming path + root role; no lexical fallback |
| `sandbox-containers.ts` `addCustomMounts` (`existsSync(from)`) | mount-source | missing path classified; raced removal/replacement/cycle falls through to an engine-side error | single fail-fast real-path validation; absent, raced, cyclic, or malformed sources are classified naming path + mount environment variable |
| `sandbox-capability.ts` `assertCapabilityOutsideMounts` runtime root | mount-source-adjacent runtime root | `ENOENT` classified, every other failure raw | `ENOENT` keeps its specific actionable message; other failures classified naming path + operation |
| `sandbox-capability.ts` `assertCapabilityOutsideMounts` mount sources | mount-source | `ENOENT` skipped (a removed source can no longer collide), other failures raw | same intentional `ENOENT` skip, other failures classified naming path + operation |

Sites audited and deliberately unchanged:

- `sandbox-env.ts` `mountGitConfigFiles`: per-file existence filter where
  absence is a normal, intentional skip (only existing host files are mounted);
  there is no canonicalization to classify.
- `sandbox-containers.ts` virtualenv mount: the source is created by the same
  launch flow (`mkdirSync`) immediately before mounting.
- `sandbox-exec.ts` session tmpdir bind: the source is `mkdtempSync` output of
  the already-canonicalized tmpdir in the same flow.
- `sandbox-containers.ts` workspace bind (`--volume ${workdir}:...`): the
  lexical workdir is passed to the engine by design (engines resolve the
  source themselves); its real-path containment is established in the planner
  via the workspace-root site above.
- `sandbox-node-modules.ts` `assertDestinationChainIsDirectories`: per-segment
  `statSync` walk whose missing-component return is the accepted
  create-at-launch behavior; it is not a canonicalization site.

## Design

New package-internal module
`packages/cli/src/utils/sandbox-path-canonicalization.ts`:

```text
canonicalizeExistingPath(targetPath, operation, filesystem?)
    realpathSync(targetPath); any failure -> FatalSandboxError
    naming targetPath, operation, and the underlying filesystem cause
    (cause also recorded on error.cause for errno inspection by callers).

canonicalizeNearestExistingPath(candidate, operation, filesystem?)
    Walk up until existsSync(current); canonicalize that ancestor with
    canonicalizeExistingPath; append the collected tail. A path discovered
    to exist whose real-path resolution then fails is fatal, never a
    lexical fallback.

SandboxPathFilesystem  bounded seam: existsSync + realpathSync only.
hasFilesystemErrorCode(error, code)  errno check across error and its cause.
```

Error message shape (names the sandbox operation, the path, and the
filesystem failure):

`Failed to <operation>: real path resolution of '<path>' failed
(<cause>). Another process may have removed or replaced the path while the
sandbox was preparing, or the path may be malformed or a symlink cycle.
Verify the path and retry.`

## Test-first plan

RED (failing against the current tree, before any production change):

1. `planPrivateDependencyMounts` on a workdir that is a symlink cycle throws
   `FatalSandboxError` naming the workdir and workspace-root operation
   (today: raw `ELOOP` `Error`).
2. `addContainerVolumeMounts` with an absent source names the source, the
   mount environment variable, and the filesystem cause (today: message has
   no cause/operation detail); a cyclic-symlink source is rejected with the
   cycle cause (today: generic "Missing mount path").
3. `buildSeatbeltArgs` with an include directory that is a symlink cycle
   throws `FatalSandboxError` naming the directory and include-directory
   operation (today: raw `ELOOP` `Error`).
4. `buildSeatbeltArgs` with a Storage root that is a symlink cycle fails
   fast instead of silently falling back to the lexical path (today: no
   throw at all).

GREEN:

5. Add the helper module with the bounded seam and cause-aware errors.
6. Rewire every audited site per the table above; containment checks and
   accepted behaviors (missing destinations, contained symlinks, escape
   rejection) unchanged.
7. Deterministic race coverage through the seam: discovery sees the path,
   resolution throws `ENOENT`/`ELOOP`, at the helper level for both
   functions and through `resolveProtectedNodeModulesDestinations` for the
   workspace-root and protected-destination operations. Real-filesystem
   equivalents (cycles, malformed NUL paths, absent sources) cover the
   remaining sites deterministically.
8. Re-run the existing #3450 destination/containment suites unchanged to
   prove escapes and malformed declarations stay rejected.

No new dependencies, package scripts, settings, schemas, or public
abstractions; no sleeps, retries, suppressions, or lexical fallbacks.

## TDD evidence

RED (before any production change; each failure is the intended
missing-behavior failure, not an accident):

| Case | Before |
| --- | --- |
| cyclic workdir through `planPrivateDependencyMounts` | raw `ELOOP` `Error`, no path/operation classification (`tmp/issue3475/red/planner-cycle.log`, 1 fail / 22 pass) |
| absent custom mount source | `Missing mount path` without filesystem cause or canonicalization semantics (`tmp/issue3475/red/mount-source.log`, 2 fails) |
| cyclic custom mount source | same generic missing-path message; no cycle detection (`tmp/issue3475/red/mount-source.log`) |
| cyclic seatbelt include directory | raw `ELOOP` `Error` (`tmp/issue3475/red/seatbelt-cycle.log`, 2 fails) |
| cyclic seatbelt Storage root | no error at all: silent lexical `path.resolve` fallback (`tmp/issue3475/red/seatbelt-cycle.log`) |

GREEN (after the helper and site rewiring):

- `tmp/issue3475/green/planner-cycle.log`: 23/23.
- `tmp/issue3475/green/mount-source.log`: 44/44.
- `tmp/issue3475/green/seatbelt-cycle.log`: 49/49 at the time (two #3475
  cases later extracted, see below).
- `tmp/issue3475/green/helper-seam.log`: 10/10 helper-level deterministic
  race, cycle, malformed-path, and cause-exposure tests.
- `tmp/issue3475/green/planner-seam-races.log`: 26/26 including three
  seam-injected races through `resolveProtectedNodeModulesDestinations`
  (workspace root removed; root `node_modules` removed; declared root
  replaced by a cycle between discovery and resolution).
- `tmp/issue3475/green/final-consolidated.log`: all touched suites after
  formatting: 261 tests, 0 failures across 13 files.

The seatbelt #3475 cases were extracted into
`sandbox-seatbelt-canonicalization.test.ts` after the owning suite reached
the repo's `max-lines` boundary (same precedent as #3479's extraction); a
third case (cyclic target directory) was added there.

The existing #3450 containment and escape suites
(`sandbox-node-modules-preflight`, `sandbox-node-modules-lifecycle`,
`sandbox-dependency-volumes`, `sandbox-launch-lifecycle`) pass unchanged:
symlink escapes, malformed declarations, missing contained destinations, and
contained-symlink deduplication behave exactly as before.

## Verification

- Focused suites: see GREEN above; `tmp/issue3475/verify/related-suites.log`.
- CLI typecheck: `tmp/issue3475/verify/typecheck-cli.log` (clean; workspace
  `dist` outputs built first; the initial TS6305 errors were pre-existing
  worktree state, unrelated to this change).
- Targeted ESLint on every touched file: clean.
- Full repo lint: `tmp/issue3475/verify/lint-full.log`.
- Test-audit scan: `tmp/scan-main` (HEAD baseline via stash round-trip) vs
  `tmp/scan-branch`; `findings.tsv` byte-identical, so no new false-green
  findings on touched test files.
- Prettier: every touched file formatted.

## Final resume verification

Re-verified from the resumed worktree (`tmp/issue3475/resume/`):

- Every touched and related suite, each in its own bun invocation
  (`final-isolated.log`): 236 pass / 0 fail across 11 files:
  path-canonicalization 10, seatbelt-canonicalization 3, node-modules 26,
  containers 44, proxy-integration 26, capability 29, seatbelt 47,
  node-modules-preflight 32, node-modules-lifecycle 5,
  dependency-volumes 10, launch-lifecycle 4.
- Targeted ESLint on all 11 touched files: clean (`eslint-touched.log`).
- Prettier `--check` on all touched files plus this plan: clean.
- CLI package typecheck: exit 0.
- Audit grep: no `realpathSync` call remains outside the helper module;
  the surviving `existsSync` sites are the audited intentional ones
  (profile/custom-Dockerfile/venv existence filters and the seatbelt
  create-if-missing gate).

One finding, pre-existing and out of scope: batching
`sandbox-launch-lifecycle.test.ts` with `sandbox-seatbelt.test.ts` into a
single bun process fails 13 seatbelt tests (the #1456 network-policy table
and the #1954 AC11 case) because the launch-lifecycle suite leaves shared
state that aborts seatbelt launch preparation before the stub spawns. A
stash round-trip reproduced the identical 13 failures on the branch HEAD
without these changes, and each file passes alone. Logged as #3505 rather
than fixed here.
