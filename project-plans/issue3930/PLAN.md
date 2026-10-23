# Issue 3930: Bun 1.4.4, Node 24.22.1, vulnerable deps, CI supply-chain hardening

Status log. Another agent can resume from here. Verification logs live in
`tmp/verify3930/` (gitignored).

Machine facts checked while doing this: Bun 1.4.3 still trusts the compromised
eMudhra chain, Bun 1.4.4 and Node 26.12.1 reject it. `@types/bun` 1.4.4 is not
published (latest 1.4.3), so the dev types pin is 1.4.3.

## 1. Bun 1.3.14 to 1.4.4

- `.bun-version`, root and `packages/cli` `bun` dependency, every `@oven/bun-*`
  optionalDependency in both manifests, root `engines.bun >=1.4.4`.
- `OVEN_PACKAGE_VERSION` in `packages/cli/src/launcher/oven-bun-variants.ts`
  (the launcher compares against the manifest pin; the existing manifest
  consistency test keeps them in step).
- Root `@types/bun` 1.4.3.
- `scripts/tests/bun-workspaces.test.ts` expected pin.
- `scripts/tests/issue-2978-oven-fallback.bun.test.ts`: bun 1.4.4 changed the
  shape of the platform table in `node_modules/bun/install.js` (the baseline
  variants are now tagged `alias: !0` instead of tagging the AVX2 variant with
  `avx2: !0`, and the end marker moved). The test parser maps the new shape back
  onto the suite's model. The set of 16 packages is unchanged, so
  `oven-bun-variants.ts` needs no code change.
- Docs: CONTRIBUTING.md, dev-docs/bun.md, README.md, README_CN.md.
- Historical measurement comments that say "Bun 1.3.14" (test notes, bench
  data) are left alone on purpose.

## 2. CI and release Bun

- `ci.yml`: both `bun.sh/install` bootstraps now read `bun-v$(cat .bun-version)`;
  the plugin `setup-bun` uses `bun-version-file: .bun-version`.
- `release.yml`: both plugin `setup-bun` steps use `bun-version-file`.
  The "Restore repository Bun version" step is now redundant but harmless; it was
  kept so `release-process.test.ts` step ordering assertions stay meaningful.
- `plugins/*/package.json` `engines.bun >=1.4.4` (+ READMEs, plugins topology test).
- Plugin `@types/bun` stays 1.3.14 (asserted by plugins-topology test, pinned in
  the plugin lockfiles, not part of this issue).

## 3. Node

- `.nvmrc` 24.22.1. All `actions/setup-node` steps that used `'24'` or `'24.x'`
  literals now use `node-version-file: .nvmrc`.
- Matrix-driven setup-node steps (`24.x` values are asserted by several tests)
  get `check-latest: true` so a stale runner tool cache cannot be reused.
- `Dockerfile`: `node:24.22.1-slim` (tag exists on Docker Hub, checked via the
  Hub API).
- `engines.node >=24.22.1` in root, every `packages/*` and both plugins.
  `packages/tools/src/__tests__/package-metadata.test.ts` updated, CONTRIBUTING.md
  updated.
- `@vybestack/llxprt-ui` in the Dockerfile is NOT pinned: the repo has no version
  source for it (npm latest is 0.9.3) and the sandbox tests assert the
  unversioned command. Follow-up if a pin is wanted.
- `config.sandboxImageUri` is not bumped here; it is rewritten by the release
  version script, which owns it.

## 4. Vulnerable runtime dependencies

Manifest changes (root + packages): shell-quote 1.12.0 (exact in root deps and
overrides, `^1.12.0` in packages), simple-git `^4.0.2`, @modelcontextprotocol/sdk
`^1.32.1`, undici `^7.30.1`, fast-uri `^3.1.8`, sharp `^0.35.5`, js-yaml 4.3.2
(deps and the 4.x override; 3.x override 3.15.2; vscode companion overrides),
overrides: qs `^6.16.0`, hono `>=4.13.11 <5`, ip-address `>=10.7.1 <11`,
proxy-addr `>=2.0.8 <3` (new), brace-expansion 1.1.21 / 2.1.7 / 5.0.12.
minimatch needed no override change: the lockfile already resolves 10.2.5, and
the old 10.0.x advisory range no longer appears.

Lockfiles: `package-lock.json` via `npm install --package-lock-only` (and
`npm update brace-expansion --package-lock-only` for stragglers);
`bun.lock` via `rm bun.lock && bun install`. Bun migrates from the npm lockfile,
the result is idempotent (same SHA on a second `bun install`), and it is now
`lockfileVersion` 3 because Bun 1.4 writes that format. `npm ci` was proven on a
copy of the tree.

### simple-git 3 to 4 migration

- Read the changelog. Removed default export / `gitP` / `simple-git/promise`:
  the repo only uses the named `simpleGit` import. Abbreviated long options now
  throw: the repo uses full option names only.
- Real behavior break found by the existing real-git test
  (`gitServiceCheckpoints.test.ts`, 5 failures before the fix): v4 rejects
  `GIT_DIR` / `GIT_WORK_TREE` passed through `.env()` unless named in
  `allowEnvironment`. Fixed in `packages/core/src/services/gitService.ts` by
  constructing the shadow repository client with
  `allowEnvironment: ['GIT_DIR', 'GIT_WORK_TREE']`. Nothing else is opened up.
- Behavior change accepted on purpose: v4 strips ambient `GIT_*` variables (for
  example `GIT_SSH_COMMAND`, `GIT_ASKPASS`) from the git child process. This
  affects `packages/cli/src/config/extensions/github.ts` (extension clone and
  update check). Allowing them again would reopen the command-execution vector
  the upgrade exists to close, so it is not allowed. `~/.ssh/config` and git
  credential helpers still work. Verified with a real `file://` clone, fetch,
  checkout, ls-remote, rev-parse sequence.

### Audit

Final state (`bun audit` and `npm audit --package-lock-only --omit=dev`): one
finding, reported by npm as three entries because they are one dependency chain
(`fast-glob` > `micromatch` > `braces`). `source-map-js` is 1.2.2 in both
lockfiles and no longer reported. npm's suggested fix is a major downgrade of
`fast-glob`; it is not applied (it does not remove `braces`).

#### Accepted exception: braces 3.0.3 (GHSA-vfj7-8cjw-p6xm, CVE-2026-93687, high)

- **Advisory.** Recursive AST walkers in `braces` (`lib/parse.js`, `lib/compile.js`,
  `lib/expand.js`) have no depth guard. A deeply nested brace pattern that stays
  under the library's 10,000-character input limit can exhaust the call stack and
  throw `RangeError`. Affected range `<=3.0.3`; no patched version is published
  (3.0.3 is the latest).
- **Affected production paths.** Only `fast-glob@3.3.3` > `micromatch@4.0.8` >
  `braces@3.0.3`. The root `micromatch` dependency is declared but never
  imported (grep of the repository, excluding `node_modules`). `glob@12`
  uses `minimatch` and `brace-expansion` (patched here), and `picomatch@4.0.4`
  has its own brace parser, so neither reaches `braces`.
- **Runtime call sites** (every `fast-glob` import under `packages/*/src`):
  - `packages/tools/src/tools/ast-grep.ts` (`FastGlob.stream`, ~line 582): include
    patterns and `!`-excluded ignore patterns come from the `globs` tool
    parameter. **Model-controlled.** The parameter schema has no length or count
    bound; `braces` itself rejects patterns over 10,000 characters with a
    `SyntaxError`.
  - `packages/tools/src/tools/structural-analysis/helpers.ts` (`getFiles`,
    `iterateFiles`): patterns are `**/*.<ext>` built from the `LANGUAGE_MAP`
    constant. Not user or model input.
  - `packages/tools/src/tools/ast-edit/cross-file-analyzer.ts` (`getWorkspaceFiles`,
    `searchAllLanguages`): fixed `**/*.ts|js|py` and `LANGUAGE_MAP` extension
    patterns. Not user or model input.
  - Ignore files (`.gitignore`, `.llxprtignore`) go through the `ignore` package
    and `picomatch`, never `fast-glob`.
- **Exposure.** The CLI runs on the user's own machine, so the worst case is the
  CLI process dying or the tool call failing. It requires a model (or prompt
  injection steering a model) to send a pathological `globs` value to
  `ast_grep`. Measured with the shipped versions: on Bun 1.4.4 (the runtime the
  CLI uses) nested patterns of up to 9,983 characters do not overflow the stack
  (they fail as `ENAMETOOLONG` or match nothing); on Node 26.12.1 a 9,983
  character `{{{...a,b...}}}` pattern throws `RangeError: Maximum call stack
  size exceeded` from `FastGlob.stream(...)`. In `ast-grep.ts` that call runs
  inside `execute()`, whose `try/catch` returns a tool error (`Error searching:
  ...`), so the process survives. Nothing was reproduced that terminates the
  process; the advisory's uncaught case needs a caller that does not catch the
  synchronous throw.
- **Existing bounds.** `braces` rejects input over 10,000 characters. Nothing in
  the repository bounds nesting depth.
- **Why it stays.** Replacing `fast-glob` is not small or behavior-preserving.
  The two fixed-pattern sites could move to `fdir` + `picomatch` (both already
  dependencies), but `ast-grep.ts` relies on `fast-glob` semantics for
  user-supplied globs (absolute patterns, parent traversal, negation through
  `ignore`, per-entry realpath validation afterwards), and `picomatch`/`fdir` do
  not provide those. A partial swap leaves `braces` in the tree and adds a second
  glob engine. Pinning `braces` lower or following `npm audit fix --force` would
  downgrade `fast-glob` to a major with different behavior, and no `braces`
  version outside the affected range exists.
- **Mitigation and follow-up.** The tool-level `try/catch` is the mitigation.
  Revisit when `braces` publishes a fix (bump through an override) or when
  `ast_grep` globs move to a bounded matcher; at that point also drop the unused
  root `micromatch` dependency.

## 5. Release job lifecycle scripts

Investigation (done on a copy of the tree with `npm ci --ignore-scripts`):

- Third-party install scripts present in the lockfile: `@ast-grep/lang-*`,
  `bun`, `esbuild` (dev), `msw` (dev), `node-pty` (optional), `tree-sitter-bash`,
  `tree-sitter-pwsh`. ast-grep languages and tree-sitter grammars ship
  `prebuilds/` and load without their scripts (verified by parsing C and Swift
  and importing tree-sitter-bash). esbuild and msw scripts are optimizations.
- `bun` is the exception: without its postinstall `node_modules/.bin/bun` is a
  stub that exits with "Bun's postinstall script was not run", and `npm run build`
  (which calls `bun scripts/build.ts` through npm's PATH) fails.
- `npm rebuild bun` is NOT an acceptable fix. It runs `bun`'s third-party
  `postinstall` (`node install.js`), which executes the selected binary and, when
  that fails, falls back to `npm install @oven/bun-<variant>@1.4.4` or a direct
  tarball download from the registry. Both fallbacks bypass the lockfile's
  integrity hashes, in jobs that hold OIDC, registry-login or write credentials.
  An earlier revision of this plan described it as a copy of the installed binary
  and labeled the step first-party. That was wrong.
- Replacement: `scripts/link-bun-runtime.ts` (repository-owned, run with
  `node scripts/link-bun-runtime.ts`; Node 24 strips the types). It performs the
  copy `install.js` ends with, using only files `npm ci --ignore-scripts` already
  extracted and verified: it selects the host's `@oven/bun-<variant>` with
  `selectOvenVariants`/`detectHostPlatform` from
  `packages/cli/src/launcher/oven-bun-variants.ts` (the same table the launcher
  uses), checks that the variant and `node_modules/bun` both match the pinned
  version, copies `bin/bun[.exe]` to `node_modules/bun/bin/bun.exe` and hard-links
  `bunx.exe` to it. npm already created `node_modules/.bin/bun` and `bunx`
  pointing at those two paths. It never executes a binary, never uses the network,
  and fails with the list of variants it looked for when none is installed.
- The root `postinstall` (`scripts/postinstall.cjs`) is first-party: it applies
  `patches/` (ink, react-devtools-core) through the lockfile-pinned `patch-package`,
  strips npm peer flags, links workspaces, and installs Windows launchers. It is
  run explicitly with `node`.
- After `npm ci --ignore-scripts`, `node scripts/link-bun-runtime.ts`,
  `node scripts/postinstall.cjs` the full `npm run build` succeeded in a scratch
  copy (`npm ci --ignore-scripts --cache <empty dir>`), and
  `node_modules/.bin/bun --version` printed 1.4.4. Before the link step it printed
  "Bun's postinstall script was not run". The linker was also run with a real
  Node 24.22.1 binary (the version in `.nvmrc`) to confirm type stripping works
  there.

Changes: `npm ci --ignore-scripts` followed by a "Link lockfile-installed Bun and
apply dependency patches" step (`node scripts/link-bun-runtime.ts` + `node
scripts/postinstall.cjs`) in `release.yml`, `build-sandbox.yml`, `luther.yml`,
`e2e.yml` and in the three nightly jobs that run tests or E2E (`windows_ci`,
macOS shards, `e2e_full`).

`scripts/tests/supply-chain-pins.test.ts` now fails when a privileged job (one
with `id-token: write`, a registry login, `NODE_AUTH_TOKEN`/`NPM_TOKEN`, or an
`npm publish`/`login`, plus the four workflows named above) runs `npm rebuild`,
or `npm ci`/`install`/`i`/`add` without `--ignore-scripts`. The matcher and the
job classifier have their own unit tests, and a mutation check (reintroducing
`npm rebuild bun` in `release.yml`) made the suite fail.

### Luther: nightly CLI install

`luther.yml` ran `npm install -g @vybestack/llxprt-code@nightly` with lifecycle
scripts enabled, in a job with `contents: write`, `pull-requests: write`,
`issues: write` and job-wide model API credentials. A global install also ignores
the project `.npmrc`, so the cooldown did not apply.

Decision: keep installing the published nightly, but harden the install. Using
the CLI built from the checkout was rejected because Luther is not equivalent
with it: the agent edits the checkout, including `packages/cli`, on every
attempt and then runs QA, and the next attempt would run the agent from the tree
the previous attempt just changed (possibly broken, or an issue branch that
touches the CLI itself). The agent needs a fixed install that the work cannot
alter. The step is now:

```
npm install -g --prefix "${RUNNER_TEMP}/llxprt-nightly" --ignore-scripts \
  --userconfig "${GITHUB_WORKSPACE}/.npmrc" @vybestack/llxprt-code@nightly
echo "${RUNNER_TEMP}/llxprt-nightly/bin" >> "${GITHUB_PATH}"
```

- `--ignore-scripts`: no dependency lifecycle script runs in the privileged job.
- `--userconfig` with the repository `.npmrc`: applies `min-release-age=3` and the
  exclusions for `@vybestack/*`, `bun`, `@oven/bun-*`. Checked with
  `npm config get min-release-age --global`: `null` without the flag, `3` with it,
  and the exclude list resolves.
- Bun needs no linking step here. The published CLI launcher resolves Bun from the
  installed `@oven/bun-<variant>` package when `bun/bin/bun.exe` is still the
  placeholder (issue #2978). Verified by installing the current nightly with
  these flags into a scratch prefix and running `llxprt --version`
  (0.12.0-nightly.261020.f17692ebd).
- The prefix keeps the install out of the checkout's tree and the system Node
  prefix.

Left unchanged on purpose: nightly `windows_bun_native_smoke` and
`cli_bundle_launch` (their purpose is to observe install-time native behavior and
scripts-disabled consumers respectively, with `contents: read` only), `ci.yml`,
`interactive-ui.yml`, `smoke-test.yml`, `_evals-run.yml`,
`windows-installed-command.yml` (not named by the issue; no OIDC, no publish
credentials).

Rollup installs (`ci.yml`, `interactive-ui.yml`, `luther.yml`, `nightly.yml`,
`release.yml`) are all pinned to `@4.59.0` (the version `release.yml` used) and run
with `--ignore-scripts`. Rollup is not in the lockfile at all, so these steps are
best-effort (`|| true`) as before.

actionlint was run on every workflow touched. Remaining findings are old shellcheck
style notes in lines this change did not touch (release.yml 783, ci.yml 229 and 1643).
GitHub Actions itself cannot be run locally, so the workflow edits are verified by
actionlint, the `scripts/tests/supply-chain-pins.test.ts` contract test, and the
`npm ci` + build simulation above.

## 6. Dependency cooldown (3 days)

- `.npmrc`: `min-release-age=3` (unit: days, key confirmed in the npm 11.20
  config docs and `npm config get`), with `min-release-age-exclude[]` for
  `@vybestack/*` (minimatch glob supported), `bun`, `@oven/bun-*`.
- `bunfig.toml`: `[install] minimumReleaseAge = 259200` (seconds) and
  `minimumReleaseAgeExcludes`. Bun's exclude list is exact names only: a probe
  with `"@oven/bun-*"` was still blocked ("blocked by minimum-release-age"). The
  list therefore names `bun`, the 16 `@oven/bun-*` packages, every first-party
  `@vybestack/*` package name and `@vybestack/llxprt-ui`.
- Both proven: `npm install --package-lock-only`, `npm ci`, and a clean
  `rm bun.lock && bun install` succeeded with the cooldown active and the new
  pins (bun 1.4.4 was published on the day of this change and is exempt).
- `packageManager` raised from `npm@11.6.2` to `npm@11.19.1`: npm 11.6.2
  predates `min-release-age` (npm 11.10). 11.19.1 is the npm bundled with Node
  24.22.1. Older npm only warns about the unknown key, it does not fail.
- Contract test: `scripts/tests/supply-chain-pins.test.ts` keeps the Bun
  exclude list in sync with the manifests.

## 7. upstream-sync.yml

Deleted. Schedule was commented out, it was manual-only, it synced from
`gemini-cli`, and its `npx` target (`vybestack/llpxrt-code`) is a typo for a repo
that 404s. The only reference was a row in `dev-docs/ci-relevance-guide.md`,
removed.

## 8. Docs

`docs/troubleshooting.md` corporate CA section: Bun embeds its root store (OS
store updates do nothing), `NODE_EXTRA_CA_CERTS` is honored by Bun 1.4.4
(verified with a locally issued CA against a Bun HTTPS server: failed without the
variable, 200 with it, same as Node), `--use-system-ca` exists as a `bun` flag,
`NODE_USE_SYSTEM_CA` is not confirmed for Bun. Minimum runtimes for the eMudhra
fix are listed.

## Not done / follow-ups

- Issue item 7 (npm Trusted Publishing configuration) is manual.
- `@vybestack/llxprt-ui` Dockerfile pin (no version source).
- `config.sandboxImageUri` bump happens at release time.
- Remaining audit findings are listed below.

## Verification round 2 (failures after the first full run)

Worktree of origin/main at tmp/main-wt (npm ci; `npm rebuild bun` needed because npm 11.20 skips
install scripts not covered by allowScripts). Classification below is filled as groups are analysed.

### Root causes
1. **Bun 1.4.4 `vi.resetAllMocks()` now also resets implementations passed to `vi.fn(impl)`**
   (1.3.14 only cleared call history; 1.4.4 makes them return `undefined`). Verified with a minimal
   probe. Affects any test that builds a `vi.fn(impl)` once (module scope or mock factory) and calls
   resetAllMocks/resetAllMocks-like in beforeEach.
   - KeychainTokenStorage (19): `node:crypto` mock factory used `vi.fn(() => ...)` for randomBytes,
     reset to undefined, `checkKeychainAvailability` swallowed the TypeError and reported
     unavailable. Fix: plain functions in the factory (test file only).
2. typecheck: @types/bun 1.4.3 types `Subprocess.signalCode` as `Signals | number | null`
   (unnamed signals are numbers). Fix: `ShellProcessIdentity.signalCode` widened to
   `string | number | null` (shellJobTypes.ts, only compared to null) and the Bun transport in
   shellJobGroup.ts normalizes numeric codes to `SIG<n>` before they reach `ProcessExitInfo`.
3. lint: supply-chain-pins.test.ts loop restructured (map/filter, plus a non-empty assertion).

Root cause 1 is a documented Bun 1.4 breaking change (oven-sh/bun#28792, PR #33374; docs
bun.com/docs/test/mocks): `jest/vi.resetAllMocks()` now calls `mockReset()` on every mock, which drops
implementations from `vi.fn(impl)`, `mock(impl)` and `mockReturnValue`. There is no opt-out. A reset
mock constructor invoked with `new` returns `undefined`.
- Agents (client.ts) groups, 116 failures: `client-test-helpers.ts` called `resetAllMocks()` then
  `new HostConfig(...)` on the automocked Config class; the automock constructor implementation was gone, so
  `Object.assign(undefined, ...)` threw in every beforeEach. Fix: build the instance with
  `Object.create(HostConfig.prototype)` (same object the automock constructor produced).
  Follow-on test files that kept factory-time implementations: `client.methods.test.ts`
  (retryWithBackoff re-applied after setup), `client.media-history-lifecycle.test.ts` and
  `client.model-profile.test.ts` (clientToolGovernance mock factory now uses plain functions).

#### CLI groups (all classified as Bun 1.4.4; the same files pass on origin/main under Bun 1.3.14)
- mcp add, approval/folderTrust/mcpFiltering/providerModel/toolGovernance parity, config.part2/3/4,
  PermissionsModifyTrustDialog, usePermissionsModifyTrust, sandbox-launch-lifecycle: same
  resetAllMocks cause. These files declare large mock factories with `vi.fn(impl)` and call
  `vi.resetAllMocks()` in beforeEach/afterEach. 1.3.14 behaved as `clearAllMocks()`, so the tests
  were written against that. Fix: `vi.clearAllMocks()` (exactly the old semantics; each test already
  re-applies the per-test return values it needs).
- sandbox-launch-release (#3469, 4-5 failures, then a hang with only the reset fixed): second Bun 1.4
  change. Bun 1.4 accepted `net` sockets are no longer auto-resumed (Node semantics). The test's
  fake proxy listener replied with `socket.end(...)` without ever reading curl's request, so the
  socket never saw EOF and `server.close()` never settled. Fix: `listenAt` resumes each accepted
  socket (test only).
- ToolResultDisplay retention (#3457): real production retention exposed by the engine. A heap
  snapshot (`Bun.generateHeapSnapshot('v8')`) showed `textUtils.ts` `stringWidthCache` keys pinning the
  1,000,000-character source bodies: `trimToVisibleTail` returned `kept.slice(dropped)`, and the
  4080-character tail reached `getCachedStringWidth` through `MaxSizedBox`. With 1.4.4 the tail is still
  a view of the parent after layout's `split`. Fix in `ToolResultDisplay.tsx`: the sliced tail is copied
  (`detachFromSource`). Retained bytes in the test went from 17.4 MB to 1.49 MB (same as 1.3.14).
- cli-args.integration ("should apply CLI args after profile load but before provider switch", ran
  into the 60s spawned-CLI guard): Bun 1.4 `fetch` network errors changed (breaking list, PR #35855):
  an unresolvable host now rejects as `TypeError` with `code: 'ENOTFOUND'` (Node-style) where 1.3.14
  rejected with `Error ConnectionRefused` (probe `tmp/verify3930/exp/fetch.ts`). The provider retry
  policy (`packages/core/src/utils/retry.ts`) deliberately lists ENOTFOUND as transient, so the default
  5 attempts with 5/10/20/30 s backoff now ran ~65 s before reporting the endpoint. Production policy
  unchanged. Fix in the test: `--set retries=1`; assertions unchanged (verified manually: output names
  `endpoint: https://cli-base-url.example.com` and exits in seconds).
- sandbox-podman-diagnostics: passes in isolation on main (1.3.14 and 1.4.4) and on the branch (6/6),
  so its full-run failure was timing under load (see "still to confirm" below).

#### Remaining full-run failures (round 3 analysis)

Method: each file run in isolation on the branch (Bun 1.4.4) and in `tmp/main-wt` under Bun 1.3.14 and
1.4.4 (`tmp/verify3930/t.sh`), 3 to 15 runs each, then the cause was reproduced with a minimal probe in
`tmp/verify3930/exp/`.

- **assertTestStorageIsolation (inherited env child)**: Bun 1.4 change. `node:child_process`
  `spawnSync` with an inherited environment now forwards live `process.env` mutations
  (`exp/envinherit.ts`: 1.3.14 `undefined`, 1.4.4 `x`). The child therefore sees the marker and the
  redirect together and resolves the redirect. Test updated to assert exactly that
  (`toBe(afterStartupConfigHome)`), still requires status 0 (guard not fired).
- **boundary.no-internals-subpath and scratch-dir (child runs the boundary test)**: Bun 1.4 change.
  A missing package now rejects with `ERR_MODULE_NOT_FOUND` and "Cannot find package '<name>'" where
  1.3.14 said "Cannot find module '<specifier>'" (`exp/imp.ts`). Test now asserts the error code plus
  `^Cannot find (module|package) `. The scratch-dir failure was only the child boundary run failing.
- **bootstrap-shell-owner (2 tests)**: Bun 1.4 change. `node:http` `ServerResponse` emitted no
  `'close'` when the client process died under 1.3.14 (`exp/httpclose2.ts`), so the gate's
  `connected()` stayed true forever and `expect(gate.connected('bootstrap')).toBe(true)` was vacuous
  (it asserted the state after cleanup had killed the workload). 1.4.4 reports the close correctly.
  The assertion was removed from `bootstrapFailure`; `gate.entered('bootstrap')` (still awaited) is
  what proves the workload reached the gate. Other tests using `connected()` assert while the workload
  is alive and still pass.
- **MediaLifecycleMetrics (production bug under Bun 1.4)**: `process.resourceUsage().maxRSS` is KiB on
  every platform in Bun 1.4 and Node (`exp/maxrss.ts`: 1.3.14 returned bytes on Darwin, 1.4.4 returns
  209392 for a 214 MB RSS). `maxRssToBytes` multiplied by 1 on Darwin, so `osPeakFootprintBytes`
  under-reported by 1024x. Fix in `media-lifecycle-metrics.ts`: always KiB (`maxRssToBytes(maxRSS)`),
  test updated.
- **core run-bun-tests "observes close separately..."**: Bun 1.4 microtask ordering. The fixture parent
  did not `unref` its `Bun.spawn` descendant, so the parent stayed alive until the descendant exited and
  `exit` and `close` fired synchronously back to back (`exp/closeSemantics2.ts`/`3.ts`). 1.3.14 ran the
  `await once(child, 'exit')` continuation before the close `.then`; 1.4.4 runs it after. The test never
  exercised a descendant holding the pipe. Fix: `descendant.unref()` so the parent really exits first;
  passes on 1.3.14 and 1.4.4. The anonymous `(fail) hangs` / `(fail) fails` lines are output of fixture
  test files the runner test executes on purpose (same on origin/main under 1.3.14).
- **shell-terminal-settlement (flaky ~35%, ECONNRESET)**: Bun 1.4 socket change; main under 1.4.4
  fails 4/12, main under 1.3.14 0/12. `stopFixtures` writes `stop` to a fixture socket whose process was
  already killed; 1.4.4 delivers the resulting reset as an `'error'` before EOF and `events.once(socket,
  'close')` rejects on `'error'`. Fix in `shell-terminal-test-helper.ts`: wait for `'close'` without
  rejecting on `'error'` (every socket already has an error listener from `awaitReadiness`). 15/15 pass.
- **sandbox-podman-diagnostics (flaky in isolation, both Bun versions)**: not a Bun issue. On macOS the
  first execution of a freshly written script takes 1.4 s to 10 s under this machine's load (load average
  about 22 from sibling sessions), then about 5 ms (`exp/firstexec.ts`, same on 1.3.14 and 1.4.4). The fake `ssh` therefore missed
  the 1 s readiness poll (message "timed out waiting for TCP tunnel", no `ssh.pid`) or the elapsed
  assertions. Fix in the test: `writeExecutable` runs the fixture once with a warm-up env var (guard line
  inserted after the shebang makes it exit immediately) so the OS first-exec cost is paid before the
  bridge is timed. 8/8 pass; timing assertions unchanged.

Full run 3 started at 17:35 (`tmp/verify3930/run.sh`, status in `tmp/verify3930/status.log`).

## GrepTool ephemeral fallback 60s investigation

**Verdict:** a pre-existing Bun `child_process.spawn` lifecycle race, reproduced on
both 1.3.14 and 1.4.4. The child finishes and Bun emits its output and `close`
before `spawn()` returns. GrepTool registers its listeners afterwards and waits
for an event that has already happened. The 60-second invocation timeout then
returns a **timeout error**, not a successful zero-match result. No implementation
or test files were changed in this investigation; the probes used inline code
and logs under `tmp/verify3930/grep-investigation-*`.

### What waits, and which strategy runs

- `packages/tools/src/tools/grep/types.ts:54,59` defines
  `DEFAULT_TIMEOUT_MS = 60_000` and `MAX_TIMEOUT_MS = 300_000`.
  `grep.ts:127-129` chooses the default; `grep.ts:690-691` starts the single
  invocation-wide abort timer. This is neither a spawn-specific nor an idle timer.
- The test creates ten physical files under `os.tmpdir()`
  (`__tests__/grep-ephemeral-precedence.test.ts:26-43,106-116`), outside a git
  repository. `utils/gitUtils.ts:10-31` checks ancestry for `.git` without spawning
  git. `grep/search-strategies.ts:496-503` therefore skips git availability and
  git grep. The actual command is `grep -r -n -H -E -I ephmatch .`, with the
  temporary directory as cwd (`search-strategies.ts:553,578-579,618-626`).
- Dispatcher order is **git grep, system grep, JavaScript**
  (`search-strategies.ts:734-779`). Ripgrep is a separate `RipGrepTool`, not a
  strategy in this GrepTool. Its local resolver (`utils/ripgrepPathResolver.ts:70-79,
  215-241`) imports a packaged path or checks local PATH/files. The installed
  `@lvce-editor/ripgrep` 5.7.0 re-exports `@vscode/ripgrep`'s locally resolved binary
  path. There is no runtime download, fetch, or DNS operation in this path.
- `runBoundedGrepSubprocess` spawns at `search-strategies.ts:420-424`, then attaches
  stdout/stderr listeners at 449-454 and error/close listeners at 455-478. It has
  no independent timeout. Process-group termination has a 5,000 ms grace period,
  50 ms polling, and 1,000 ms post-kill wait (`utils/processTermination.ts:9-12`);
  the 10,000 ms taskkill watchdog is Windows-only. None explains the 60 seconds.

### Direct event-order evidence

`tmp/verify3930/grep-investigation-native-144-1.log:4` captures the full ToolResult
and listener/event trace from the actual native test runner. Relative timestamps:

| Time (ms) | Event |
| --- | --- |
| 573 | Enter `ChildProcess.prototype.spawn` for grep |
| 605 | Child emits `exit(0, null)` |
| 606 | stdout emits all ten `ephmatch_*` lines, then ends/closes |
| 606 | Child emits `close(0, null)` |
| 606 | `ChildProcess.prototype.spawn` returns |
| 606 | GrepTool registers stdout/stderr data listeners and error/close listeners |

Thus the search itself completed successfully in milliseconds. Its output and
settlement event were lost before the caller could subscribe. At the stalled
unmodified run's midpoint, `ps` showed no child; `lsof` showed no remaining pipes;
`sample` showed the main thread idle in `kevent64`. Captures:
`grep-investigation-stall-lsof.log`, `grep-investigation-stall-sample.log`.

`grep-investigation-phase-144-20.log:4` additionally records stacks for premature
exit/close: `processTicksAndRejections` runs inside native `spawn (unknown)`, under
`node:child_process`'s `spawn`, while the outer call is still active. No stdio
getter was active in this capture. This establishes re-entry during native spawn;
it does **not** establish that a particular lazy builtin import is responsible.
The extracted installed runtime implementations are in
`grep-investigation-bun144-child-source.log` and `grep-investigation-bun1314-child-source.log`.
Both auto-resume stdout/stderr on exit and count pipe closes before emitting child
close. Early auto-resume explains why output, as well as close, can be lost.

### Why the assertion says zero, and why there is no fallback

- Abort invokes `stopProcess()` and rejects with `SearchAbortedError`
  (`search-strategies.ts:443-447`); that class sets `name = 'AbortError'` at 190-194.
  `trySystemGrep` deliberately rethrows lifecycle errors instead of falling through
  to JavaScript (`search-strategies.ts:641-644`). Git uses the same rule at 536-539.
  Continuing after the invocation deadline would be incorrect.
- `grep.ts:566-589` converts this abort into a ToolResult containing
  `error.type = ToolErrorType.TIMEOUT`, `returnDisplay = 'Timed out after 60000ms'`,
  and explicit timeout text in `llmContent`. The native trace captured this exact
  result. Its probe shortened only the timer callback to 3 seconds, so the message
  still reports the unchanged configured 60000 ms. Unmodified runs retained the
  real 60-second deadline.
- The test helper at `grep-ephemeral-precedence.test.ts:121-130` discards
  `result.error` and counts `/ephmatch_/g` in `llmContent`. Timeout text contains
  none, so line 135 reports `Received: 0`. The model receives timeout text, not
  the genuine no-match success branch (`grep.ts:487-497`). **The alleged silent
  false-negative production bug is not present in this reproduced path.** The
  subprocess lifecycle hang/data loss is a separate production implementation
  concern exposed by the runtime.

### Runtime comparison and scope

Used the existing `tmp/main-wt` worktree and its installed Bun 1.3.14; did not
create/remove another agent's worktree or reinstall dependencies. Baseline
`origin/main` and the worktree are at `fa605945564bbca971fe360ea222408e840ea098`.
Grep source and the test are unchanged between baseline and this branch.
All four groups ran the unmodified file in ten concurrent fresh processes with
`LLXPRT_RUNNING_TESTS=true` and `bun test --timeout 75000`:

| Checkout | Runtime | File runs passing/failing |
| --- | --- | --- |
| issue3930 | 1.4.4 | 9 / 1 |
| issue3930 | 1.3.14 | 9 / 1 |
| origin/main | 1.3.14 | 9 / 1 |
| origin/main | 1.4.4 | 9 / 1 |

Every failing file had the first test fail at about 60 seconds, followed by four
passing tests. Exact baseline example: `grep-investigation-main1314-10.log:18-22`
(first test 60052.86 ms). Driver log: `grep-investigation-batch.log`.
Load averages were approximately 74-85 during these groups, higher than the
reported initial run. Native-runner instrumentation was provided through
`--preload /dev/stdin`, without creating a preload file.

A second controlled comparison recorded exit/close during spawn and shortened
only the probe timer: default stdin pipe failed 4/20 fresh processes on 1.4.4 and
3/20 on 1.3.14; setting stdin to `ignore` passed 20/20 on each. All five original
tests and their assertions ran in every process. Logs:
`grep-investigation-stdin.log` and `grep-investigation-stdin-*.log`. Ignoring an
unused stdin pipe is appropriate configuration, but these samples alone do not
prove it removes all native-spawn re-entry. Do not treat that result as a general
lifecycle correctness guarantee.

The listed Bun 1.4 changes do not explain this failure: stdout/stderr have data
listeners and resume; there is no accepted net socket, network lookup, or
intentional environment mutation in the search. The captured race loses events
before subscription, rather than merely reordering promise continuations after
exit and close. macOS first execution delays may change scheduling, but the
captured child already exited successfully and emitted every match long before
the deadline. Cold first-spawn runtime initialization is a plausible reason for
the first-test concentration; the narrower trigger inside native Bun spawn is
not established. Outside the test runner, 20 cold read-only directory searches
per runtime completed without premature events (`grep-investigation-cli*.log`),
so user-session prevalence is not established by this investigation.

### Recommended fix and verification

1. Fix the lifecycle assumption in production acquisition, not the result limit
   or timeout. In `grep/search-strategies.ts`'s `runBoundedGrepSubprocess`, use a
   Bun-native transport with piped, buffered stdout/stderr, `stdin: 'ignore'`,
   and the retained `exited` promise. Consume both streams concurrently through
   the existing bounded collector/framer and wait for both stream drains plus
   exit before resolving. Preserve semantic early stop, abort classification,
   process-group termination and bounded termination acknowledgement. Adapt the
   process termination handle/interface only as required; do not introduce an
   unbounded `execFile`/whole-output buffering path. The repository already uses
   this native stream plus `exited` pattern in
   `packages/core/src/services/shellJobGroup.ts:108-139`; tools must not import core.
   Keep any required Node transport separate. An event listener moved earlier
   *after* `spawn()` or an `exitCode` success shortcut cannot recover output that
   Bun already drained before returning.
2. Apply the same acquisition transport to `tools/ripGrep.ts:351-405`, whose
   post-spawn listeners have the same exposure, and cover the git availability
   probe at `search-strategies.ts:69-89`. Do not switch strategies or retry on
   invocation timeout. Ripgrep was not involved in the reported failure.
3. In `__tests__/grep-ephemeral-precedence.test.ts`, assert that `result.error` is
   undefined before extracting/counting text. Retain every exact match-count and
   truncation assertion. Add a fresh-process regression where a small search can
   complete before the caller starts reading, requiring all expected matches and
   no timeout. Also require a genuinely stalled child to return TIMEOUT, never a
   no-match success, while retaining existing cancellation and budget tests.
4. Verify the fresh-process regression, this file, git/system/ripgrep bounded
   acquisition, and termination tests on both runtimes, then a full suite under
   load. No retries, assertion relaxation, deadline increase, or warm-up fixture
   as a substitute for fixing lost output/settlement. Treat this as pre-existing
   when classifying issue3930 upgrade regressions. No OCR review was run.

## Lockfile repair: selderee, @selderee/plugin-htmlparser2, @pkgjs/parseargs

CI failed in every job at `bun install` with `Integrity check failed for tarball:
selderee` (and `@selderee/plugin-htmlparser2`). Locally the install passed only
because the Bun cache already held the tarballs.

### Cause

Not an npm or `min-release-age` bug, and not introduced by this branch. Commit
`c5010bce7` ("chore(release): bump main to v0.12.0", 2026-09-08) rewrote every
`"version": "0.11.0"` line in `package-lock.json` to `0.12.0`. 19 of the 22 hits
were the root and workspace entries. The other 3 were third-party packages that
happen to be at 0.11.0: `@pkgjs/parseargs`, `@selderee/plugin-htmlparser2` and
`selderee`. Their `resolved` URLs and integrity hashes stayed at 0.11.0, so the
entries were self-contradictory. Evidence:

- `sed 's/"version": "0.11.0"/"version": "0.12.0"/'` applied to the parent
  commit's `package-lock.json` is byte-identical to the file in `c5010bce7`.
- `scripts/version.ts` uses `npm version` and does not do a textual replace, so
  the blanket replace happened outside that script.
- `bun.lock` was updated correctly in that commit, which hid the problem: it kept
  `selderee@0.11.0` and `@selderee/plugin-htmlparser2@0.11.0`.
- On this branch `npm install --package-lock-only` and `npm update
  brace-expansion --package-lock-only` preserved the bad entries (npm trusts
  existing lock entries), and `rm bun.lock && bun install` migrated from that
  lockfile, so `bun.lock` became `selderee@0.12.0` with the 0.11.0 hash.
  The registry's real 0.12.0 hashes differ, hence the integrity failure.
  `@pkgjs/parseargs@0.12.0` does not exist on the registry at all; it is an
  optional dev dependency, so installs skipped it without failing.
- `html-to-text@9.0.5` requires `^0.11.0` for both selderee packages, which
  0.12.0 does not satisfy.

### Scan

`tmp/lockfix/scan.ts` (not committed) checks each `package-lock.json` entry for
version vs `resolved` URL version, every declared dependency range against the
version that resolves for it (hoisted and nested lookup, workspace links), every
`package-lock.json` entry against `bun.lock` (version and integrity), and every
`name@version` in both lockfiles against the registry's published integrity.
Before the fix it reported the three version/URL mismatches, the four resulting
range violations, three registry integrity mismatches in `bun.lock`, and one
unrelated drift (`source-map-js` 1.2.2 in `package-lock.json`, 1.2.1 in
`bun.lock`). Range hits for `shell-quote`, `uuid` and `@tootallnate/once` are
explained by root `overrides` and are not defects. After the fix it reports zero
problems.

### Fix

Removed the three bad entries from `package-lock.json`, ran
`npm install --package-lock-only`, then restored the `@pkgjs/parseargs` entry
with version 0.11.0 because npm does not re-add that optional dev entry once it
is deleted (npm leaves the restored entry untouched on a further run). The net
`package-lock.json` change is three `version` lines back to 0.11.0. Regenerated
`bun.lock` with `rm bun.lock && bun install`; the diff is the same three
packages plus `source-map-js` 1.2.1 to 1.2.2, which now matches
`package-lock.json`.

## CI round 2

CI on `0b3866c85` failed in two jobs after the lockfile repair let installs succeed. All four
causes are test bugs that Bun 1.3.14 happened to tolerate; none is in production code. Each file
passes on Bun 1.3.14 and fails (or races) on 1.4.4 before the fix. main has no push-triggered CI
run for these jobs, so the baseline is a local run of the unchanged tests under Bun 1.3.14
(`npm i bun@1.3.14` into a scratch dir), compared with Bun 1.4.4.

### A. Windows: `retains materialized Bun precedence and does not retry a failed application`

`scripts/tests/issue-2978-node-shim.bun.test.ts` asserted that the entry's `process.execPath`
string-equals the path the test placed the bundled Bun at. That path comes from `os.tmpdir()`,
which on the Windows runner is the 8.3 short form (`C:\Users\RUNNER~1\...`). Bun 1.3.14
reported `process.execPath` as it was spawned; Bun 1.4.4 reports the long form
(`C:\Users\runneradmin\...`). Same file, two spellings. The shim only execs the runtime and
never compares paths, so production code is unaffected. `makeLayout` now builds the layout from
`fs.realpathSync.native(tempRoot)`, so the path the launcher execs and the path the entry reports
are the same long spelling. The assertion stays an exact equality, and it still fails if the shim
picked the `@oven` payload instead of the bundled Bun. (Comparing canonical paths in the test body
was tried first and works, but the test file sits at the 800-line `max-lines` ceiling.)

### B1. `base + a malformed plugin install` failed with `ENOENT reading .../dist/index.ts`

`withIncompatibleManifestFixture` was synchronous and returned `run(root, pluginName)` (a
promise) from inside `try`, so the `finally` removed the fixture directory before the async body
had finished importing `dist/index.ts`. Bun 1.3.14 read the module file early enough that the
race went unnoticed; Bun 1.4.4 reads it later, after `rmSync`. Minimal repro (write file, start
`import()`, `rmSync` the directory, await the import): 1.3.14 prints `ok`, 1.4.4 rejects with
`ENOENT reading ...`. It passed on macOS only because of timing. The helper is now `async` and
awaits `run` before cleanup, as `withInstalledFixtureAsync` already does.

### B2. OCR transport lifecycle, three tests

Two independent Bun 1.4 behaviors, both matching Node:

- `ClientRequest.destroy()` before a response now emits an `error` event (`socket hang up`,
  ECONNRESET). Bun 1.3.14 stayed silent. The scenario scope destroys the requests it owns during
  teardown, and in the callback-throws path the request was destroyed before `proxyRequest`
  attached `request.once('error', reject)`. With no listener the event became an uncaught
  exception (`releases every registered resource...`, `preserves a throwing request callback...`).
  The scope now attaches a one-shot no-op `error` listener when it destroys a request itself;
  errors on requests the scenario still owns are untouched.
- `proxyRequest` built the URL with `url.pathname += pathSuffix`. For a bare origin the pathname
  is `/`, giving `//open`. Bun 1.3.14 normalized `//open` to `/open` on the wire; Bun 1.4.4 sends
  it literally (the minimal repro prints `url /open` on 1.3.14 and `url //open` on 1.4.4). The
  upstream saw no `/open` request, so `waitFor(openRequestSeen)` timed out and the timeout error
  became the aggregate's first error (`closes an internal sibling request...`). The helper now
  strips trailing slashes before appending a non-empty suffix.

## CI round 3

CI on `57faaf071` passed everything except one Windows Test-Infra Gate test:
`real CLI test-file child retry > selects the runner budget at each call while passing the session
env to children` (`packages/cli/test/run-bun-tests.test.ts`) failed after 4373 ms. The child
`bun test` printed `bun test v1.4.4` and the file header, then the test's 4000 ms per-file budget
expired before its 50 ms test reported.

### Baseline

Same job on other runs, Bun 1.3.14 (job logs saved under `tmp/ci3932/fix3/`), against this PR's
Bun 1.4.4 run:

| Run | Bun | selects the runner budget | kills a timed-out child | reaps a timed-out child |
| --- | --- | --- | --- | --- |
| issue2616-final 39857397592 | 1.3.14 | 1677 ms | 4938 ms | 4020 ms |
| issue2616-final 39788878407 | 1.3.14 | 1729 ms | 5095 ms | 4023 ms |
| issue2616-final 39669767025 | 1.3.14 | 3365 ms | 6620 ms | 4040 ms |
| issue3930 39867295886 | 1.4.4 | 4373 ms, failed | 5214 ms | 4019 ms |

(The other three Windows gate runs on 1.3.14 skipped this step.) The test was already at 3365 ms of
a 4000 ms budget on one 1.3.14 run, so the margin was thin before the migration. There is one
1.4.4 data point because earlier runs of this PR failed before this step.

### Cause

The child is not slow because of Bun 1.4.4, the session HOME/TMPDIR redirect, the new
`[install]` settings in `bunfig.toml`, or a freshly linked `bun.exe` (the runner spawns
`process.execPath`, the same Bun the outer test process runs on). `runTestFile` spawns
`bun test` with `cwd: process.cwd()`, which is `packages/cli` in the gate, so the child loads
`packages/cli/bunfig.toml` and its preloads: `test-setup-storage-isolation.ts` and
`bun-test-setup.ts` import `@vybestack/llxprt-code-core`, jsdom, react and ink, then
`storage-isolation` loads `SessionPersistenceService`. For a 50 ms test that is almost all of the
child's start-up.

Measured on macOS (trivial test file spawned the way `runTestFile` does it, 5 to 6 runs each,
`tmp/ci3932/fix3/measure.ts` and `bisect.ts`, not committed):

| Child | Bun 1.4.4 | Bun 1.3.14 |
| --- | --- | --- |
| cwd `packages/cli`, session env, fresh session (cold transpiler cache) | 1200 to 1300 ms | 1220 to 1300 ms |
| cwd `packages/cli`, plain env or reused session (warm cache) | 715 to 745 ms | 975 to 1030 ms |
| cwd with no bunfig, session env | 160 to 175 ms | 165 to 170 ms |
| session env variables applied one at a time, cwd with no bunfig | no change from 160 ms | not run |

A fresh session lands 1009 files (28 MB) in `<XDG_CACHE_HOME>/bun/@t@`, Bun's runtime transpiler
cache, because the preload graph is transpiled from scratch. The first real child in the test
process always pays that cost, and this test is the first. Disabling the cache
(`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`) saved about 100 ms on 1.4.4 and nothing on 1.3.14, so the
cache writes are not the main cost; the preload graph is. The Windows runner takes 1.7 to 4.4 s
for the same child, which fits the same cause on slower process start and file reads. I could not
run Windows here, so the Windows share of the cost between transpiling and file access is not
measured.

The same exposure exists in `kills a timed-out child and returns the passing retry` and `reaps a
timed-out child even when timeout notification throws`: both give a child under the same 4000 ms
budget and need it to reach the test body, where it writes a marker, before the budget expires.
They passed in this run because they only need start-up to finish before 4 s.

### Decision

The budget stays at 4000 ms and no assertion changes. Raising the budget would only add margin
for work these tests do not care about. The three tests check runner mechanics (budget selection,
env pass-through, kill and retry) and use a trivial child, so the preloads are not part of what they
test. Production `runTestFile` is unchanged: real runs need the preloads, and within one session
the warm cache already pays for them once.

The test file gains `withChildCwd(dir, run)`, which sets the working directory to the scratch
directory that holds the child's test file for the duration of the call and restores it in
`finally`. The three timing-sensitive tests run their children through it. Bun reads `bunfig.toml`
from the working directory, so the child starts without preloads. After the change the budget
test takes about 160 ms on macOS (previously about 1.2 s cold), and the file passes in 10.6 s.

## Guard coverage for nightly privileged jobs

`scripts/tests/supply-chain-pins.test.ts` classified every `nightly.yml` job as unprivileged. The
workflow grants `checks: write` and `statuses: write` at the workflow level, which jobs without their
own `permissions` block inherit, and `e2e_full` carries provider API keys. Neither matched the old
text markers, so restoring `npm rebuild bun` or dropping `--ignore-scripts` there went unnoticed.

`isPrivilegedJob` now computes each job's effective permissions (a job-level block replaces the
workflow-level one, which is inherited otherwise) and treats a job as privileged when they include
any `write` scope or `write-all`, or when the job references a secret other than `GITHUB_TOKEN`
(`secrets.X`, `secrets[...]`, `secrets: inherit`), on top of the registry-login and publish markers.
`windows_bun_native_smoke` and `cli_bundle_launch` stay unprivileged because each declares
`permissions: {contents: read}` and references no secrets; a test asserts that rather than exempting
them by name. New tests cover the permission logic and mutate `windows_ci`, `macos_ci` and `e2e_full`
in memory (restoring `npm rebuild bun`, dropping `--ignore-scripts`) to prove detection.

The stricter rule newly flagged three jobs that ran `npm ci` or a global `npm install` with
lifecycle scripts: `smoke-test.yml` (`issues: write`), `_evals-run.yml` (provider API key), and
`issue-planner.yml` (`issues: write`, API keys). The first two now use `npm ci --ignore-scripts`
followed by `node scripts/link-bun-runtime.ts` and `node scripts/postinstall.cjs`; the planner's
global install of the nightly package uses `--ignore-scripts`, as Luther's does. Note that a job
with no `permissions` anywhere falls back to the repository default token scope, which this guard
cannot see.

## CI round 4

CI on `238b8ad0e` (a docs-only commit) failed one Linux test that passed in the previous run:
`DiscoveredTool bounded acquisition > handles multibyte UTF-8 content without replacement
characters` (`packages/tools/src/__tests__/discovered-tool-bounded-acquisition.test.ts`, job
120161922176). The script is `printf "café 世界 ..."` and never reads stdin. The result carried
`discovered_tool_execution_error` with `Stdout: café 世界 ...`, `Error: Error: EPIPE: broken pipe,
write` and `Exit Code: (none)`.

### Cause

`DiscoveredTool.awaitProcessSettlement` (`packages/tools/src/tools/tool-registry.ts`) wrote the
parameters JSON to the child's stdin and registered the same `captureFirstError` handler on
`child.stdin` and on the child itself. That handler records the first error and calls `settle()`
immediately, which resolves before `exit`/`close`. An `EPIPE` on stdin therefore did two things at
once: it turned a child that exited 0 with the right output into an execution error, and it
resolved before the exit code was known, which is why the message says `Exit Code: (none)`. The
output was still present because stdout had been read before the error arrived.

A discovered tool that does not read its parameters is legitimate, and Node expects a writer to a
child's stdin to tolerate `EPIPE` and `ERR_STREAM_DESTROYED`. The result must come from the child's
exit status and output.

### Bun 1.4.4 role

Probe: `tmp/ci3932/fix5/probe.mjs` (not committed) spawns `sh -c 'printf x'` through
`node:child_process`, writes a payload to stdin, and counts `EPIPE` events on `child.stdin` and
their order against `exit`/`close`. 200 runs per row unless noted; every child exited 0.

| Payload | Load | Bun 1.4.4 EPIPE | Bun 1.3.14 EPIPE |
| --- | --- | --- | --- |
| 2 bytes (`{}`) | idle | 0 / 200 | 0 / 200 |
| 100 KB | idle | 0 / 200 | 1 / 200 |
| 2 MB | idle | 199 / 200 | 199 / 200 |
| 2 bytes, 4 probes in parallel plus 10 busy loops | loaded | 7 / 800 | 0 / 800 |

Every EPIPE arrived before the child's `exit` event; none arrived after `exit` or `close`. Large
payloads behave the same on both versions. The difference is the small payload under CPU load: when
the child exits before the parent's write reaches the pipe, 1.4.4 reports `EPIPE` on stdin where
1.3.14 reported nothing in 800 runs. That matches the Bun 1.4 note that socket and request errors
are emitted the way Node emits them. The mechanism inside Bun is inferred from this measurement;
I did not read Bun's source. The test sits at the intersection of an `{}` payload and a child that
exits at once, which is why it failed once in CI and passed in the neighbouring run. The code was
wrong on 1.3.14 as well, but only large payloads exposed it there.

### Fix

`isChildClosedStdinError` matches `EPIPE` and `ERR_STREAM_DESTROYED` by `code`. `writeParamsToStdin`
now owns the stdin `error` listener (`onStdinError`), which also handles the synchronous catch
around `write`/`end`: it ignores those two codes and forwards every other stdin error to
`captureFirstError`. The listener stays attached after settlement, so a late stdin error cannot
become an unhandled `error` event. Spawn errors on the child still use
`captureFirstError` directly and still fail. Settlement now waits for `exit`/`close` as for any
other child, so the exit code and signal are real. The first-failure semantics for real errors are
unchanged.

Other sites that write to a child's stdin were reviewed:

| Site | Outcome |
| --- | --- |
| `packages/core/src/hooks/hookRunner.ts` `writeToStdin` | Already ignores `EPIPE`; result comes from exit. No change. |
| `packages/core/src/services/shellJobGroup.ts` supervisor stdin | Already ignores `EPIPE`. No change. |
| `packages/core/src/services/ClipboardService.ts` | The clipboard program has to consume stdin, so a broken pipe is a real failure. No change. |
| `packages/lsp/src/service/lsp-client.ts` | Persistent protocol connection; a broken stdin means the server is gone. No change. |
| `packages/test-utils/src/process-run.ts`, CLI integration helpers | Test harnesses, not product paths. No change. |

### Tests

Two tests join `DiscoveredTool stdin EPIPE during early child exit`. Each child runs `exec 0<&-`
to close stdin, then prints; the parent writes 2 MiB, which cannot fit in any pipe buffer, so the
stdin write fails with `EPIPE` every time. One child exits 0 and the test expects no error and
`llmContent` exactly `unread-ok`. The other exits 3 and the test expects the exact message
`Stdout: unread-out ... Error: (none) / Exit Code: 3 / Signal: (none)`. Both failed 3 of 3 runs on
the previous implementation (`Exit Code: (none)` and an `EPIPE` error) and pass with the fix. The
existing multibyte test is unchanged.

### Signal test hang under load

With the fix applied, `a process killed by an unexpected signal is reported as failure, not success`
failed in 2 of 60 full-file loop runs while the machine load average was about 20. The test hit its
10 s timeout. Bun printed `killed 1 dangling process` and the tool then resolved with
`Stdout: (empty) / Error: (none) / Exit Code: (none) / Signal: SIGTERM`. The child's `echo` never
reached the parent, and no `exit` or `close` arrived for 10 s. The SIGTERM came from the runner's
cleanup, not from `DiscoveredTool`, which has no timeout of its own.

Listener placement: `execute()` calls `spawn()` and `awaitProcessSettlement` attaches the `data`,
`exit` and `close` listeners after `spawn()` returns. That is the structure described in #3934
(output and `close` emitted before listeners attach), so the failure looks like that issue. The
mechanism is not proved for `DiscoveredTool`.

Does the fix cause or worsen it? The change touches only the stdin `error` listener and the
settlement on stdin errors. The `data`/`exit`/`close` listeners and the settlement conditions are
unchanged, and a stdin error with a `{}` payload would have produced a wrong result on the old code
rather than hiding a hang. Runs, logs in `tmp/ci3932/fix6/`:

| Code | Runs | Load | Failures |
| --- | --- | --- | --- |
| original, signal test only | 300 (10 and 16 parallel workers) | parallel workers | 0 |
| original, full file | 18 (6 parallel, 6 busy loops) | high | 0 |
| fix, full file | 30 (6 parallel, 6 busy loops) | high | 0 |
| fix, full file (earlier, `fix5`) | 60 sequential | load average about 20 | 2 |

The rate is too low to compare the two versions. I did not reproduce the hang on the original code,
so I cannot say it fails there at the same rate. The hang is not in anything the fix changed, so the
fix stays as is and the lifecycle change is not widened into this PR. I commented on #3934 that
`DiscoveredTool.execute` is another affected site (issuecomment-6354812520).
