# Issue #3455: NODE_ENV=development makes sandbox run llxprt source paths in unrelated repositories

Plan ID: `PLAN-20260901-ISSUE3455`

Issue: <https://github.com/vybestack/llxprt-code/issues/3455>

Base: branch `issue3450-3455` at `fa2acb860` (`fix(sandbox): move private
dependencies to engine volumes`), which already contains the #3450
engine-owned dependency volumes and #3479.

## Scope

`resolveCliCommand()` in `packages/cli/src/utils/sandbox-entrypoint.ts`
selected `bun ./packages/cli/index.ts` whenever the parent environment held
`NODE_ENV=development`, without checking that the sandboxed workspace is an
llxprt-code source checkout. A user with `NODE_ENV=development` exported in
their shell running `llxprt --sandbox` in an arbitrary repository received a
module/path failure, because that repository has no `packages/cli/index.ts`.
Symmetrically, `planPrivateDependencyMounts()` in
`packages/cli/src/utils/sandbox-node-modules.ts` disabled the #3450 private
dependency volumes on the same bare `NODE_ENV` check, so the same arbitrary
repository also silently bypassed dependency isolation.

### Acceptance criteria

1. `NODE_ENV=development` in an arbitrary repository does not select
   `bun ./packages/cli/index.ts`.
2. A supported llxprt-code source-development launch still selects the
   checked-out source command.
3. One shared source-development predicate drives both the entrypoint
   command selection and the dependency-isolation behavior.
4. Behavioral tests cover arbitrary-repository and llxprt-source workspaces.

## Design

One predicate, `isSourceDevelopmentWorkdir(workdir)` in
`packages/cli/src/utils/sandbox-env.ts`, answers whether this launch is a
source-development launch. It requires BOTH:

- `NODE_ENV === 'development'`, and
- positive identification of an llxprt-code source checkout: the workspace
  contains `packages/cli/index.ts` as a regular file. That file is exactly
  what the source command execs, so its presence is the minimal positive
  signal that the checked-out source command can boot, and its absence is
  the observed failure mode.

Both call sites now use this single predicate:

- `resolveCliCommand(workdir)` (entrypoint command selection): only a
  positively identified checkout under development runs the source command;
  everything else, including arbitrary repositories with ambient
  `NODE_ENV=development`, falls through to the sandbox image's installed
  `llxprt` (debug variants unchanged).
- `planPrivateDependencyMounts(workdir)` (#3450 dependency isolation): only
  a positively identified checkout keeps the legacy shared workspace bind
  (`{ enabled: false }`), preserving the source checkout's ability to boot
  against its own dependencies. An arbitrary repository can no longer
  bypass the private volumes through an ambient `NODE_ENV`.

No new broad public API: the predicate is a single exported function in the
existing sandbox-env module both consumers already import.

## TDD steps

1. **RED: command selection.** New
   `packages/cli/src/utils/sandbox-source-development.test.ts` executes the
   REAL generated entrypoint script inside seeded repositories with
   PATH-recorded `llxprt`/`bun` stand-ins and asserts which command the
   final exec runs, across NODE_ENV combinations (`development`,
   `production`, `test`, unset), for arbitrary repositories, real source
   checkouts, and a directory masquerading as `packages/cli/index.ts`.
2. **RED: shared predicate isolation.** The same file drives the REAL
   `addPrivateDependencyMounts` against the PATH-installed fake container
   engine for docker and podman argv behavior: an arbitrary repository under
   `NODE_ENV=development` must receive the private volume mounts (mounted
   argv plus engine-created volumes), while a real source checkout under
   `NODE_ENV=development` keeps the bare workspace bind with zero engine
   calls.
3. **Fixture correction.** The existing #3450 test
   `keeps development-mode launches unchanged` in
   `sandbox-node-modules.test.ts` seeded only `NODE_ENV=development`; under
   the corrected specification its fixture must be a real source checkout,
   so it now also writes `packages/cli/index.ts` and is renamed to
   `keeps source-development launches unchanged`.
4. **GREEN: shared predicate.** Add `isSourceDevelopmentWorkdir` to
   `sandbox-env.ts` and replace both bare `NODE_ENV` checks.

## RED/GREEN evidence

RED run (before implementation, worktree
`tmp/worktrees/issue3455`, log `tmp/verify3455/red.log`):

```text
(fail) #3455 entrypoint command selection > arbitrary repository with NODE_ENV=development execs the image-installed llxprt
(pass) #3455 entrypoint command selection > arbitrary repository with NODE_ENV=production execs the image-installed llxprt
(pass) #3455 entrypoint command selection > arbitrary repository with NODE_ENV=test execs the image-installed llxprt
(pass) #3455 entrypoint command selection > arbitrary repository with NODE_ENV=undefined execs the image-installed llxprt
(pass) #3455 entrypoint command selection > source checkout with NODE_ENV=development execs the checked-out source command
(pass) #3455 entrypoint command selection > source checkout with NODE_ENV=production execs the image-installed llxprt
(pass) #3455 entrypoint command selection > source checkout with NODE_ENV=test execs the image-installed llxprt
(pass) #3455 entrypoint command selection > source checkout with NODE_ENV=undefined execs the image-installed llxprt
(fail) #3455 entrypoint command selection > a directory named packages/cli/index.ts is not a source checkout
(fail) #3455 shared predicate drives private dependency isolation > arbitrary repository with NODE_ENV=development cannot bypass private dependency volumes (docker)
(fail) #3455 shared predicate drives private dependency isolation > arbitrary repository with NODE_ENV=development cannot bypass private dependency volumes (podman)
(pass) #3455 shared predicate drives private dependency isolation > arbitrary repository without development NODE_ENV still gets private dependency volumes
(pass) #3455 shared predicate drives private dependency isolation > source checkout with NODE_ENV=development keeps the shared workspace bind
(pass) #3455 shared predicate drives private dependency isolation > source checkout with NODE_ENV=production still gets private dependency volumes
(pass) #3455 shared predicate drives private dependency isolation > source checkout with NODE_ENV=undefined still gets private dependency volumes
11 pass / 4 fail
```

The four failures are exactly the reported bug: the arbitrary-repository
development case selected `bun ./packages/cli/index.ts` (recorded shim
invocation `{ command: "bun", args: ["./packages/cli/index.ts"] }` instead
of `{ command: "llxprt", args: [] }`), the directory-masquerade was accepted
as a checkout, and the arbitrary-repository development case disabled
private dependency isolation under both engines.

GREEN run (after implementation, log `tmp/verify3455/green-focused.log`):

```text
142 pass / 0 fail (437 expect() calls across 7 files):
  sandbox-source-development.test.ts (new, 15 tests)
  sandbox-node-modules.test.ts       (21 tests, incl. corrected fixture)
  sandbox-entrypoint.test.ts         (18 tests, unchanged behavior)
  sandbox-node-modules-lifecycle.test.ts
  sandbox-node-modules-preflight.test.ts
  sandbox-dependency-volumes.test.ts
  sandbox-containers.test.ts
```

## Verification summary

- Focused Bun suites: 142 pass / 0 fail (`tmp/verify3455/green-focused.log`).
- Targeted ESLint on the five changed/new files: clean (one initial
  `no-unnecessary-condition` finding in the new test fixed before commit).
- Prettier check on the five changed/new files: clean.
- `tsc --noEmit` for `packages/cli`: clean (after `tsc --build` of project
  references; the fresh worktree had no sibling `dist` outputs, which is a
  worktree artifact, not a code error).
- Test audit (`bun scripts/test-audit/scan.ts`): zero findings for the new
  test file.
- `git diff --check`: clean.
- Pre-existing environmental note: `sandbox-orphan-reaping.bun.test.ts`
  fails in this worktree on the UNMODIFIED base too (15/23) because the
  worktree's `node_modules` is a symlink to the parent checkout, which the
  #3450 destination resolution deliberately rejects. Verified via
  `git stash` + rerun; unrelated to this change.

No `.llxprt` files were modified. No broad public API was introduced.
