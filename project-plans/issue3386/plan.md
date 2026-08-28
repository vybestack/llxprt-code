# Issue #3386: Installed memory profiling and Ink cache retention

Plan ID: PLAN-20260827-ISSUE3386
Generated: 2026-08-27
Issue: https://github.com/vybestack/llxprt-code/issues/3386
Branch: `issue3386`

## Objective

Make the existing JSC memory profiler available through the published `llxprt`
command and through a repeatable tmux workload. Use that profiler to prove and
fix the measured retention of styled-character arrays in
`@jrichman/ink@6.4.8`.

This work must preserve ordinary launcher behavior. In particular, profiling
must not change unprofiled argv, stdio, signals, exit status, Bun selection, or
the fd 3 capability transport added in #3389.

## Proven problem

The source checkout already has a useful profiler under `scripts/memory/`, but
none of its entry points are shipped in `packages/cli`. An installed user cannot
start a profiled session, request a forced-GC sample, render a report, or analyze
a snapshot through the installed command.

Heap analysis also identified a concrete owner of retained memory. Ink keeps a
module-lifetime `toStyledCharactersCache`. Its `DataLimitedLruMap` budgets only
`key.length`, even though each value is an array containing one styled-character
object and a styles array per rendered character. A matched temporary bypass
reduced post-clear forced-GC growth from about 135.1 MiB to 68.3 MiB and removed
about 2.01 million retained objects. Extra-memory growth remained nearly the
same, which separates this object graph from the tokenizer/WASM high-water
mark.

The evidence does not show that Ink accounts for every byte in a long-running
process. It also does not establish Mnemonist backing-array occupancy as a
material production cause. The fix and its claims will stay within the measured
styled-character cache behavior.

## Requirements

### REQ-3386-1: Installed profile launch

**Requirement:** The published Node bin shim must recognize these forms:

- `llxprt --memprofile`
- `llxprt --memprofile=<interval-ms>`
- `--memprofile-dir <run-dir>`
- `--memprofile-snapshots`
- `--memprofile-max-heap-mb <positive-integer>`

**Behavior:**

- An exact `--memprofile` enables profiling with the existing default interval.
- `--memprofile=<value>` enables profiling and supplies the sampling interval.
- Profiling-control arguments are removed from the LLxprt argv and translated
  to the profiler launcher's existing option grammar.
- Every unrelated argument remains byte-for-byte and order-for-order unchanged.
- A missing option value, duplicate activation flag, empty attached interval,
  or invalid number fails before LLxprt starts, with usage text and a nonzero
  status.
- Similar strings such as `--memprofiled` do not activate profiling.
- Profiling flags without an activation flag remain ordinary LLxprt arguments,
  allowing the application parser to reject them consistently.

### REQ-3386-2: Installed profile utilities

**Requirement:** The published command must expose:

- `llxprt memprofile request [--heap] [--dir <run>]`
- `llxprt memprofile report [<samples-path-or-run-dir>]`
- `llxprt memprofile analyze <snapshot> [--top <n>] [--min-mb <n>]`

**Behavior:** The commands reuse the existing request, report, analyzer, lease,
permission, and path implementations. Unknown or missing subcommands fail with
installed-command usage text. No command imports a repository-local file at
runtime.

### REQ-3386-3: Published artifacts

**Requirement:** `prepack` must build and package install-safe Bun entry points
for the profile launcher, preload, request utility, report utility, and heap
analyzer alongside `bundle/llxprt.js`.

**Behavior:**

- Bundle outputs have stable names under `packages/cli/bundle/`.
- A failed profiler build fails `prepack`; a release must not silently omit the
  feature.
- Stale-bundle pruning preserves every output from the successful set of builds
  and removes outputs that are no longer produced.
- A packed-package test proves all outputs are present without depending on the
  repository after extraction.

Proposed output names:

- `bundle/memprofile-launcher.js`
- `bundle/memprofile-preload.js`
- `bundle/memprofile-request.js`
- `bundle/memprofile-report.js`
- `bundle/memprofile-analyze.js`

Separate `Bun.build` calls are preferred because each output needs a fixed name
and a distinct entry point. The existing single-entry `llxprt.js` build must not
be changed into an ambiguous multi-entry naming scheme.

### REQ-3386-4: Launcher semantics

**Requirement:** Profiled launches preserve the process contract of ordinary
installed launches.

**Behavior:**

- The Node shim uses the same resolved Bun executable for the profiler launcher.
- The profiler launcher starts the same resolved LLxprt entry that an ordinary
  launch would use.
- Stdio 0 through 2 is inherited.
- When `LLXPRT_CAPABILITY_FD=3` is present, fd 3 crosses both spawn boundaries.
  Each supervisor closes only its own copy after the child inherits it.
- `SIGINT`, `SIGTERM`, and `SIGHUP` targeted at either supervisor reach the CLI.
- Normal exit codes are preserved. Signal termination is not reported as
  success. Launcher failures retain exit 43 at the Node-shim boundary.
- Snapshot defaults, forced-GC sampling, heap guards, owner-only permissions,
  leases, request validation, and atomic publication remain unchanged.

### REQ-3386-5: Installed paths and privacy

**Requirement:** Installed profiling must have a stable, user-owned default
artifact root and retain explicit path overrides.

**Behavior:**

- Repository commands continue using the repository `.memprofile/` root.
- Installed commands use an install-independent user data root. The initial
  implementation will use `~/.llxprt/memprofile/` unless existing application
  directory helpers prove a different established path during preflight.
- `--memprofile-dir` and request `--dir` continue to accept explicit run paths.
- All run directories and files remain owner-only where POSIX permissions are
  available.
- Documentation states that samples and snapshots can contain source, prompts,
  tool output, provider data, credentials, and prior input, and must not be
  committed or uploaded.

### REQ-3386-6: Tmux development workload

**Requirement:** A checked-in tmux scenario must run the development CLI under
the source profiler without network access and create reproducible forced-GC
checkpoints.

**Behavior:**

- The scenario has fixed terminal dimensions.
- It uses the existing fake-provider seam and deterministic local output.
- It renders more than the old cache's effective working set with unique,
  high-entropy text, issues `/clear`, requests forced-GC samples through the
  filesystem protocol, and exits normally so the report is rendered.
- Artifacts are written under the harness's gitignored output directory.
- The scenario is reusable for stock-versus-fixed comparisons with no workload
  changes.

A small TypeScript output generator may be added for shell-mode steps. This
avoids committing a multi-megabyte fixture while still exercising the real Ink
render path. No new JavaScript files are permitted.

### REQ-3386-7: Value-aware Ink cache

**Requirement:** The pinned Ink cache must bound the retained styled-character
value graph, not only the source-string key length.

**Behavior:**

- Keep caching enabled for repeated rendering.
- Extend the cache budget to include a supplied value-size function.
- Configure the styled-character cache with a bounded cell budget. Start with a
  64 Ki-cell budget and adjust only if deterministic tests or measured runtime
  behavior justify a different bound.
- Eviction releases key and value references. A native insertion-ordered `Map`
  is acceptable if it gives clearer LRU and release semantics than the current
  Mnemonist wrapper.
- Oversized single entries are measured and handled without allowing the cache
  to exceed its limit.
- Narrow cache reset/statistics exports may be added to the patched Ink build so
  tests can prove the budget through the real conversion path. LLxprt
  production code must not depend on those exports.
- Root and CLI dependency declarations remain pinned to the same Ink version.
  This change is a patch to that pin, not an Ink 7.x upgrade.

### REQ-3386-8: Patch application

**Requirement:** Fresh npm and Bun workspace installs must apply the same Ink
patch before tests and release bundling.

**Behavior:**

- Use the existing `patch-package@8.0.1` dependency and a tracked patch under
  `patches/`.
- Update the existing `scripts/postinstall.cjs`; do not add a new JavaScript
  installer.
- Apply patches before the Bun-specific early exit and fail the workspace
  install when a tracked patch cannot be applied.
- A behavioral Ink test must fail on a fresh unpatched install and pass only
  after postinstall has applied the patch. That makes npm and Bun CI install
  paths exercise the mechanism rather than merely checking script text.
- Normal published launches use the patched, prebuilt `bundle/llxprt.js`.
  The existing forced source-entry escape hatch is not an installed support
  promise. Do not add a fallback that silently runs an unpatched dependency.

### REQ-3386-9: Measured proof

**Requirement:** The PR must contain deterministic regression coverage and
report a matched profiler comparison.

**Behavior:**

- The primary test drives Ink's real text conversion/cache path, exceeds the
  configured budget, and asserts that retained cache cells and entries remain
  bounded while repeated text still benefits from caching.
- A secondary forced-GC check may assert retained JSC heap growth with a generous
  bound, but it must not be the only regression guard.
- Run the exact tmux workload once with stock Ink and once with the patch.
- Record initial, post-workload, and post-clear sample deltas from the generated
  reports. Use heap snapshots only when the existing heap guard allows them.
- Do not commit profile artifacts. Summarize measured numbers in the eventual PR
  body and identify other memory classes as unattributed unless the new evidence
  proves ownership.

## Design

### 1. Pure dispatch in the Node shim

Add a small parser in `packages/cli/bin/llxprt.mjs` that returns one of three
invocations:

1. ordinary LLxprt entry plus unchanged argv;
2. profile launcher plus translated profiler and LLxprt argv;
3. one installed utility bundle plus its argv.

Keep Bun resolution, stdio construction, signal forwarding, and child exit
handling in the existing single spawn path. Only entry selection, argv, and the
installed profiler-root environment differ. Missing required profile artifacts
use the existing launcher-failure style and exit 43.

### 2. Parameterized TypeScript profiler runtime

Refactor `scripts/memory/launcher.ts` so its tested parser and lifecycle can run
with an explicit runtime description:

- usage label;
- LLxprt entry path;
- preload path;
- working directory;
- package version;
- default profile root;
- development environment setup on or off.

The source main supplies repository paths and current development behavior. A
new TypeScript installed entry supplies bundle-relative paths, a user data root,
and production environment behavior. Change custom main detection to a form
that remains false when the module is imported into another Bun entry point.

Apply the same narrow parameterization to request and report defaults. The
analyzer already requires an explicit snapshot path. Shared parsing and report
logic remain in their current modules.

### 3. Capability and signal forwarding in the profiler layer

The profiler launcher is a real supervisor and must forward more than stdio
0 through 2. Build its child stdio from `LLXPRT_CAPABILITY_FD` using the same
accepted descriptor contract as the Node shim. Close the supervisor copy after
spawn. Register and remove the same three signal handlers. Re-raise a child
signal or otherwise preserve non-success signal semantics without leaving an
orphan.

This is a production change and requires a failing behavioral test before the
implementation.

### 4. Build and package

Create TypeScript-only installed entry points under `scripts/memory/`. They are
build inputs, not published source dependencies. Add explicit Bun build configs
and collect all successful output paths before stale pruning. The package's
existing `files: ["bundle", ...]` entry then includes the profiler artifacts.

Tests must inspect a real package tarball or an equivalent release-pack helper
result. A fixture that merely copies source files does not prove packaging.

### 5. Ink patch

Generate a `patch-package` patch against the installed `ink` alias directory.
The patch will change Ink's `DataLimitedLruMap` implementation and declarations,
configure the styled-character cache's value sizing and smaller budget, and add
only the observability needed for behavioral tests. It must not patch LLxprt's
copy of generated bundle output because bundles are rebuilt during prepack.

### 6. Tmux proof

Add one deterministic TypeScript text generator and one tmux JSON scenario. The
scenario starts:

```text
${bun} scripts/memory/launcher.ts ... -- --provider fake --model fake-model
```

through a shell wrapper that can read `LLXPRT_TMUX_ARTIFACT_DIR` for its run
directory. Shell-mode steps render seeded output, and `mem:request` steps create
forced-GC checkpoints. The stock and fixed runs use separate paths under
`tmp/issue3386/`.

## Test-first execution

Every production step below follows RED, GREEN, REFACTOR. Preserve the failing
output for each RED phase in the implementation handoff notes.

### Phase 0: Preflight

1. Confirm `issue3386` is clean and based on `2fadb59ac`.
2. Run focused existing launcher, memory, build, and package tests.
3. Confirm the actual capability marker name from the current shim and use it
   consistently. The current source says `LLXPRT_CAPABILITY_FD=3`.
4. Confirm Bun's bundled-entry behavior for `import.meta.main` with a tiny
   gitignored experiment before changing module guards.
5. Confirm `patch-package ink` produces a patch that targets
   `node_modules/ink`, despite the package's internal name
   `@jrichman/ink`.
6. Confirm the established application directory helper or document the direct
   `~/.llxprt/memprofile` derivation.
7. Run the test-audit scanner on `main` into a unique `tmp/issue3386/` baseline.

Stop and amend this plan if any assumption fails.

### Phase 1 RED: Node-shim dispatch

Extend the existing TypeScript Bun launcher suite against the real
`packages/cli/bin/llxprt.mjs` fixture. Add failing cases for:

- ordinary argv remains unchanged;
- exact bare and attached profile activation;
- control-argument stripping and translation;
- control arguments before, between, and after ordinary arguments;
- nonmatching flag text;
- malformed, duplicate, and missing values;
- each `memprofile` subcommand;
- unknown/missing subcommand;
- missing profiler artifact exits 43;
- profiled child exit propagation;
- fd 3 reaches the selected profiler entry.

### Phase 1 GREEN: Node-shim dispatch

Implement the smallest parser and invocation selection needed to pass. Keep one
spawn/signal/exit implementation. Do not introduce a second Bun resolver or a
second copy of the fd-forwarding logic.

### Phase 2 RED: Parameterized profiler lifecycle

Extend co-located memory launcher and utility tests for:

- source and installed runtime paths;
- installed default root;
- development-only environment variables absent in installed mode;
- installed usage strings;
- utility default roots and explicit path precedence;
- fd 3 across the profiler-to-CLI boundary;
- targeted signal forwarding and cleanup;
- unchanged exit code and report-failure precedence.

Use real child processes and temporary directories. Do not mock the launcher or
assert only that `spawn` was called.

### Phase 2 GREEN: Installed TypeScript entries

Parameterize the current modules and add installed launcher/request/report/
analyzer entry points. Bundle and execute them in focused tests. Preserve all
probe safety and privacy behavior.

### Phase 3 RED: Build and package

Add failing Bun tests that require every stable profiler bundle name after
`buildCliBundle()`, prove stale pruning keeps the complete fresh output set, and
inspect a real packed package from outside the repository tree.

The packed smoke must execute at least:

- installed `--memprofile` against a deterministic short-lived CLI entry;
- `memprofile report` against a fixture run;
- one utility error path;
- ordinary unprofiled launch as a regression control.

### Phase 3 GREEN: Build and package

Add separate build configs and aggregate their outputs before pruning/staging.
Keep the existing `prepack` contract. Do not publish `scripts/memory/` as runtime
source.

### Phase 4 RED: Ink retention

Before changing `node_modules/ink`, add a TypeScript Bun test that drives the real
styled-character conversion path with deterministic unique strings beyond the
planned cell budget. The test must fail against stock 6.4.8 because the cache
retains more value cells than allowed. Include a repeated-string case that
proves the cache remains functional.

### Phase 4 baseline profile

With stock Ink still installed, add the deterministic tmux scenario and run it.
Save its sensitive artifacts only under `tmp/issue3386/stock/`. Render and retain
textual report numbers for comparison, but do not stage the artifacts.

### Phase 4 GREEN: Ink patch

Modify the installed Ink files only long enough to generate the tracked
`patches/ink+6.4.8.patch`. Update the existing postinstall path so fresh npm and
Bun installs apply it before tests/builds. Run the failing cache test until it
passes.

Run a clean patch-application check in a disposable copy or install tree. Do not
claim npm/Bun compatibility solely because the already-modified local
`node_modules` passes.

### Phase 4 fixed profile

Run the same tmux scenario into `tmp/issue3386/fixed/`. Compare the same forced-GC
sample positions and render reports with the existing tools. If the change does
not materially reduce the styled-character/object retention signature, stop and
investigate rather than weakening the test.

### Phase 5: Refactor and documentation

Remove duplication exposed by the passing tests. Update the existing memory
profiling documentation with installed grammar, development/tmux usage, artifact
location, snapshot guard, request/report/analyze examples, and the privacy
warning. Do not include profile artifacts or machine-specific paths.

## Focused verification

Run each touched test file directly with Bun while iterating. The final focused
set must include:

```bash
bun test scripts/memory
bun test scripts/tests/issue-2978-node-shim.bun.test.ts
bun test scripts/tests/issue-2603-release-install.test.ts
bun test scripts/tests/issue-3386-ink-cache.bun.test.ts
bun scripts/bun-build.config.ts --cli-only
```

Use the actual final test paths if implementation extends an existing suite
instead of creating an issue-named suite.

Run the test-audit scanner on all touched tests and diff against the preflight
baseline:

```bash
bun scripts/test-audit/scan.ts tmp/issue3386/test-audit-branch
diff tmp/issue3386/test-audit-main/findings.tsv tmp/issue3386/test-audit-branch/findings.tsv
```

No new `MOCK_MIRROR`, `ALWAYS_TRUE`, `SELF_CONFIRMING`, or `NO_ASSERT` findings
are acceptable.

## Full verification gate

Run the complete repository cycle after implementation and after each review
remediation:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Verification logs must use unique paths under `tmp/issue3386/`, never shared
bare `/tmp` names.

## Review and delivery

1. Delegate implementation to `typescriptexpert` with this plan and the measured
   retention evidence.
2. Delegate a full review to `deepthinker`; allow at most one remediation and a
   second review.
3. Run detached `ocr review --audience agent --timeout 20` with output under the
   repository `tmp/issue3386/` directory. Address every finding; allow at most
   two OCR rounds.
4. Inspect `git status`, `git diff HEAD`, and recent commit style. Commit only
   tracked implementation, tests, docs, plan, and dependency patch files.
5. Create one PR with `Fixes #3386`, installed smoke details, and the matched
   memory measurements.
6. Watch CI and CodeRabbit to completion, resolve actionable threads, and rerun
   verification after changes.
7. Report when CI is green and review threads are resolved. Do not merge without
   explicit user authorization.

## Out of scope

- Claiming that Ink explains the full multi-gigabyte process footprint.
- Replacing or upgrading to Ink 7.x.
- Changing tokenizer/WASM allocation behavior.
- Treating telemetry samples as a substitute for forced-GC profiler samples.
- Committing or uploading heap snapshots, sample logs, prompts, provider data,
  credentials, or other profile artifacts.
- Adding new JavaScript files or a second installer framework.

## Implementation outcome

### Delivered behavior

The implementation exposes profiling from installed packages through
`llxprt --memprofile`, the supported controls, and
`llxprt memprofile request|report|analyze`. The release build emits five fixed
profiler bundle names beside `llxprt.js`, and the Node shim starts those bundles
without importing repository source at runtime. Ordinary launch arguments,
stdio, signals, child status, Bun selection, and capability fd 3 retain their
existing behavior.

The Ink 6.4.8 patch replaces the styled-character cache backing with an
insertion-ordered `Map`. It refreshes recency on hits and limits retained data by
combined source-key length and styled-character array length. The cache permits
at most 10,000 entries and 65,536 combined units. An entry larger than the whole
budget is returned without being cached. Postinstall applies the tracked patch
before package-manager-specific handling and fails when patch application
fails.

### TDD evidence

Ignored RED and GREEN logs under `tmp/issue3386/` record these behavioral steps:

- Installed profile dispatch first failed because the Node shim treated profile
  controls as normal CLI arguments, then passed with exact activation, control
  stripping, utility dispatch, signal forwarding, exit propagation, and fd 3
  coverage.
- Installed runtime and package tests first failed because profiler bundles did
  not exist, then passed against release-like packed and extracted packages.
- The Ink behavioral test first failed against stock 6.4.8 because the cache had
  no bounded retained-value accounting, then passed after applying the tracked
  patch through the real text-to-styled-character path.
- The deterministic tmux contract first failed before the scenario and output
  generator existed, then passed with fixed dimensions, seeded local output,
  three manual forced-GC checkpoints, `/clear`, and normal exit.
- Disposable npm and Bun-style install checks applied `ink@6.4.8` successfully.

### Matched retention evidence

The corrected baseline is `tmp/issue3386/stock2/`; the earlier `stock/` attempt
is not used because its fake-provider sequence ended before a valid comparison.
Both retained comparisons use the same workload, terminal dimensions, fake
provider, and manual forced-GC checkpoint positions.

| Run | Checkpoint | Heap MiB | RSS MiB | Objects |
| --- | --- | ---: | ---: | ---: |
| Stock Ink | Before workload | 180.0439 | 532.5938 | 812,330 |
| Stock Ink | After workload | 183.4159 | 596.9531 | 1,075,479 |
| Stock Ink | After `/clear` | 186.1933 | 597.2813 | 1,019,053 |
| Patched Ink | Before workload | 182.9592 | 511.5156 | 826,348 |
| Patched Ink | After workload | 179.9999 | 345.0313 | 982,400 |
| Patched Ink | After `/clear` | 182.6362 | 347.7656 | 924,538 |

Stock baseline-to-post-clear growth was 6.1494 MiB of heap and 206,723 objects.
The patched run changed by -0.3230 MiB of heap and 98,190 objects. The matched
difference is 6.4725 MiB less heap growth and 108,533 fewer growing objects,
which is a 52.5% reduction in net object growth. RSS moved by +64.6875 MiB in
the stock run and -163.7500 MiB in the patched run, but RSS includes allocator
and operating-system behavior and is not used as the ownership claim.

This deterministic workload did not reproduce the reported multi-gigabyte
production growth rate. The evidence supports bounded styled-character cache
retention and lower measured heap/object growth. It does not attribute the
remaining process footprint or tokenizer/WASM memory to Ink.

### Verification and audit

Focused memory, installed shim, package-install, release bundle, Ink cache,
postinstall, and tmux workload tests passed. After all accepted review fixes and
lint structure remediation, the final serial repository cycle completed with
`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and the required `stepfun-37` haiku smoke all returning status
0. The formatter only wrapped lines in two tests; both affected tests passed
again before the build. The packed profiler acceptance passed 5 tests with 21
expectations, and the release-like install acceptance passed 5 tests with 16
expectations. The final source-profiler smoke returned status 0 and recorded
startup and exit forced-GC samples before printing its report.

The final audit used the default scanner roots plus supplemental
`scripts/memory` coverage on this branch and on a detached clean `main`
worktree. Findings were normalized by file, test, flag, and detail. Each default
scan contained the same 469 prohibited findings, leaving zero branch-only
`MOCK_MIRROR`, `ALWAYS_TRUE`, `SELF_CONFIRMING`, or `NO_ASSERT` findings. The
supplemental scans contained none. Manual inspection of every finding in touched
test files found no unsupported oracle, including the unchanged request test
whose bounded `waitFor` predicate is its behavioral assertion. The detached
worktree remained clean and was removed.

### Independent review status

The first complete-diff deep review found three clear in-scope defects. Publish
could succeed without fresh bundles, profile activation preflight checked only
the launcher bundle, and installed recovery text named the source command. All
three were fixed with behavioral tests. Prepack now requires dependencies and
all six fresh outputs, profile activation preflights launcher, preload, and CLI
bundles, and installed utilities recommend `llxprt --memprofile`.

The permitted second deep review found seven clear in-scope defects. The
remediation made patch failures fatal, made lease refusal durable and fatal,
installed supervision before the startup window, added request-specific bounded
waiting, added packed/global profiling smoke coverage, proved fresh stock-to-
patched installs, and eliminated duplicate POSIX terminal signals while defining
the Windows signal policy. Focused RED and GREEN logs for each item remain under
ignored `tmp/issue3386/`.

Detached Open Code Review completed against every changed and untracked issue
file. Its 25 findings were classified as follows:

| Finding | Classification | Resolution |
| --- | --- | --- |
| Storage resolver deep import | In-scope-Fix | Replaced with the package's public export. |
| Entrypoint path equality | In-scope-Fix | Added real-path comparison and Windows case normalization. |
| Installed-entrypoint helper duplication | Reject | Rejected because no behavioral defect was shown. |
| Capability fd close could orphan a child | Reject | Rejected after an empirical closed-fd test showed synchronous `EBADF` before child creation. |
| `--wait` completion wording | In-scope-Fix | Changed to neutral processed wording and directed users to `probe.log`. |
| Nested synchronous timeout | In-scope-Fix | Passed the timeout to the inner child and kept the wrapper bound slightly larger. |
| Literal Node capture wrapper | Reject | Rejected because Node is the deliberate workaround for Bun descriptor capture and Node 24 is required. |
| Capture directories retained | Reject | Rejected because callers own and remove the temporary roots. |
| Installed launcher fixture cleanup | In-scope-Fix | Added failure-path cleanup. |
| Capture root assumes `tmp/` exists | In-scope-Fix | Added recursive capture-root creation in the shared helper. |
| Parser children inherit `DEV` and `NODE_OPTIONS` | In-scope-Fix | Removed both variables from utility child environments. |
| Async signal tests can leak children | In-scope-Fix | Added safety timers and final cleanup for supervisors, applications, and FIFO readers. |
| Installed-root separator check | In-scope-Fix | Replaced a literal slash with the platform separator. |
| Patch command can run without a bound | In-scope-Fix | Added a bounded patch-process timeout. |
| `patch-package` is a root development dependency | Reject | Rejected because the root is private and the public CLI ships prebuilt patched bundles. |
| Postinstall test assumes stderr capture | In-scope-Fix | Guarded missing capture files and surfaced wrapper errors. |
| Release-copy dependency link could be mutated | Reject | Rejected because the clean-copy prepack reads the link and does not mutate dependencies. |
| Release smoke does not prove sample publication | In-scope-Fix | Added an explicit `samples.jsonl` existence assertion. |
| Bundle test assumes `tmp/` exists | In-scope-Fix | Resolved by the shared recursive capture-root fix. |
| Numeric controls accept alternate JavaScript notation | In-scope-Fix | Restricted controls to decimal digits before range validation. |
| Duplicate profile controls are ambiguous | In-scope-Fix | Rejected repeated directory, snapshot, and maximum-heap controls. |
| Node-shim tests read absent captures | In-scope-Fix | Added guarded capture reads and child-spawn diagnostics. |
| Numeric-limit test mirrors production constants | In-scope-Fix | Imported production limits and parsed shim literals for drift checks. |
| Runtime separator changes ordinary argv | Reject | Rejected after an empirical bundled-Bun check showed unchanged ordinary argv. |
| Shared bundle cleanup ownership | Reject | Rejected because it follows the existing build-test ownership convention. |
| Installed-profiler child timeout exceeds test timeout | In-scope-Fix | Reduced the child timeout below the enclosing test bound. |

All accepted OCR findings have focused behavioral evidence. The rejected items
either lacked a supported defect or conflicted with measured runtime and package
behavior. No further deep review is permitted by this plan. The local OCR round
completed before the pull request review cycle described below.

### Pull request CI and review remediation

The first pull request run exposed three platform and test-discovery defects. The
test coverage guard did not discover the two tests under `scripts/memory`, Bun's
shared install cache could retain an already-patched Ink tree, and in-process
`Bun.build()` calls failed on Windows with Bun's internal `Unexpected reading
file` resolver error after the test runner loaded workspace imports.
Consolidating six builds into one did not isolate that process-level state, as
the second Windows run confirmed. The tests now live under
`scripts/tests/memory`, the install proof uses a fixture-local Bun cache, and the
parser fixture runs one multi-entry build in a fresh Bun process with explicit
artifact checks and destinations.

Every actionable pull request finding received a source and runtime review. The
resulting classifications are:

| Finding | Classification | Resolution |
| --- | --- | --- |
| Memory tests outside discovered test roots | In-scope-Fix | Moved both tests under `scripts/tests/memory`; the coverage guard reports zero uncovered and zero doubly executed files. |
| File symlink is not portable to Windows | In-scope-Fix | The entrypoint test now uses a directory junction on Windows and a directory symlink elsewhere. |
| Entrypoint real-path lookup can throw | In-scope-Fix | Path comparison now returns false when either path cannot be resolved, with a missing-path regression test. |
| Release capture cleanup can fail on Windows handles | In-scope-Fix | Capture-directory removal is best effort after process-tree cleanup. |
| Signal test timeout is shorter than its two waits | In-scope-Fix | Raised the enclosing test timeout above both bounded waits. |
| `ProfilerArtifact` type is duplicated | In-scope-Fix | Exported the helper type and imported it at the call site. |
| Installed-bundle test deletes existing output | In-scope-Fix | The test backs up the complete bundle tree before replacement and restores it afterward; byte hashes before and after acceptance match. |
| Request completion text implies successful action | In-scope-Fix | Changed the text to say the probe finished handling the request and retained the pointer to refusal details. |
| Parser fixture hits Bun's Windows resolver failure | In-scope-Fix | Replaced six in-process builds with one multi-entry build in a fresh Bun process and asserted every source and installed destination. |
| Parser fixture can leak after setup failure | In-scope-Fix | Tracks the temporary root before building so teardown can always remove it. |
| Twenty-millisecond wait test is scheduler-sensitive | In-scope-Fix | Increased the bounded test wait to 200 milliseconds. |
| Synchronous workflow helper errors escape Promise assertions | In-scope-Fix | Runs synchronous capture inside the Promise executor so thrown errors reject. |
| Output-generator usage omits the first-character rule | In-scope-Fix | Usage now states that the first seed character must be alphanumeric. |
| Shared Bun install cache can invalidate the stock proof | In-scope-Fix | Uses a fixture-local `BUN_INSTALL_CACHE_DIR` for npm and Bun installation cases. |
| Zero-capacity Ink cache can loop | Reject | Cache capacities are private positive constants and no runtime path can provide zero or a negative value. |
| Outer Bun `--` changes application arguments | Reject | Bun consumes that runtime-to-script separator; measured shim tests show the application receives the intended arguments. |
| Bundled Bun executable needs a platform-specific name | Reject | The verified macOS `bun` package in this checkout uses `bun.exe`; selecting by `process.platform` would break that layout. |
| Successful captures should serialize `spawnError: null` | Reject | Optional serialization omits the property on success, so the parsed value is intentionally undefined. |
| Node `-e` wrappers should start supplied arguments at index 2 | Reject | Measured Node behavior places the first supplied argument at `process.argv[1]`. |
| Process-capture helper ignores `cwd` | Reject | The outer wrapper starts in the requested directory and the inner process inherits it. |
| Bun resolution should be lazy in Bun-native tests | Reject | These test modules already require Bun to load and execute. |
| PID fixture writes to the wrong Node argument | Reject | The current `process.argv[1]` target is the first supplied argument under Node `-e`, and the orphan regression passes. |
| Preserve a null inner status through the wrapper | Reject | The helper contract returns a numeric wrapper status; callers do not consume inner signal identity, while outer wrapper spawn failures still throw. |
| Packaging should tolerate missing dependencies | Reject | Publishable packaging must fail before emitting incomplete bundles. |
| Ink tests should avoid patched private symbols | Reject | Ink is version-pinned and the narrow test-only exports provide deterministic cache-bound evidence unavailable through the public API. |
| Release smoke should recover from malformed sample JSON | Reject | The test runtime atomically writes its own samples; malformed output is a test failure rather than external input to recover from. |
| Detached profiling with inherited TTY input can stop | Reject | The deterministic tmux workload exercised an actual TTY and completed without the proposed stop. |
| Postinstall test should omit Bun when Bun is unavailable | Reject | The file is a Bun test and cannot execute without Bun; both package-manager paths are required acceptance cases. |
| Installer timeout may leave package-manager descendants | Defer | The risk is limited to the timeout path. A cross-platform process-tree supervisor is a broader test-harness change, while normal npm and Bun completion leaves no descendants. |
| Docstring and changed-file coverage warnings | Reject | The repository has no policy requiring low-value comments or line coverage percentages for these script tests. Behavioral assertions cover the changed contracts. |
| Profiler bundles omit directory-sensitive externals | In-scope-Fix | Applied the same external set as the published CLI, preventing future profiler imports from inlining packages that resolve assets relative to their installed directories. |
| Windows profiling ignores Ctrl+C | Reject | Windows delivers console Ctrl+C to every process in the shared console group. The shim and launcher ignore duplicate delivery while the application receives the signal directly. |
| Entrypoint comparison should recover from malformed URLs | Reject | The URL is the module's internal `import.meta.url`, not external input; an invalid value means the module contract is broken and should fail at its source. |
| Installed-entry marker depends on fragile import order | Reject | Each wrapper sets the marker synchronously before awaiting the dynamic implementation import, whose evaluation cannot begin before that call completes. |
| Installed dynamic-import failure needs recovery | Reject | A failed implementation import is a startup defect and the top-level await terminates that one-shot utility; no later implementation import runs in the same process. |
| Pointer tightening can replace the child exit | Reject | `tightenLatestPointer` already catches filesystem errors and reports them without throwing. |
| Output generation is quadratic | Reject | Modern JavaScript engines use concatenation representations rather than copying the complete prefix for every character. Width is bounded at 4,096, and the deterministic memory workload uses 96 columns. |
| Lease-refusal logging bypasses probe cleanup | Reject | No lease or handlers have been acquired on the refusal branch. A logging failure remains a fatal startup filesystem error rather than a recoverable profiling state. |
| npm prefix configuration can redirect the local install proof | Reject | The test runs a local install from the fixture package root; npm's prefix setting governs global installation and does not relocate this local `node_modules`. |
| Capture-helper timeout grace is undocumented | In-scope-Fix | Documented that the outer one-second grace lets the wrapper publish the inner child's bounded timeout result before the wrapper guard fires. |
| Source-entry predicate name is inverted | Reject | The predicate returns true only for a directly invoked source entry and false for installed wrappers; `isSourceMemoryEntrypoint` names that result directly. |
| Snapshot heap cap exists only in the shim | Reject | `probe.ts` parses `LLXPRT_MEM_MAX_HEAP_MB` with `MAX_SNAPSHOT_HEAP_MB_LIMIT` and enforces the parsed guard before snapshot capture. |
| Bundle-test process diagnostics use fields absent from capture results | Reject | The shared shape also accepts direct `spawnSync` results from the build path, where `signal` and `error` are present; optional fields let one formatter handle both process sources. |

No additional broad review round is permitted. The pull request OCR and
CodeRabbit runs supply the second review cycle, and this remediation verifies
those findings without widening scope.

### Final verification after pull request remediation

- `npm run test` passed the complete serial suite after the isolated parser
  correction. Its primary runner reported 9,216 tests passed, 0 failed, 5
  skipped, and 13 todo; the subsequent isolated workspace suites also passed.
  Bun emitted its known directory-mismatch diagnostic for the isolated VS Code
  companion tests without changing the exit status.
- The complete post-format `scripts/tests/memory` suite passed 240 tests with 0
  failures and 622 expectations across 16 files. This run exercised the final
  isolated parser fixture from a stable source snapshot.
- `npm run lint`, `npm run typecheck`, the final `npm run format`, and
  `npm run build` passed after all review changes.
- Installed-profiler bundle acceptance passed 5 tests and 21 expectations. The
  source bundle directory was absent before and after the run, confirming exact
  cleanup restoration. Release-like npm and Bun install acceptance passed 5
  tests and 16 expectations.
- The `stepfun-37` startup smoke exited 0 and returned a three-line haiku.
- A fresh source-profiler smoke exited 0, printed version `0.11.0`, published
  `startup` and `exit` samples, and rendered the same report automatically and
  through `npm run mem:report`.
- The test-discovery coverage guard reports zero uncovered and zero doubly
  executed test files after the relocations.
- The final false-green audit found 469 normalized prohibited findings on both
  the branch and detached `origin/main`, with zero branch-only findings. The
  supplemental `scripts/memory` scans found zero findings on both revisions.

### Validated Ink retention completion

A focused source audit checked five specific claims raised after the first pull
request cycle. All five were supported by the installed Ink source and the
issue's acceptance requirements:

| Finding | Classification | Resolution |
| --- | --- | --- |
| Ink retains completed static output for the renderer lifetime | In-scope-Fix | Replaced the lifetime string with whole bounded chunks. Retention is limited to 4 MiB of UTF-16 code units and 1,024 chunks. An individually oversized current chunk is rendered but not retained. |
| Ink's character-width cache is unbounded | In-scope-Fix | Reused the bounded LRU with limits of 10,000 entries and 65,536 retained key code units. Hits refresh recency. |
| Installed-profiler acceptance runs nowhere | In-scope-Fix | The nightly bundle job now executes the five-case installed-profiler suite under its existing build-test gate. The suite contains five cases, correcting an external claim that it contained seven. |
| Publishable builds do not prove the Ink patch is present | In-scope-Fix | Added patch marker version 2 and a fail-fast build guard. Fixture tests accept version 2 and reject stale or absent markers. |
| No automated test runs the real retention workload | In-scope-Fix | Interactive UI CI now runs the standard-buffer tmux scenario, requires exactly three forced-GC manual samples, and checks post-clear growth. |

The width-cache tests exercise multi-code-unit grapheme churn and an independent
10,000-entry workload. They assert retained code-unit accounting, LRU recency,
and eviction. Static-output tests assert code-unit eviction, chunk-count
eviction, and current-frame rendering without retention for an oversized chunk.
The complete Ink behavior suite passes eight tests with 1,053 expectations.

The real workload now emits four distinct 3,000 by 400 output sets, totaling 4.8
million generated characters. This crosses the 4 MiB static-output retention
budget. Initial runs stopped on two harness issues before evaluating retention:
a local theme dialog appeared when `NO_COLOR` was absent, and synchronous output
writes returned `EAGAIN` under the TTY workload. The scenario now fixes color
selection explicitly, sends a second Escape when leaving shell mode after a
completed command, and the generator publishes bounded 64 KiB chunks while
respecting stdout backpressure.

The completed real tmux run passed. Its forced-GC manual samples measured:

- Baseline: 185,160,599 heap bytes, 557,072,384 RSS bytes, and 796,642 objects.
- Post-workload: 189,183,688 heap bytes, 601,456,640 RSS bytes, and 835,155 objects.
- Post-clear: 190,156,809 heap bytes, 607,027,200 RSS bytes, and 835,548 objects.

Post-clear growth from baseline was 4,996,210 heap bytes, 49,954,816 RSS bytes,
and 38,906 objects. The initial regression limits were 16 MiB heap, 64 MiB RSS,
and 180,000 objects. Replacement Linux CI later measured the fixed workload at
1,022,061 bytes of heap growth, 71,516,160 bytes of RSS growth, and 35,211
additional objects. The heap and object measurements remained below their
limits, but process-wide RSS crossed the initial limit by 4,407,296 bytes as the
allocator moved from 440,328,192 bytes after the workload to 583,221,248 bytes
after clear. The RSS allowance is now 96 MiB and the exact Linux profile is a
regression fixture. The previously measured stock profile remains rejected by
its 206,723-object growth. These counters describe the complete process and do
not attribute every retained object or RSS byte to Ink.

Fresh fixture installations under npm and Bun both applied the regenerated
`ink@6.4.8` patch and passed the behavioral guard. The guard now also requires
patch marker version 2, so the earlier styled-cache-only patch is insufficient.

### Profiler evidence-language corrections

The report now treats `protectedObjectCount` as an observed counter. Growth does
not identify the retainer and does not prove native ownership. `heapSize` and
`extraMemorySize` remain separate and are never added. The source analyzer usage
now names the executable command, `npm run mem:analyze --`, and the documentation
states that analysis holds snapshot text and parsed graph structures at the same
time. Peak analyzer memory can therefore be several times the snapshot file
size.

### Final retention-remediation verification

After the width-cache, static-output, build-guard, workload, and evidence-language
changes, the complete serial verification cycle passed:

- `npm run test` returned status 0. The primary runner reported 9,216 passed, 0
  failed, 5 skipped, and 13 todo tests; every subsequent isolated workspace suite
  also passed. A scan of the complete log found no failure signatures.
- The test-discovery guard reported zero uncovered and zero doubly executed test
  files. The focused retention, build-guard, checkpoint, workload, generator, and
  report suites passed 42 tests with 1,178 expectations. The complete
  `scripts/tests/memory` suite passed 240 tests with 622 expectations.
- `npm run format`, `npm run lint`, `npm run typecheck`, and `npm run build` all
  returned status 0. The build exercised the exact-version Ink patch guard before
  emitting the publishable CLI and profiler bundles.
- Fresh npm and Bun installations applied patch version 2 and passed 2 behavioral
  cases with 14 expectations. Installed-profiler bundle acceptance passed 5 cases
  with 21 expectations under the same gate used by nightly CI.
- The source profiler printed version `0.11.0`, published `startup` and `exit`
  samples, and rendered its report. The required `stepfun-37` startup smoke exited
  0 and returned a three-line haiku.
- The first release-install invocation used a 180-second Bun timeout below the
  suite's 600-second smoke bound. It terminated the outer runner after two tests,
  so that invocation did not establish a complete suite result. Its detached
  smoke finished all release-install assertions, and a clean retry with the
  600-second bound passed all 5 tests with 16 expectations in 235.59 seconds. No
  release-smoke process or generated `packages/cli/bundle` directory remained.
- The final real tmux workload was not repeated because only this plan's prose
  changed after its passing forced-GC run.

The final false-green audit used the branch and a clean detached `origin/main`
worktree at `2fadb59ac`. Both default-root scans produced the same 469 normalized
`MOCK_MIRROR`, `ALWAYS_TRUE`, `SELF_CONFIRMING`, or `NO_ASSERT` findings, leaving
zero branch-only findings. Supplemental `scripts/memory` scans found no test files
or findings. Four lower-tier scanner findings appeared in touched tests. Three
`SWALLOWED_ASSERT` findings refer to one report-parser catch block that first
asserts `toThrow` and converts the no-throw path into an error that fails the
catch assertions. The `DUP_ASSERT` finding validates the same shell prompt shape
after two distinct transition types. Neither finding is a false-green oracle.
The detached worktree stayed clean and was removed.

### PR publication and replacement checks

The verified implementation amendment was published as `46508e83d`, replacing
commit `151c37fc3` with an exact force-with-lease. This publication record is the
only subsequent file change. The published branch retained `origin/main` as an
ancestor with divergence `0 2`, and GitHub reported the pull request mergeable.
The PR title and body were updated to cover all three Ink retention paths, patch
marker version 2, forced-GC evidence, and the installed profiling workflow.

CodeRabbit reviewed the amendment from `151c37fc3` to `46508e83d` and generated
no actionable comments. Its docstring coverage warning is **Reject** because the
repository does not require per-function docstrings and low-value comments would
conflict with local conventions. Its summary repeated two previously classified
cautions. Nonpositive cache capacity is **Reject** because the patched Ink module
constructs both caches with fixed positive internal limits and has no caller path
for another capacity. Interactive TTY suspension is **Reject** because the real
tmux workload exercised the inherited TTY and completed successfully. Open Code
Review was not run again because the repository's two automatic review rounds
had already completed. GitHub reported zero actionable review threads after the
amendment.

Replacement CI concluded with 38 passing checks, zero failures, zero pending
checks, four skipped or neutral checks, and one cancelled check. The cancelled
check was the repository's expected pull-request CodeQL timeout; the separate
CodeQL result was neutral. The aggregate and sharded test jobs, lint, package
smokes, Linux E2E jobs, Windows memory-tool workflow, interactive tmux workload,
mergeability gates, LLxprt review, and CodeRabbit all passed.

## Post-publication JSC sampler correction

A source-checkout analysis session exposed a separate defect in the profiling
code added by this branch. The 60-second memory sampler called
`bun:jsc.heapStats()`. During automatic history compression with two concurrent
in-process review agents, sampled RSS rose from 6,522,159,104 bytes to
42,236,575,744 bytes. Later samples remained near 36 to 42 GB while reported
heap-stat values became implausibly large. The process stopped near 43.3 GB RSS
without producing a macOS diagnostic crash report.

### Root cause and correction

`heapStats()` enumerates live JSC cells and allocates the returned statistics.
That operation is unsuitable for periodic monitoring because its work grows
with the active heap and can itself create severe transient memory pressure.
The sampler now calls `bun:jsc.heapSize()`, which reads the aggregate heap-size
counter without enumerating live cells. RSS, external memory, and ArrayBuffer
values still come from `process.memoryUsage()`. `heapTotal` is the larger of the
base value and the JSC heap size, preserving the `NodeJS.MemoryUsage` shape.
The sampler still does not force garbage collection.

The behavioral regression test replaces the real Bun JSC module's
`heapStats()` function with a throwing function, invokes the production
sampler, and restores the original function in `finally`. Against the old
implementation it failed with `full heap enumeration must not run during
sampling`: 7 tests passed and 1 failed. Against the correction, all 8 tests
passed. This comparison proves that the test executes the production sampling
path and detects the unsafe implementation.

### Controlled and guarded evidence

A Bun 1.3.14 probe retained one million objects and took 20 samples. The fixed
production sampler completed its sampling loop in 6.352 ms with a 49,152-byte
RSS change. Direct `heapSize()` sampling took 6.727 ms. Direct `heapStats()`
sampling took 2,717.172 ms, about 404 times longer at this heap size. This
controlled heap did not reproduce the multi-gigabyte RSS failure by itself; it
establishes the cost difference between aggregate sampling and full heap
enumeration. The captured interactive session establishes the large-heap
failure.

A guarded source-checkout run used `bun start -- --profile-load zai` and two
in-process review agents on the DeepSeek MI300X profile. Over 1,321.533 seconds,
the workload processed about 9.69 million aggregate input tokens while the
fixed profiler recorded 21 periodic samples. External monitoring collected 254
five-second samples. Median RSS was 2.114 GiB, peak RSS was 10.494 GiB, and the
final reading was 1.434 GiB. Twenty-one readings exceeded 7 GiB and two exceeded
10 GiB, but none crossed the 12 GiB per-process guard. The peaks repeatedly
fell within subsequent samples instead of producing the old sustained 36 to 42
GiB plateau. Profiler ticks retained a 60.004-second median interval and a
66.959-second maximum interval.

The guarded-run harness incorrectly labeled the run `operation-complete` after
three screen polls lacked the active-operation marker. The foreground agent was
still inside a bounded `sleep 300` tool call, both reviewers were still reported
as running, and no final synthesis was recorded. The harness then stopped only
its private tmux server. This run therefore provides active-workload and
periodic-sampler evidence, but it does not prove natural reviewer completion or
foreground synthesis.

The post-change test-audit scan reported 2,019 findings, matching the previous
branch scan after line-number normalization. It introduced no new finding. The
only normalized branch-only finding versus the clean main baseline remains the
previously assessed duplicate shell-prompt assertion in the tmux memory
workload test. The new sampler regression test produced no scanner finding.

### Final sampler-correction verification

The complete serial gate passed after the sampler correction:

- The focused sampler suite passed 8 tests with 21 assertions. The adjacent
  memory-telemetry suite passed 13 tests with 47 assertions, and the memory
  monitor suite passed.
- `npm run test` returned status 0. The CLI runner passed all 716 discovered
  test files, including `jscMemorySampler.test.ts`, and the remaining workspace
  suites completed successfully.
- `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run build` all
  returned status 0.
- The required `stepfun-37` startup smoke returned status 0 and produced only a
  three-line haiku.
- Formatting left only the two sampler files and this plan modified, and
  `git diff --check` returned status 0.

### Sampler-correction review and publication gate

The final Z.AI Open Code Review used two permitted rounds. The first round found
that the test-wide JSC capability gate still required `heapStats()` and that the
sampler documentation overstated the source of `heapTotal`. The test gate now
depends only on `heapSize()`, heap-statistics tests check their own capabilities,
and the documentation states that `heapTotal` remains the process shim value
floored at the JSC heap size.

The second round checked only those findings. It identified one remaining
heap-statistics test that still cast `heapStats()` and `gcAndSweep()` without a
capability check. A shared test-only guard now verifies both functions before
that test runs. No third review round was run. The focused sampler suite passed
8 tests with 21 assertions after the final fix, and targeted ESLint and Prettier
checks passed.

The complete serial gate then passed. `npm run test` returned status 0 across all
workspace suites, including 581 of 581 provider files, 382 of 382 agents files,
716 of 716 CLI files, 22 of 22 A2A files, 13 of 13 test-utils files, and 7 of 7
VS Code companion files. A failure-signature scan found no failure. Bun printed
its known VS Code directory-mismatch diagnostic without changing the result.
`npm run lint`, `npm run typecheck`, `npm run format`, and `npm run build` all
returned status 0. The post-format sampler suite passed again. `git diff --check`
passed, and formatting left only the two sampler files and this plan modified.
The required `stepfun-37` startup smoke returned status 0 and printed a
three-line haiku.

### Replacement CI RSS variance remediation

Replacement checks for `04b2b422a` passed 37 jobs and failed only the Interactive
UI memory-retention assertion. The fixed Linux profile measured a 511,705,088-byte
baseline RSS and a 583,221,248-byte post-clear RSS, a 71,516,160-byte increase
against the former 64 MiB allowance. Retained heap increased by 1,022,061 bytes
and objects by 35,211, both well below their existing limits. Manual checkpoints
also enumerate the JSC heap after reading each RSS value, so later RSS readings
include allocator effects from the preceding enumeration.

The regression test now includes that exact Linux profile. It failed first with
`rss grew by 71516160, limit 67108864`. The process-wide RSS allowance then moved
to 96 MiB while the 16 MiB heap and 180,000-object limits remained unchanged.
The fixture passes with the new allowance. The measured stock profile remains
rejected because it grows by 206,723 objects.

The CI-remediation verification completed serially:

- The focused retention-checkpoint and JSC sampler suites passed, along with
  targeted ESLint and Prettier checks.
- `npm run test` returned status 0 across all workspace suites, including 581 of
  581 provider files, 382 of 382 agents files, and 716 of 716 CLI files.
- `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run build` all
  returned status 0.
- The post-format retention-checkpoint suite and `git diff --check` passed.
- The test-audit scan produced 1,999 normalized findings, identical to the prior
  verified branch scan, with no new or missing finding.
- The required `stepfun-37` smoke returned status 0 and printed only a
  three-line haiku.

A local Interactive UI retry under high host load was inconclusive and is not
counted as passing evidence. The replacement CI job remains the authoritative
interactive check for this adjustment.
