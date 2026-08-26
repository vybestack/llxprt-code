# Plan: #3334: build_sandbox.ts glob rmSync leaves stale tarballs

Branch `issue3334`. Issue: `scripts/build_sandbox.ts` clears the previous
tarball before each `npm pack` with `rmSync(join(pkgDir, 'dist', '<prefix>-*.tgz'), { force: true })`.
`node:fs` does no glob expansion: the wildcard is looked up as a literal
filename, matches nothing, and `force: true` swallows the ENOENT. The cleanup
is a silent no-op.

## Root cause and impact

Twelve call sites, one per packed workspace (tools, storage, auth, settings,
telemetry, ide-integration, policy, mcp, core, providers, agents, cli).

Within one version `npm pack` overwrites the same version-stamped filename, so
nothing looks wrong. Across a version bump the old tarball stays in
`packages/<pkg>/dist/`; the Dockerfile copies by glob
(`COPY --chown=node:node packages/core/dist/vybestack-llxprt-code-core-*.tgz /tmp/`),
so both versions land in `/tmp` and are handed to the single `npm install -g`
transaction, the winner is left to npm's resolution instead of being
determined by the build. `git clean` or a fresh clone hides it.

Note: the issue's Origin section mentions `packages/zed-acp` as the twelfth
site (from #3332). zed-acp does not exist on current main; the twelve sites
present are the ones listed above. The fix covers the sites that exist.

## Acceptance criteria

1. **AC1, cleanup actually deletes.** Before each of the 12 `npm pack`
   invocations, every `<prefix>-<version>.tgz` entry in
   `packages/<pkg>/dist` is removed by enumerating the directory
   (`readdirSync` + prefix/suffix filter + `rmSync` of each concrete path),
   through one shared helper used at all twelve sites.
2. **AC2, scope of deletion.** Unrelated entries in the same dist directory
   survive: other packages' tarballs, non-`.tgz` files (e.g. `.last_build`,
   `README.txt`), and names that only share a longer prefix boundary
   (`vybestack-llxprt-code-corex-…` is not `core`).
3. **AC3, missing/empty dist tolerated.** A dist directory that does not
   exist (fresh checkout + `--skip-npm-install-build`, before any build) or is
   empty is a no-op, not a crash, parity with the old `force: true` behavior.
   Any non-ENOENT error propagates (fail fast).
4. **AC4, regression test.** A behavioral test creates a dist dir holding a
   stale `<pkg>-0.0.1.tgz`, runs the cleanup, asserts the file is gone. It
   fails against HEAD (the helper does not exist there; the old code deletes
   nothing).
5. **AC5, reversion guard.** `scripts/tests/release-process.test.ts` (which
   already reads build_sandbox.ts as text under
   `describe('scripts/build_sandbox.ts')`) asserts the shared helper is used
   and no literal `-*.tgz` rmSync glob remains in the source.
6. **AC6, no collateral change.** Pack order, chmod flow, bind-release-deps
   backup/restore, `buildImage` (podman authfile, `CLI_VERSION_ARG`,
   `BUILD_SANDBOX_FLAGS`, image tag, temp authfile cleanup), and the final
   `image prune` are byte-identical to HEAD.

## Design decision: helper lives in `scripts/utils/tarball-cleanup.ts`

The issue asks for "one shared helper rather than twelve repetitions". Two
placements were considered:

- **Export from `build_sandbox.ts`** (suggested by the auto-generated issue
  plan): importing that module executes its top-level CLI, yargs parse,
  `execSync('bun scripts/sandbox_command.ts')`, and `process.exit(0)` when the
  probe reports `sandbox-exec` (the case on macOS). A test import cannot load
  it safely. Wrapping the ~300 executable top-level lines in a `main()`
  function would violate the `max-lines-per-function: 80` rule on the
  `scripts/` TS block in eslint.config.js, or force splitting the script flow
  into multiple functions, a rewrite far beyond this issue's scope.
- **Leaf module `scripts/utils/tarball-cleanup.ts`** (chosen): importable with
  zero side effects, no restructuring of build_sandbox.ts, and direct repo
  precedent, `scripts/utils/release-packages.ts` exists precisely so two
  scripts share one definition ("the exclusion set cannot drift"), and
  `scripts/utils/error-guards.ts` provides the `isErrnoException` type guard
  this helper reuses.

`build_sandbox.ts` therefore changes by exactly one import line plus the
twelve call-site swaps. The Dockerfile `COPY` globs stay: Docker expands them;
`node:fs` does not.

## Tests (bun:test, behavioral, no mocks, real tmp-dir fixtures)

New `scripts/tests/build-sandbox-tarball-cleanup.test.ts`, importing
`removeTarballs` from `../utils/tarball-cleanup.ts`:

1. removes every tarball sharing the package prefix (0.0.1, 0.11.0) →
   `readdirSync(dist)` is empty afterwards.
2. preserves other-package tarball, prefix-boundary name
   (`vybestack-llxprt-code-corex-9.9.9.tgz`), `README.txt`, `.last_build` →
   directory contents equal exactly the preserved set.
3. empty dist dir → no throw, still empty (idempotent).
4. nonexistent dist dir → no throw, directory still absent (AC3).

`release-process.test.ts`: build_sandbox.ts uses `removeTarballs(` and
contains no `-*.tgz` literal (AC5).

## Red → green

- RED: with production changes stashed, the new test file fails (module
  import unresolved at HEAD).
- GREEN: with the helper module + call-site swaps, all cases pass.

## Verification

- `bun test` on the new/changed files with the scripts-tests preloads
  (`storage-isolation-guard.ts`, `test-setup.ts`); logs under `tmp/verify3334/`.
- `bun scripts/run_bun_tests.ts --root scripts-tests` (full local run has
  historically exceeded the 900 s local command ceiling, pre-existing; CI is
  the authoritative full-suite gate).
- `npm run typecheck` (includes `tsc -p tsconfig.scripts.json`), scoped lint
  on touched files, `prettier --check`, `npm run build`, smoke:
  `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
- `git diff` audit: build_sandbox.ts delta is exactly import + 12 call sites.

## Out of scope (noted for follow-up, not fixed here)

- `.github/workflows/build-sandbox.yml` has its own "Pack npm packages" step
  (9× `npm pack`) with no stale-tarball cleanup at all, same defect class,
  different file; deserves its own issue.
- No glob library introduced; no change to the packed workspace set.

## Implementation incident (recorded for review context)

An earlier working-tree state had (a) a duplicated helper export, (b) an
orphan `if (import.meta.main) { main(); }` referencing an undefined `main()`,
and (c) placeholder test assertions comparing strings to `false`. That state
was reverted to HEAD and re-applied surgically; the final diff is audited
against AC6.
