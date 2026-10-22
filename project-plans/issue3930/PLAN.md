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

See the audit section at the bottom (filled in after the final run).

## 5. Release job lifecycle scripts

Investigation (done on a copy of the tree with `npm ci --ignore-scripts`):

- Third-party install scripts present in the lockfile: `@ast-grep/lang-*`,
  `bun`, `esbuild` (dev), `msw` (dev), `node-pty` (optional), `tree-sitter-bash`,
  `tree-sitter-pwsh`. ast-grep languages and tree-sitter grammars ship
  `prebuilds/` and load without their scripts (verified by parsing C and Swift
  and importing tree-sitter-bash). esbuild and msw scripts are optimizations.
- `bun` is the exception: without its postinstall `node_modules/.bin/bun` is a
  stub that exits with "Bun's postinstall script was not run", and `npm run build`
  (which calls `bun scripts/build.ts` through npm's PATH) fails. So the release
  path runs exactly one rebuild: `npm rebuild bun` (it only copies the binary from
  the already-installed `@oven/bun-*` package).
- The root `postinstall` (`scripts/postinstall.cjs`) is first-party: it applies
  `patches/` (ink, react-devtools-core), strips npm peer flags, links workspaces,
  and installs Windows launchers. It is run explicitly with `node`.
- After `npm ci --ignore-scripts`, `npm rebuild bun`, `node scripts/postinstall.cjs`
  the full `npm run build` succeeded in the copy, and the shell parser and
  launcher test suites passed.

Changes: `npm ci --ignore-scripts` followed by a "Run first-party postinstall
(bun runtime, dependency patches)" step (`npm rebuild bun` + `node
scripts/postinstall.cjs`) in `release.yml`, `build-sandbox.yml`, `luther.yml`,
`e2e.yml` and in the three nightly jobs that run tests or E2E (`windows_ci`,
macOS shards, `e2e_full`).

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
