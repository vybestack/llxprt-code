# Issue #3462: Sandbox Python venv state is written inside the project `.llxprt` directory

## Problem

`packages/cli/src/utils/sandbox-containers.ts` resolves the private backing
directory for an in-workspace `VIRTUAL_ENV` with:

```text
path.resolve(SETTINGS_DIRECTORY_NAME, 'sandbox.venv')
```

`path.resolve` resolves against `process.cwd()`, so sandbox-managed Python
environment state is written under `<repo>/.llxprt/sandbox.venv`. Generated,
platform-specific dependency state then mixes into the version-controlled
LLxprt project configuration directory, and different worktrees of the same
repository share one venv (the path does not depend on which worktree is
mounted). The directory is also `mkdirSync`-created eagerly on every launch
that has an in-workspace `VIRTUAL_ENV`.

Found while analyzing language-independent workspace artifact isolation for
#3450.

## Accepted behavior

AC1. An in-workspace `VIRTUAL_ENV` is backed by a sandbox-private directory
outside the repository.
AC2. Different worktrees do not share the private environment accidentally.
AC3. Docker and Podman receive a writable mount with the same in-container
destination as before.
AC4. Starting the sandbox does not create or modify
`<repo>/.llxprt/sandbox.venv`.
AC5. Behavioral coverage proves the host repository remains unchanged.

## Design: extend the #3450 engine-owned storage lifecycle

#3450 replaced host-backed private binds for `node_modules` with per-run
engine-owned named volumes precisely because host-backed backing stores cannot
be host-cleaned after an arbitrary container UID installs 0755/0644 descendants
into them (a foreign UID's content cannot be unlinked by the host user). The
venv has the same write pattern (the container user runs `pip install`, creating
deep trees owned by the selected container UID) and the same cleanup problem,
so the venv reuses the #3450 lifecycle rather than inventing another host
directory that would reintroduce the exact defect #3450 fixed.

Concretely, the venv destination becomes an additional protected destination in
the #3450 dependency plan:

- `planPrivateDependencyMounts(workdir)` learns the in-workspace `VIRTUAL_ENV`
  destination (from `process.env.VIRTUAL_ENV`, gated as before: set,
  non-empty, case-insensitively under `workdir`). When gated in, the venv path
  is one more planned destination and gets its own per-run engine volume,
  created/labeled/initialized by the same one init container run and released
  by the same `DependencyVolumeLifecycle`.
- `addContainerEnvVars` keeps emitting `--env VIRTUAL_ENV=<container path>`
  (same in-container destination as before, AC3) but no longer creates or
  binds `<repo>/.llxprt/sandbox.venv` at all. The `--volume` host bind for the
  venv is gone: the engine volume mount (appended by
  `addPrivateDependencyMounts` after the workspace bind, so the nested mount
  wins) is the writable backing.
- The wrong-platform preflight does not walk the venv tree: the host venv is
  no longer mounted, so host content cannot leak into the container. (The
  preflight exists to explain empty-mount breakage of mounted host trees; a
  shadowed venv has no such promise. Python bytecode is
  platform-independent at the header level and venv binaries are
  interpreter-launched scripts; nothing recognizable is served to the
  container.)
- Dev mode (`NODE_ENV=development`) keeps the existing #3455 exclusion: the
  whole plan (including the venv volume) is disabled and the legacy single
  workspace bind covers the venv directory, as it does for `node_modules`.

### Cleanup / persistence semantics (explicit)

- The venv volume is per-run and ephemeral: it is created before the launch
  and removed when the run releases the lifecycle (main container close,
  abort path, or termination signal), exactly like the node_modules volumes.
  Python deps installed in the sandbox are not persisted across runs. This
  matches the sandbox's existing "fresh workspace dependencies per run"
  contract established by #3450 for `node_modules` and is the honest semantic:
  the venv's host tree was never a real cache (it was clobbered by whatever
  host uid got there first).
- Removal is engine-owned: the engine deletes the volume content regardless
  of which container UID wrote it, so no host-backed foreign-UID cleanup
  defect is introduced.
- If the venv destination did not exist on the host before the launch, the
  engine materializes an empty mountpoint through the workspace bind;
  release removes it again when it is still empty (the existing
  `originallyAbsentDestinations` logic, now covering the venv path too).

## Test plan (test-first)

Unit (bun:test, fake engine via `useFakeEngine`, workspace fixtures under
`os.tmpdir()`):

1. `sandbox-containers.test.ts` (VIRTUAL_ENV block):
   - an in-workspace `VIRTUAL_ENV` no longer creates
     `<workdir>/.llxprt/sandbox.venv` and no longer emits a `--volume` host
     bind for it; it still emits `--env VIRTUAL_ENV=<getContainerPath(venv)>`;
   - an out-of-workspace or unset/empty `VIRTUAL_ENV` emits neither mount nor
     env.
2. `sandbox-node-modules.test.ts` / a new `sandbox-venv.test.ts` (planning):
   - the plan includes the venv destination when `VIRTUAL_ENV` is in-workspace;
   - two distinct worktree roots produce distinct venv destinations (the
     destination derives from each worktree's own path, so per-worktree
     engine volumes cannot collide, AC2);
   - dev mode and out-of-workspace `VIRTUAL_ENV` are excluded;
   - the engine volume for the venv destination is created, labeled, mounted
     after the workspace bind at `getContainerPath(virtualEnv)`, and released
     with the rest of the run (idempotency preserved).
3. Real-engine behavior (`integration-tests/sandboxVenvIsolation.real.test.ts`,
   following `sandboxNodeModulesIsolation.real.test.ts` gating):
   - inside the container, `VIRTUAL_ENV` points at the mounted destination,
     `python3 -m venv "$VIRTUAL_ENV"` (and a pip-less smoke use of the venv
     python) succeeds with a non-root selected UID, so the mount is writable
     (AC3, arbitrary UIDs);
   - the host venv tree is byte-for-byte unchanged after the run, and
     `<workdir>/.llxprt` contains no `sandbox.venv` (AC4, AC5);
   - volumes are removed after release for both docker and rootless podman.

## Verification

All logs referenced below live in `tmp/issue3462/` in this worktree.

### RED (pre-fix production code, post-fix tests)

- `docker-red.log`: the real-engine suite against the stashed (pre-fix)
  production code: all three docker tests fail with
  `Expected length: 2, Received length: 1` (no second, venv, volume in the
  plan) plus the missing `VIRTUAL_ENV` mount destination.
- `unit-red.log`: the focused unit suites against the stashed production
  code: 7 fail / 50 pass; every failure is a #3462 venv test or the #3462
  `addContainerEnvVars` test.

### GREEN (final code)

- `unit-green.log`: focused suites (97 pass / 0 fail):
  `sandbox-venv.test.ts`, `sandbox-containers.test.ts`,
  `sandbox-node-modules.test.ts`, `sandbox-dependency-volumes.test.ts`,
  `sandbox-node-modules-lifecycle.test.ts`, `sandbox-launch-lifecycle.test.ts`.
- `docker-green-final.log`: real Docker, 3 pass / 0 fail
  (default session, uid 54321:54321 session, absent-destination session).
- `podman-green-final.log`: real rootless Podman, 3 pass / 0 fail.
- `3450-regression-docker.log` and `3450-regression-podman.log`: the #3450
  real-engine suites still pass with the venv destination added to the plan:
  6 pass / 0 fail each.

### Quality/audit

- `bunx eslint` on all touched files: 0 errors (two initial findings, a
  `jest/no-conditional-expect` in the abort-path test and an unused import,
  fixed; the abort test now uses the repo's `capturedError` pattern).
- `bunx prettier --write` / `--check` on all touched files: clean.
- `tsc --noEmit` in `packages/cli` (after building sibling workspaces):
  clean. `integration-tests/` has no per-file tsconfig; its files run only
  through bun.
- `bun scripts/test-audit/scan.ts` (findings re-checked after fixes): zero
  findings on the touched test files. Three initial flags were addressed:
  two `DUP_ASSERT` (identical repeated assertions collapsed into one
  combined assertion) and one `SELF_CONFIRMING` (`snapshotRepo` result was
  asserted directly; now a named `assertRepoUnchanged` helper carries the
  comparison, and the audit scan no longer flags it).
- `git diff --check`: clean; `bun scripts/check-copyright-year.ts`: passed.
- The `packages/cli` bun runner discovers tests structurally (no manifest),
  so `sandbox-venv.test.ts` and the new integration file are picked up
  automatically; no shard registration exists to update. Full-workspace
  `bun run-bun-tests.ts` was not used as evidence: it runs all 726 CLI files
  and was contending with sibling sessions' full `npm run test` runs on this
  box. The focused suites above plus the #3450 regression suites cover every
  file this issue touched.