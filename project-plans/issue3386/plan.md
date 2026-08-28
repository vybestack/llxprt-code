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
behavior. No further deep review is permitted by this plan. OCR completed in one
round.
