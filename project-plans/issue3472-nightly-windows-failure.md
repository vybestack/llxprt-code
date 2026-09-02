# Plan: Issue #3472: Nightly Windows workflow failure (sandbox-capability hermeticity + Bun per-test timeout classification)

Plan ID: PLAN-20260901-ISSUE3472
Generated: 2026-09-01 (continuation pass recorded same day)
Branch: `issue3472`
Issue: vybestack/llxprt-code #3472 (assigned to acoliver, milestone 0.11.0, label ci/cd)

## Investigation evidence

### AC1 evidence: Windows sandbox-capability tests miss the selected runtime root

`resolveCapabilityRuntimeRoot()` in `packages/cli/src/utils/sandbox-capability.ts`
selects `$LOCALAPPDATA/llxprt-code` on win32, falling back to `os.tmpdir()`. On
Linux it prefers `XDG_RUNTIME_DIR` then `os.tmpdir()`. On Darwin it uses
`os.tmpdir()`. Legacy dirs (`.llxprt-code-cap-*`) are always scanned in
`os.homedir()`.

The reclamation tests in `sandbox-capability.test.ts` seed stale and fresh
capability dirs under `runtimeRoot` (a subdirectory of the mocked
`os.tmpdir()`), then mock `os.platform()` to `'linux'` or `'win32'`. The
win32 placement test sets `LOCALAPPDATA` to a temp dir and asserts the
capability file is placed under `LOCALAPPDATA/llxprt-code`. But the reclamation
tests never mocked `os.platform()` and never set `LOCALAPPDATA`. On a real
Windows host the production resolver uses `LOCALAPPDATA/llxprt-code`, but the
tests' `runtimeRoot` is under `os.tmpdir()`.

Continuation finding (2026-09-01): the initial fix redirected `LOCALAPPDATA`
in `beforeEach` and added new platform-pinned reclamation tests, but left the
two pre-existing reclamation tests unpinned:
`reclaims stale runtime and legacy HOME directories while preserving fresh
directories` and `reclaims directories at a custom age threshold without
following symlinks`. On a real win32 host those tests still resolved the
redirected `LOCALAPPDATA/llxprt-code` root, never scanned the seeded
mocked-tmpdir dirs, and failed deterministically. Both tests now pin
`os.platform()` to `'darwin'` so the scanned root is the suite-owned tmpdir on
every host; the darwin/default tmpdir reclamation branch is thereby covered
deterministically. The failure mode itself is demonstrated under simulated
win32 in `tmp/issue3472/red-evidence.log` (stale dir under the mocked tmpdir
survives because production scans `LOCALAPPDATA/llxprt-code` instead).

### AC2 evidence: reclamation behavior coverage gaps

The existing test "reclaims stale runtime and legacy HOME directories while
preserving fresh directories" exercised only the host-default runtime root.
The win32 branch (`LOCALAPPDATA/llxprt-code`) reclamation was not exercised
with seeded stale/fresh dirs. The same-root prefix merging behavior (when
`resolveCapabilityRuntimeRoot()` and `os.homedir()` resolve to the same
directory) was not tested. Non-directory entries and prefix-mismatch entries
within the runtime root were not tested. The `reclaimOrphanCapabilityDirs`
function merges prefixes by root in a `Map<string, Set<string>>`, but no test
exercised the case where both prefixes map to the same root. The plan's
boundary case "blank LOCALAPPDATA" was listed but not covered; the Windows
fallback test now covers both absent and blank `LOCALAPPDATA` via `it.each`.

A continuation review also removed
`never touches real LOCALAPPDATA on simulated win32`: it only re-asserted the
`beforeEach` redirect (setup, not production behavior) and could never fail
for the right reason. Hermeticity is enforced structurally by the
`beforeEach` redirect plus the `afterEach` env restore, and behaviorally by
the win32 reclamation test seeding and reclaiming under the redirected
`LOCALAPPDATA`.

### AC3 evidence: Bun per-test timeout diagnostic classification

The config-lsp-integration test in `packages/core/src/config/` emitted Bun's
explicit `^ this test timed out after 180000ms.` diagnostic and the child
process exited with code 1 before the outer 300-second per-file timer fired.
`runTestFile` in `packages/core/run-bun-tests.ts` used `stdio: 'inherit'`, so
it never captured child output. The `close` handler classified any nonzero
exit as `timedOut: false, passed: false`. The existing single-retry policy in
`runTestFileWithTimeoutRetry` only retries when `timedOut === true`. So the
per-test timeout was classified as an ordinary assertion failure and the
retry was skipped.

Probe evidence (2026-09-01, Bun 1.3.14, macOS):

- A hanging test with `--timeout 300` (or a per-test third argument) produces
  exit code 1 and the diagnostic `^ this test timed out after 300ms.` on
  stderr (`tmp/issue3472/probe/pt-stderr.log`).
- An assertion failure also exits 1 but emits no timeout diagnostic
  (`tmp/issue3472/probe/assert-stderr.log`).
- `bun test --reporter=junit --reporter-outfile=<path>` classifies a per-test
  timeout as `<failure type="TimeoutError" />`, an assertion failure as
  `<failure type="AssertionError" />`, and writes no failure element for a
  passing file (`tmp/issue3472/probe/junit-*.xml`). Console output is
  unchanged when the junit reporter is added
  (`tmp/issue3472/continue/console-only.log` vs
  `tmp/issue3472/probe/junit-probe-run.log`).

Continuation findings (2026-09-01) that forced a design correction:

1. The initial stderr-string implementation was flaky with real children.
   Bun can emit the diagnostic followed by trailing summary lines inside a
   single stderr chunk; the sliding-window buffer truncated to its last 512
   bytes BEFORE testing the regex, so the diagnostic was dropped. The
   real-child classification test failed on the first continuation run
   (`tmp/issue3472/continue/runner-red-detector.log`, 2 failures) even after
   the truncation order was fixed (`runner-green-1..3.log`, still failing).
2. Root cause of the residual failures: under a `bun test` parent whose cwd
   is the repository root, data events for piped child stdio are never
   delivered at all (0 events on both stdout and stderr pipes; manual
   `read()` after close returns nothing), while the same spawn delivers
   normally under a plain `bun` script, under `bun test` from
   `packages/core`, and from any non-root cwd
   (`tmp/issue3472/continue/probe-parent.test.ts`,
   `probe2.test.ts`, `probe-plain-*.log`, `probe-B-from-core.log`,
   `probe-C-no-bunfig.log`, `probe-D-no-config.log`, `probe-G-envfig.log`;
   bunfig content was excluded via `--config` and `BUNFIG_TOML` overrides).
   `packages/core/test/run-bun-tests.test.ts` invoked as documented by the
   test-writing skill (`bun test path/to/file.test.ts` from the repo root)
   therefore failed deterministically with any pipe-based capture.
3. Consequence: stderr piping also silently dropped the child's visible
   stderr in that invocation mode, regressing output visibility relative to
   `stdio: 'inherit'`.

Revised accepted design: `runTestFile` keeps `stdio: ['ignore', 'inherit',
'inherit']` (visible output is byte-identical to a plain `bun test` run in
every invocation mode) and adds `--reporter=junit
--reporter-outfile=<per-attempt temp file>`. After the child closes with a
nonzero exit, the runner scans the attempt's report in fixed-size chunks
(`junitReportContainsPerTestTimeout`: 64 KiB reads into one reused buffer,
with a constant-size overlap carrying the marker-length tail across chunk
edges; absent report treated as no detection, any other read error
propagates) and classifies the attempt as a timeout when the report contains
Bun's exact `<failure type="TimeoutError"` representation. This is Bun's own
structured classification of a per-test timeout, so it is narrower than any
console-text match, cannot be spoofed by test output, never allocates a
whole-file buffer regardless of report size, and works identically on every
platform and parent mode. The per-attempt report directory is removed on
every resolve path, including timeout reaps and report-scan errors.

Known accepted edge: a test that itself fails by throwing an exception whose
name is `TimeoutError` is classified as a per-test timeout and gets the
single retry; the file still fails and the final result is still reported
(timeout-classified rather than exit-code-classified). The prior stderr
string match had the same class of false positive plus the chunking failures
above.

## Accepted criteria

### AC1: Hermetic platform-root tests

- Capability reclamation tests explicitly exercise every platform root branch
  (Linux XDG, Linux tmpdir fallback, Windows LOCALAPPDATA, Windows tmpdir
  fallback, Darwin tmpdir) and direct every scanned location to suite-owned
  temporary directories.
- Native or simulated Windows uses a temporary LOCALAPPDATA and isolated home.
  Tests must never touch real LOCALAPPDATA or real home.
- Restore `process.env`, `os.platform`, `os.tmpdir`, and `os.homedir` state
  even after failures.

### AC2: Existing reclamation behavior

- Real reclamation/producer behavior proves:
  - Stale exact-prefix `llxprt-code-cap-*` dirs are removed from the selected
    runtime root.
  - Fresh dirs remain.
  - Stale legacy `.llxprt-code-cap-*` home dirs are removed.
  - Custom age threshold works.
  - Symlinks and their targets remain untouched.
- Cover relevant Linux fallback and Windows LOCALAPPDATA branches while
  retaining existing XDG, Darwin, blank/absent env, same-root prefix merging,
  non-directory, prefix mismatch, and security behavior as applicable.
- Do not change production capability placement or security behavior unless a
  failing behavioral test proves a production defect. The confirmed issue is
  test setup.

### AC3: Bun per-test timeout classification

- If a Bun test child exits nonzero and Bun's own junit report for the
  attempt classifies any failure as `type="TimeoutError"`, classify that
  attempt as a timeout and route it through the existing one-retry timeout
  policy.
- Timeout then pass: one retry marker and final pass.
- Timeout then timeout: final failure classified/reported as timeout with no
  third attempt.
- Timeout then assertion: final assertion failure with no third attempt and no
  stale timeout classification.
- Ordinary assertion/non-timeout exit 1 is never retried, regardless of
  elapsed duration.
- Preserve visible stdout/stderr diagnostics (stdio remains fully inherited;
  console output with the reporter flags added is byte-identical apart from
  timing numbers), process-tree reap behavior, and final-attempt JUnit
  semantics.
- Detection scans the per-attempt junit report after the child closes in
  fixed-size chunks into a reused buffer, with constant-size matcher state
  carried across chunk boundaries so the marker is detected at every
  alignment. The scan never allocates a whole-file buffer. The report is a
  suite-runner-owned temp file removed on every resolve path. Match Bun's
  structured classification only; do not infer timeout from duration, exit
  code, or console text.
- Add behavioral real-child fixture coverage to
  `packages/core/test/run-bun-tests.test.ts` using a test-only short timeout
  where practical. Follow existing structure and test infrastructure. Do not
  create JS or Vitest/Node tests.

### AC4: Deferred / approval-gated (NOT implemented in this task)

- The proposed focused Windows workflow coverage is approval-gated and
  explicitly excluded from this task. No workflow file modifications are
  made. This item is recorded for future planning only and is not represented
  as implemented or accepted.

## Boundary cases

- Same-root prefix merging: when `resolveCapabilityRuntimeRoot()` returns the
  same path as `os.homedir()`, both `CAPABILITY_DIR_PREFIX` and
  `LEGACY_CAPABILITY_DIR_PREFIX` are scanned in that root.
- Non-directory entries in the runtime root (files, symlinks) are skipped by
  `reclaimDirIfStale` because `entry.isDirectory()` is false.
- Prefix mismatch: entries that do not start with either prefix are skipped.
- Blank/absent `XDG_RUNTIME_DIR`: resolver falls back to `os.tmpdir()`.
- Blank/absent `LOCALAPPDATA`: resolver falls back to `os.tmpdir()`.
- Ordinary assertion failure with nonzero exit: must not be classified as
  timeout even if the test took a long time.
- Absent junit report (child killed before writing one): no detection; the
  per-file timer path already classifies timeouts.
- The junit reporter's `TimeoutError` failure type vs `AssertionError` /
  `Error` / passing files is asserted from real Bun 1.3.14 reporter output
  captured in `tmp/issue3472/probe/junit-*.xml`.

## Explicit exclusions

- No GitHub workflow file modifications.
- No dependency, package script, or lockfile changes.
- No public API changes.
- No `.llxprt` content modifications.
- No quality tool modifications.
- No production Config/LSP behavior, timeout budget, or retry count changes.
- No unrelated code changes.
- AC4 (Windows workflow coverage) is deferred and approval-gated.

## TDD sequence

### Phase 1: AC1 + AC2: sandbox-capability.test.ts (RED)

Write failing behavioral tests that:
1. Exercise reclamation on simulated win32 with redirected LOCALAPPDATA and
   isolated home. Seed stale/fresh dirs under the LOCALAPPDATA/llxprt-code
   root. Assert stale removed, fresh preserved, legacy home dirs removed.
2. Exercise reclamation on Linux tmpdir fallback (no XDG_RUNTIME_DIR).
3. Exercise same-root prefix merging: when runtime root equals homedir, both
   prefixes are scanned in the same directory.
4. Exercise non-directory and prefix-mismatch entries being skipped.
5. Assert that on simulated win32, the test never touches real LOCALAPPDATA
   (LOCALAPPDATA is always redirected to a temp dir in beforeEach).

These tests fail because the existing beforeEach does not redirect
LOCALAPPDATA, so on real win32 the production code scans the real LOCALAPPDATA
and the seeded dirs under the mocked tmpdir are never found.

### Phase 2: AC1 + AC2: fix test setup (GREEN)

Update the test `beforeEach`/`afterEach` to:
- Always redirect `LOCALAPPDATA` to a temp dir (so win32 resolver never
  touches real LOCALAPPDATA).
- Restore `LOCALAPPDATA` in `afterEach` along with the rest of
  `process.env`.
- Add the missing platform-branch reclamation tests.

No production code changes for AC1/AC2 unless a failing test reveals a real
defect (the investigation confirms the issue is test setup, not production
code).

### Phase 3: AC3: run-bun-tests.test.ts (RED)

Write failing behavioral tests that:
1. A real Bun child that times out (per-test timeout) and exits 1 is
   classified as `timedOut: true` by `runTestFile`.
2. A real Bun child that fails with an assertion and exits 1 is classified as
   `timedOut: false`.
3. `runTestFileWithTimeoutRetry` retries a per-test-timeout attempt and
   passes on the second attempt (timeout then pass).
4. `runTestFileWithTimeoutRetry` does not retry an ordinary assertion failure.
5. Timeout then timeout: final failure classified as timeout, no third
   attempt.
6. Timeout then assertion: final assertion failure, no stale timeout
   classification.

These tests fail because `runTestFile` never inspects the child's outcome
beyond the exit code, so a per-test timeout that exits 1 before the per-file
timer is classified as `timedOut: false`.

RED evidence (recorded 2026-09-01):
- Initial implementation attempt (stderr sliding window):
  `tmp/issue3472/runner-red*.log` (import/syntax RED during authoring),
  then real-child classification RED on continuation:
  `tmp/issue3472/continue/runner-red-detector.log` (2 real-child failures)
  with only partial recovery in `runner-green-1..3.log`; this RED exposed
  both the chunk-truncation defect and the root-cwd pipe suppression
  described above.
- Revised implementation (junit report classification):
  `tmp/issue3472/continue/runner-red-junit.log`:
  `SyntaxError: Export named 'junitReportsPerTestTimeout' not found`,
  exit 1, before the function existed.

### Phase 4: AC3: run-bun-tests.ts production change (GREEN)

`runTestFile` was revised to:
- Keep `stdio: ['ignore', 'inherit', 'inherit']` so visible output is
  unchanged from a plain `bun test` run.
- Pass `--reporter=junit --reporter-outfile=<per-attempt temp file>` to the
  child.
- On a nonzero close with no spawn error, scan the attempt's report
  (ENOENT means no report was written; other read errors propagate) and set
  `timedOut: true` when `junitReportContainsPerTestTimeout` finds Bun's
  `<failure type="TimeoutError"` marker.
- Remove the per-attempt report directory on every resolve path, including
  both timeout-reap outcomes.
- Leave the per-file timer path, reap behavior, retry policy, and JUnit
  generation untouched.

GREEN evidence (recorded 2026-09-01, all exits 0):
- `tmp/issue3472/continue/runner-green-root.log` and `runner-green-root2.log`
  (repo-root invocation, 18 pass / 1 skip each), the invocation that failed
  deterministically under the pipe-based implementation.
- `tmp/issue3472/continue/runner-green-core.log` (packages/core invocation,
  18 pass / 1 skip), the CI/runner invocation.
- `tmp/issue3472/continue/capability-green.log` (35 pass) for AC1/AC2.
- `tmp/issue3472/continue/lsp-integration.log` (30 pass) run with the exact
  runner invocation (`LLXPRT_RUNNING_TESTS=true bun test --timeout 180000
  --preload bun-preload.ts src/config/config-lsp-integration.test.ts`).

The earlier `tmp/issue3472/lsp-integration.log` / `lsp-baseline.log` pair
(2 failures each, like-for-like on main) was produced WITHOUT the preload;
the preload is what the core runner always passes, and with it the file
passes. Recorded as an invocation artifact, not a product defect.

### Phase 5: REFACTOR

Review for:
- No `any`, no unsafe assertions, no mock theater.
- Test helpers extracted to avoid boilerplate duplication.
- No unbounded buffering (the revised design scans one fixed-size chunk at a
  time with constant-size overlap state and no stream output at all).
- All existing tests still pass.
- Continuation consolidations: the four canned-outcome retry tests added
  inside the AC3 describe duplicated the pre-existing
  `runTestFileWithTimeoutRetry` coverage (only the unused `exitCode` literal
  differed); only the genuinely new timeout-then-assertion case was kept,
  folded into the existing retry describe. The tautological
  `never touches real LOCALAPPDATA` setup-assertion test was removed.

## Verification mapping

| AC | Tests | Production change |
|----|-------|-------------------|
| AC1 | sandbox-capability.test.ts: win32 reclamation with redirected LOCALAPPDATA; Linux fallback; absent/blank LOCALAPPDATA fallback; same-root merging; env restoration | None (test setup fix) |
| AC2 | sandbox-capability.test.ts: stale/fresh/symlink/legacy/custom-threshold on multiple platform branches (darwin default, linux XDG + fallback, win32 LOCALAPPDATA + fallback) | None unless failing test reveals defect |
| AC3 | run-bun-tests.test.ts: junit classifier unit tests from real reporter output; chunk-boundary marker alignment; bounded-memory scan of a multi-chunk report; real-child timeout/assertion classification; timeout-then-assertion retry semantics | run-bun-tests.ts: junit reporter flags, per-attempt report chunk scan + classification, temp cleanup; stdio stays inherited |
| AC4 | None | None (deferred) |

## Initial review triage and remediation (2026-09-01)

| # | Finding | Classification | Status |
|---|---------|----------------|--------|
| 1 | `run-bun-tests.ts` read the whole JUnit report via `readFileSync(reportPath, 'utf8')`, violating the accepted AC3 bounded-memory behavior | Blocker-Fix, High | Remediated: replaced with `junitReportContainsPerTestTimeout`, a fixed-size 64 KiB chunk scan into one reused buffer with constant-size overlap state carried across chunk edges, matching only Bun's exact `<failure type="TimeoutError"` representation |
| 2 | Newly added comments/docblocks restating behavior or acceptance criteria in `run-bun-tests.ts`, `run-bun-tests.test.ts`, `sandbox-capability.test.ts` | In-scope-Fix, Low | Remediated: all such comments removed. Kept: the ENOENT one-liner (why an absent report is not a read failure in a fail-fast runner), the UTF-8 chunk-edge one-liner (why decoding a split multi-byte sequence cannot corrupt the ASCII marker match), and the test-fixture provenance note (the classifier fixtures are captured Bun 1.3.14 reporter output, not invented literals) |
| 3 | Em dashes in this plan | In-scope-Fix, Low | Remediated: all 13 replaced with ordinary punctuation |
| 4 | Full `npm run test` failure in unchanged `packages/cli/src/utils/sandbox-orphan-reaping.bun.test.ts` | Defer, Medium | Still deferred and not claimed resolved. The complete candidate test rerun passed: the file passed inside both complete `npm run test` runs (each exit 0, 719/719 CLI files), though it failed standalone focused runs on this host during the findings-only cycle, consistent with environment-dependent instability in an unchanged file. No modification made; see the verification section below |
| 5 | This plan still recorded full-cycle verification as pending after both verification cycles had completed, so the completed evidence was absent from the record | In-scope-Fix, Low | Resolved: added the "Post-remediation and findings-only verification" section below with the exact exit for every gate; no code or test change was involved |

Remediation TDD evidence (all under `tmp/issue3472/remediation/`):

- RED-1: `runner-red1-export-missing.log`, exit 1,
  `Export named 'junitReportContainsPerTestTimeout' not found` (tests written
  first against the unchanged runner).
- RED-2: `runner-red2-unbounded-read.log`, exit 1, 21 pass / 1 skip / 1 fail.
  The only failure is `scans a multi-chunk report without reading the whole
  file into memory`: RSS growth 134,397,952 bytes against the 96 MiB bound,
  the minimum a whole-file utf8 read of a 128 MiB report must allocate. This
  run used an intermediate implementation with the same whole-file read
  behavior as the reviewed code, proving the failure is the unbounded read
  itself.
- GREEN: `runner-green-chunked.log` and `runner-green-chunked-2.log`, both
  exit 0, 22 pass / 1 skip / 0 fail (repeat run confirms the RSS bound is
  stable).

Focused verification (exact exits recorded alongside the logs):

- `bun test packages/core/test/run-bun-tests.test.ts`: exit 0, 22 pass /
  1 skip / 0 fail (`runner-green-final.log`, `runner-green-final-exit.txt`).
- `bun test packages/cli/src/utils/sandbox-capability.test.ts`: exit 0, 35
  pass / 0 fail (`capability-green-final.log`,
  `capability-green-final-exit.txt`).
- Scoped typecheck: `tsc -p tsconfig.runner.json` exit 0 (both changed core
  files) and cli package `tsc --noEmit` exit 0
  (`typecheck-runner.log`, `typecheck-cli.log`).
- Scoped eslint on the three changed TypeScript files: exit 0
  (`eslint-changed.log`); prettier reports all three unchanged
  (`prettier.log`); `git diff --check` clean.

Boundary behavior added with the remediation: the marker is detected at every
split alignment across the 64 KiB read boundary (loop over all offsets,
timeout marker asserted true and assertion marker asserted false at each),
and a reordered `<failure message="..." type="TimeoutError"` element is not
classified, pinning the accepted Bun representation.

## Post-remediation and findings-only verification (2026-09-01)

Evidence lives in `tmp/issue3472/post-remediation/` (summary:
`00-SUMMARY.txt`), `tmp/issue3472/deep-review/` (per-command `.exit`
markers), and `tmp/issue3472/findings-review/` (final `EXIT_CODE:0`
lines). No candidate code or test file changed during either cycle; the
only edit from these cycles is this plan.

Focused gates, each exit 0:

- `bun test packages/cli/src/utils/sandbox-capability.test.ts`: exit 0,
  35 pass / 0 fail.
- `bun test packages/core/test/run-bun-tests.test.ts`: exit 0, 22 pass /
  1 skip (the skip is the Windows-only reap test) / 0 fail.
- `bun test src/config/config-lsp-integration.test.ts` (from
  packages/core, with the runner's preload): exit 0, 30 pass / 0 fail.
- test-audit (`bun scripts/test-audit/scan.ts`): exit 0, 2023 findings;
  the candidate `findings.tsv` is byte-identical to the main baseline
  (`cmp` exit 0), so the candidate adds zero audit findings.

Full cycle on the candidate head, run serially, every complete command
exit 0:

- `npm run test`: exit 0, 719/719 CLI files, 9303 passed, 0 failed. The
  first attempt hit an unchanged shared-state file
  (`packages/cli/src/utils/sandbox-entrypoint.test.ts`) with a proven
  sibling collision: `llxprt-code-rs --session rs-issue-9u1` (PID 13390)
  held open handles on the real config directory that test snapshots and
  started inside the run window
  (`tmp/issue3472/post-remediation/08-collision-evidence.txt`). The
  unchanged file was not modified; its focused rerun passed (exit 0,
  18 pass / 0 fail) and the complete `npm run test` rerun exited 0.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run format`: exit 0; candidate file hashes identical before and
  after; no working tree change.
- `npm run build`: exit 0.
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and
  nothing else"`: exit 0.
- `git diff --check`: exit 0.

Finding 4 above stays classified Defer, Medium.
`sandbox-orphan-reaping.bun.test.ts` passed inside both complete candidate
`npm run test` runs described here, and it also failed standalone focused
runs on this host during the findings-only cycle (exit 1), consistent with
environment-dependent instability in an unchanged file. It was not
modified and the instability is not claimed fixed.

AC4 status is unchanged by either cycle: no Windows workflow coverage was
implemented, verified, or claimed.

## Local OCR round 1 triage and remediation (2026-09-01)

A local open-code-review run (zai profile, glm-5.3, OCR v1.11.2) reviewed the
three candidate code files; the full report is `tmp/issue3472/ocr-local-1.log`
(7 findings, all on the core runner pair; `sandbox-capability.test.ts` drew
none). Triage: 1 Blocker-Fix, 1 In-scope-Fix, 5 Reject, 0 Defer.

| # | OCR finding (severity, category) | Classification | Disposition |
|---|----------------------------------|----------------|-------------|
| 1 | Reordered-attribute junit element asserted false; widen the marker to tolerate attribute order (medium, test) | Reject | Not implemented; rationale below |
| 2 | RSS regression test conflates retained memory with GC timing; force GC before snapshots and shrink the fixture (low, test) | Reject | Not implemented; rationale below |
| 3 | Unguarded `rmSync` on every settle path can strand the per-file promise or crash the runner before aggregate JUnit is written (high, bug) | Blocker-Fix | Remediated below |
| 4 | Non-ENOENT report scan errors escape the close handler as an uncaught exception; degrade to `timedOut: false` instead (medium, bug) | Reject | Not implemented; rationale below |
| 5 | `mkdtempSync` inside the promise executor can reject `runTestFile`; resolve a failed TestResult instead (medium, bug) | Reject | Not implemented; rationale below |
| 6 | Exact marker brittle in both directions: silent disable on attribute drift, false positives from user-defined TimeoutError names (medium, maintainability) | Reject | Not implemented; rationale below |
| 7 | A per-test timeout is reported with the per-file budget that never fired (low, bug) | In-scope-Fix | Remediated below |

### Reject rationales

Findings 1 and 6 (marker widening, both the reordered-attribute and the
user-defined TimeoutError halves): the accepted AC3 design matches Bun's
exact structured `<failure type="TimeoutError"` representation and nothing
else. The runner spawns its own `process.execPath`, so the report writer is
the same Bun runtime the runner controls, and the test asserting that a
reordered `<failure message="..." type="TimeoutError"` element is not
classified pins that accepted representation on purpose (AC3: "Match Bun's
structured classification only; do not infer timeout from duration, exit
code, or console text"). Order-tolerant or substring-widened matching would
let test-controlled failure text quoting `type="TimeoutError"` flip whole
files into timeout classification and win a retry they did not earn. The
known accepted edge (a user-defined error named TimeoutError) is recorded
above with the revised design and stays accepted.

Finding 2 (weaken or shrink the RSS regression): that test is the acceptance
test for the AC3 bounded-memory requirement ("The scan never allocates a
whole-file buffer"). Adding forced GC before each after-scan snapshot
measures a different, weaker property, and shrinking the 128 MiB fixture
reduces the allocation the bound must catch. The test passed both prior full
cycles and every focused run in this remediation unchanged.

Finding 4 (convert non-ENOENT scan errors to an ordinary result): a report
read error is an infrastructure failure of the runner, not an outcome of the
test file. Folding it into `timedOut: false` would hide it inside a test
result, which the accepted design and this repository's fail-fast preference
both forbid. Propagation is unchanged.

Finding 5 (convert mkdtemp failure to a test result): a host that cannot
provide a temp directory is an infrastructure abort. Resolving it as a
per-file TestResult would report a test failure that no test produced. The
promise rejection inside the executor is unchanged.

### Blocker-Fix remediation (finding 3)

- Attempt cleanup stays scoped to the attempt's own mkdtemp directory;
  nothing broader is ever removed.
- Removal is retried a bounded number of times (default 3, 100 ms apart)
  and only for the Windows lock-variance codes EBUSY, EPERM, EACCES and
  ENOTEMPTY; every other error propagates immediately.
- Every settle path (close handler, reap success, reap failure) resolves
  through cleanup, so the `runTestFile` promise settles on every path. An
  exhausted cleanup failure sets `reapFailed` with a `reapError` beginning
  `attempt cleanup failed for <file>`, which routes through main()'s existing
  fail-fast abort (FATAL line with the per-file error, JUnit write, exit 1)
  instead of being swallowed or converted into an ordinary test failure. A
  file whose tests passed stays `passed: true` in that result; the abort, not
  a fabricated failure, carries the error.
- Retry, reap, timeout, Windows taskkill, and final-attempt semantics are
  unchanged, and report-scan errors still propagate (finding 4 rejected).
- The new internal options `cleanupAttempts`, `cleanupRetryDelayMs` and
  `removeAttemptDir` mirror the existing `reapTimeoutMs` / `taskkillTimeoutMs`
  test knobs. No package export, script, workflow, or dependency changed.

### In-scope-Fix remediation (finding 7)

- `TestResult.timeoutMs` is now `number | null`: null marks a timeout that
  came from a per-test budget, which an individual test may override, so no
  file-level number applies.
- Per-file timeout paths keep the numeric budget everywhere: summary
  `(exceeded 300s)`, JUnit `Timed out after 300s`.
- Per-test timeouts: the retry log says `after per-test timeout`, the JUnit
  failure message is the nonnumeric `Timed out: per-test timeout`, and the
  summary says `(exceeded per-test timeout)`.
- The single retry and the final-attempt result are unchanged.

### Remediation TDD evidence (all under `tmp/issue3472/ocr-remediation/`)

- RED: `runner-red-cleanup.log` (exit 1; 21 pass / 1 skip / 8 fail). The
  eight failures are exactly the new behavioral tests. Three fail through
  the real control-flow defect with a real EACCES out of `removeAttemptDir`:
  the close-handler finally (run-bun-tests.ts:459), the reap-success callback
  (:402), and the reap-failure callback (:419), which are finding 3's three
  affected sites. The other five fail on the finding 7 assertions (per-test
  retry message, nonnumeric JUnit label, real-child `timeoutMs` null) and on
  the cleanup options the runner did not yet honor.
- Real-filesystem failure injection: the three settlement tests point the
  runner's mkdtemp root at a suite-owned directory via a TMPDIR override,
  wait for the attempt directory, then lock it with a lock file plus mode
  0o555 so the real rmSync fails with EACCES (POSIX only, `skipIf` win32).
  The reap-failure family is triggered deterministically with
  `reapTimeoutMs: 1` (probed 12/12 failures in `probe-cleanup.log`, alongside
  the TMPDIR-override and unwritable-outfile probes that shaped the design).
  Windows lock retry (EBUSY) is covered on every platform through the
  narrowly injected `removeAttemptDir` filesystem operation, which also
  asserts the cleanup stays scoped to the runner's own
  `llxprt-runner-junit-` directory under `tmpdir()` and that a non-lock
  error (EINVAL) is not retried.
- GREEN: `runner-green-cleanup.log`, `runner-green-cleanup-2.log`, and
  `runner-green-cleanup-3.log` (after formatting), each exit 0 with
  29 pass / 1 skip / 0 fail.
- Scoped gates: `typecheck-core.log` (core workspace `tsc --noEmit` plus
  `tsconfig.runner.json`) exit 0; `eslint-changed.log` exit 0 on both changed
  core files; `prettier-check2.log` exit 0.

### Post-OCR-remediation verification (2026-09-01)

Every command below ran serially on the final candidate code and test state,
each with its own log under `tmp/issue3472/ocr-remediation/`:

- `npm run test`: exit 0 (`01-full-test.log`). All workspaces green,
  including `Passed 719/719 CLI test files` and `Passed 22/22` core files.
  The only `(fail)` lines in the log are the runner tests' own fixture
  children (the hanging per-test-timeout fixture and the assertion-failure
  fixture), whose failure is the behavior under assertion.
- `npm run lint`: exit 0 (`02-full-lint.log`).
- `npm run typecheck`: exit 0 (`03-full-typecheck.log`).
- `npm run format`: exit 0 (`04-full-format.log`); the four candidate file
  hashes are identical before and after (`pre-format-hashes.txt` vs
  `post-format-hashes.txt`), so the formatter changed nothing in them.
- `npm run build`: exit 0 (`05-full-build.log`).
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and
  nothing else"`: exit 0 (`06-smoke.log`).
- test-audit (`bun scripts/test-audit/scan.ts`): exit 0, 2023 findings
  (`07-audit-branch.log`); the candidate `findings.tsv` is byte-identical to
  the main baseline (`cmp` exit 0, `08-audit-compare.log`), so the
  remediation adds zero audit findings (7 new tests, same finding count).
- `git diff --check`: exit 0 (`09-git-diff-check.exit`).
- Working tree: exactly the four candidate files (`git status --porcelain`);
  no generated fixture directories remain under `packages/core/test/`.

Local OCR round 1 status: complete. Both actionable findings are remediated
with TDD evidence, five findings are rejected with rationale, and none are
deferred. The candidate is ready for the round 2 findings-only review. AC4
remains excluded and approval-gated; this remediation touched only the core
runner, its existing test file, and this plan.

## Local OCR round 2 (findings-only) triage and remediation (2026-09-01)

The findings-only local open-code-review pass (zai profile, glm-5.3, OCR
v1.11.2; full report `tmp/issue3472/ocr-local-2.log`) returned seven comments
across the three candidate code files. Triage: 0 Blocker-Fix, 1 In-scope-Fix,
5 Reject, 1 Defer. No additional local OCR was run after that report; round
2 is the final review input, and this cycle is the last local remediation.

| # | OCR comment (severity, category) | Classification | Disposition |
|---|----------------------------------|----------------|-------------|
| 1 | sandbox-capability.test.ts: the backdate-by-2-days fixture block and the LOCALAPPDATA redirect line repeat across five new tests and two beforeEach hooks; extract a helper (low, maintainability) | Reject | Not implemented; rationale below |
| 2 | run-bun-tests.test.ts: the locked passing-file test's `passed: true` / `exitCode: 0` rely on Bun 1.3.14 treating an un-writable `--reporter-outfile` as non-fatal; a future Bun that exits nonzero would break it; relax to runner-owned invariants (medium, test) | Reject | Not implemented; rationale below |
| 3 | run-bun-tests.test.ts: add coverage that non-ENOENT report-scan errors propagate instead of degrading to `timedOut: false`, suggested via an EISDIR directory path (medium, test) | Reject | Not implemented; rationale below |
| 4 | run-bun-tests.test.ts: the combined reap plus cleanup failure test forces the reap failure with `reapTimeoutMs: 1`; the close event can beat a 1ms timer, the reap then succeeds, and the reap-failure assertion fails intermittently (low, test) | In-scope-Fix | Remediated below |
| 5 | run-bun-tests.test.ts: the three POSIX cleanup tests triplicate a ~35-line scaffold; extract a shared harness (low, maintainability) | Reject | Not implemented; rationale below |
| 6 | run-bun-tests.test.ts: no test pins that mkdtempSync failure inside the promise executor rejects `runTestFile` fail-fast rather than resolving a synthetic result or hanging (medium, test) | Reject | Not implemented; rationale below |
| 7 | run-bun-tests.test.ts: `lockAttemptDirForRemoval` (chmod 0o555) does not bind under UID 0, so the three POSIX cleanup tests fail when the suite runs as root in a container (low, test) | Defer | Recorded below; not implemented, not claimed |

### Reject rationales

Findings 1 and 5 (fixture and harness consolidation): consolidation-only
refactors of tests that are accepted evidence for AC1, AC2, and the cleanup
behavior. Neither alleges a behavioral defect; OCR rates both low,
maintainability. The final cycle is scoped to the one accepted defect, and
restructuring accepted tests would churn the reviewed candidate for no
behavioral gain, which the task's no-unrelated-refactor rule excludes.

Finding 2 (relax the locked passing-file assertions): the suggestion weakens
assertions that hold today against a hypothetical future Bun release. The
repo pins Bun `>=1.3.14`, and on that runtime a passing test file whose
reporter outfile cannot be written still exits 0 while emitting a
JUnitReportFailed warning (`tmp/issue3472/ocr-remediation/probe-cleanup.log`,
probe 2: unwritable outfile exit code 0). Dropping `passed` and `exitCode`
would remove real evidence that the classification outcome survives the
locked-cleanup path; if Bun changes the outfile contract, this test failing
is the correct signal to re-derive it. Preemptive or conditional weakening is
also barred by the fixed triage.

Finding 3 (add a non-ENOENT scan test): new coverage is outside the final
cycle's scope, which implements only the accepted defect. The fail-fast
propagation contract is already pinned in this plan's AC3 revision and its
remediation RED evidence, and the suggested EISDIR probe would pin the errno
behavior of `readSync` on a directory descriptor, which is platform and
filesystem behavior, not runner behavior.

Finding 6 (mkdtemp fail-fast test): round 1 rejected the behavior twin of
this suggestion (its finding 5, converting mkdtemp failure into a TestResult)
on fail-fast grounds: a host that cannot provide a temp directory is an
infrastructure abort. The coverage twin would pin promise-executor plumbing
(a synchronous throw rejecting the returned promise), which is JavaScript
runtime semantics rather than runner behavior, and adding it now would expand
the candidate past the reviewed scope.

### Defer record (finding 7)

The three chmod 0o555 cleanup tests assume a non-root suite user: UID 0
bypasses directory permission checks, so the lock does not bind, removal
succeeds, and the `reapFailed` assertions fail when the suite runs as root
inside a container. Recorded as a known deferred root-container test
portability item. Per the fixed triage, no skip was added and the tests were
not altered, because root-container coverage was not accepted for this
issue. The platform-independent injected removal tests (`removeAttemptDir`
with EBUSY retry, EINVAL fail-fast, and directory scoping) remain evidence
for the cleanup behavior on every UID.

### In-scope-Fix remediation (finding 4)

The combined test used `reapTimeoutMs: 1` to force the reap-failure branch
of the per-file timeout path. That is a timing bet on SIGKILL-to-close
latency, not a deterministic forcing mechanism. RED probe evidence
(`tmp/issue3472/ocr-final-fix/probe-old-race.log`, Bun 1.3.14, darwin arm64;
50 serial rounds across 1/2/3/5/10ms budgets plus 32 parallel rounds at
1ms, each round a real hanging `bun test` child reaped through the runner's
own exported `killChildTreeAndWait`): the same mechanism's outcome flips
with the budget. At 2ms the reap failed 10/10; at 3ms it failed 8/10 with
the child close beating the budget twice; at 5ms it failed 0/10. Observed
close latency ranged 2.425ms to 11.023ms, so the 1ms budget held in this run
(42/42 failures) only because this host's close-latency floor stayed above
1ms; nothing guarantees that ordering on other hosts or under other load.
The old test also passed 10/10 focused repeats on this host
(`old-test-repeats.log`): green, but the named reap-failure path is
established by scheduling luck rather than by construction.

Fix, per the fixed triage's instruction to prefer operation injection and
otherwise add only the smallest runner-internal seam: no injection point
existed for the reap (the only injected operation was `removeAttemptDir`), so
`RunTestFileOptions` gains the internal option `reapTimedOutChild` taking the
child and its close promise, mirroring the existing internal test knobs; no
package export, script, workflow, or dependency changed. `runTestFile`
resolves it to the unchanged `killChildTreeAndWait(child, childClosed,
options)` call when absent, so production behavior, the timeout budgets,
retry counts, Windows taskkill, report scanning, and final-attempt semantics
are untouched. The combined test now injects a reap that rejects
deterministically with the real close-lifecycle timeout message, leaves the
child alive (which is what a failed reap means; afterEach reaps it through
processIds), and keeps every original assertion: both failure details in one
reapError, settlement proven by settleWithin, plus a new proof that the child
really survived the failed reap. Assertions were strengthened, none were
weakened, and none are conditional on timing.

Remediation TDD evidence (all under `tmp/issue3472/ocr-final-fix/`):

- RED: `runner-red-seam-missing.log` (exit 1) runs the rewritten test against
  the unchanged runner; the real reap with its 10s default budget succeeds
  and kills the child, so reapError carries only the cleanup detail and the
  `close lifecycle did not complete within 1ms` containment fails for that
  exact reason. `typecheck-red.log` (exit 2) shows TS2353, reapTimedOutChild
  not a known property of RunTestFileOptions.
- GREEN: `runner-green-1.log` through `runner-green-5.log`, five consecutive
  full-file runs, each exit 0 with 29 pass / 1 skip / 0 fail, establishing
  deterministic behavior.

### Final verification (2026-09-01)

Every command below ran serially on the final candidate code and test state,
each logged under `tmp/issue3472/ocr-final-fix/`:

- `npm run test`: exit 0 (`01-full-test.log`, FULL_TEST_EXIT:0). 405/405 core
  workspace test files and 719/719 CLI test files; the runner test file green
  inside it, including the rewritten combined test at 1531.41ms. The only
  `(fail)` lines are the runner tests' own fixture children (the hanging
  per-test-timeout fixture and the assertion-failure fixture), the behavior
  under assertion.
- `npm run lint`: exit 0 (`02-full-lint.log`). The first foreground attempt
  was cut off by the local shell timeout ceiling and relaunched unchanged as
  a managed background job; no sibling shared-state collision occurred and
  no unrelated test was changed.
- `npm run typecheck`: exit 0 (`03-full-typecheck.log`).
- `npm run format`: exit 0 (`04-full-format.log`); the four candidate file
  hashes are identical before and after (`pre-format-hashes.txt` versus
  `post-format-hashes.txt`).
- `npm run build`: exit 0 (`05-full-build.log`).
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and
  nothing else"`: exit 0, haiku returned (`06-smoke.log`).
- test-audit: `bun scripts/test-audit/scan.ts` exit 0, 2023 findings
  (`audit-branch.log`, AUDIT_EXIT:0); the candidate `findings.tsv` is
  byte-identical to the main baseline (`audit-compare.log`, CMP_EXIT:0), so
  this remediation adds zero audit findings.
- `git diff --check`: clean. The working tree contains exactly the four
  candidate files (three modified plus this plan); no generated fixture
  directories remain under `packages/core/test/`; no em dashes in this plan.

Local OCR round 2 status: complete. No additional local OCR was run in this
cycle. The one accepted finding is remediated with RED and GREEN evidence,
five comments are rejected with rationale, one is deferred and unclaimed, and
AC4 remains excluded and approval-gated.

## Approval-gated / deferred item

AC4: Focused Windows workflow coverage. This would add a dedicated Windows
test shard or workflow adjustment to catch platform-specific failures in CI.
This is explicitly excluded from the current task and requires approval before
implementation. No workflow files are modified.

## PR #3497 remediation: CI evidence, review triage, and fixes (2026-09-01)

The pushed branch (head `5ceca1e4cd4f6597e9b78f0f83c6fbfba7edaeb3`) failed
two checks on GitHub. This section records the evidence, the classification of
each failed check, the classification of each review thread, and the
remediation. Working-tree changes were made on top of that head without any
commit, push, thread resolution, or GitHub metadata change. All logs named
below live under `tmp/issue3472/pr-remediation/`.

### PR CI evidence

- Windows Test-Infra Gate: FAILURE, job `100063547830`, run `33570585106`
  (`red-windows-test-infra-gate.log`). The per-test timeout classification
  test `classifies a Bun per-test timeout that exits 1 as timedOut` failed
  after its own 30000ms Bun deadline
  (`^ this test timed out after 30000ms.`), and inside it the runner
  reported `exitCode` null where 1 was asserted. 25 pass / 4 skip / 1 fail
  / 1 error across 30 tests in the file, exit 1.
- Test (aggregate): FAILURE, job `100064970011`, run `33570585106`
  (`red-aggregate-test.log`). The Check shard results step reported
  `Windows test-infra gate did not succeed (result: failure)` and exited 1.
  Every shard result upstream of that gate was success, so the aggregate
  failure is derivative of the Windows gate failure alone.

### Failed-check classifications

1. Windows Test-Infra Gate, Blocker-Fix. The classification test's fixture
   used an infinitely pending operation (`await new Promise(() =>
   undefined)`) under a 300ms per-test timeout, and both `runTestFile`
   (`timeoutMs: 30_000`) and the containing Bun test (third argument
   `30_000`) were given the same 30-second deadline. Windows Bun 1.3.14 did
   not close the child after the 300ms per-test timeout fired, so the
   fixture's infinite await held the child alive; the runner's 30-second
   file budget then expired and classified `exitCode: null`, and the
   containing test's identical 30-second deadline killed it at the same
   moment, producing the observed null exit code and the 30012.75ms
   harness timeout. The defect is in the test harness, not the production
   runner: production correctly reported a file-timeout result for a child
   that genuinely would not close.
2. Test (aggregate), derivative. No independent defect; the gate above is
   the sole cause. Not remediated separately because fixing the harness
   removes the only failure the aggregate step observed.

### Review-thread classifications

Two threads were open on `packages/core/run-bun-tests.ts` (saved verbatim in
`pr-review-threads.txt`):

1. CodeRabbit (bug, minor, `close` handler cleanup call): Blocker-Fix. The
   close path's scan-error branch called `void cleanupAttemptDir(...)`,
   which could reject with no handler, and a non-ENOENT report-scan error
   thrown out of the close listener left `runTestFile` pending (an
   infrastructure failure could hang the promise forever) with the cleanup
   rejection arriving later as an unhandled rejection that can mask the
   original scan error. CodeRabbit proposed catching and logging the
   cleanup error via `console.error`, which would swallow an infrastructure
   failure; that suggestion is not used.
2. PR OCR inline (bug/high, timer vs close race): Reject. After the
   per-file timer fires, `runTestFile` sets `resolved = true` before
   scheduling the reap, and the close handler begins with `clearTimeout`
   then `if (resolved) return`, so a close event during the reap window can
   never call `settleAfterCleanup` a second time and can never overwrite
   the timeout result. The path-ownership latch already prevents both double
   settlement and double cleanup. No change made.

### Remediation A: Windows gate test harness (defect 1)

`packages/core/test/run-bun-tests.test.ts`, the per-test timeout
classification test only:

- The infinite `await new Promise(() => undefined)` is replaced by a finite
  real operation, `await Bun.sleep(5000)`, which is longer than the
  fixture's 300ms test budget. If Windows Bun still fails to close the
  child after the per-test timeout, the child now exits on its own once the
  sleep finishes, so the close path can classify `exitCode: 1` instead of
  being held until a budget collision.
- The runner call keeps its 30-second `timeoutMs` budget exactly as before.
- The containing test's own deadline is raised from 30_000 to 60_000, which
  exceeds the runner's whole settlement window (30s file budget plus reap
  plus cleanup), so if the child still fails to exit the test observes the
  file-timeout result and fails on the original `exitCode 1` assertion
  instead of both deadlines firing together.
- Every original assertion is kept: `exitCode` 1, `timedOut` true,
  `timeoutMs` null, `reapFailed` false, `reapError` null.

RED evidence for A is the Windows CI job log itself
(`red-windows-test-infra-gate.log`): the test failed with the 30000ms
harness timeout and `Expected: 1 / Received: null` before any local edit.
GREEN evidence: five consecutive full-file focused runs and the complete
Windows test-infra sequence below, all exit 0 with the test passing in
roughly 5.3s locally (fixture child closes on its own after the sleep).

### Remediation B: scan-error close path (CodeRabbit thread)

The production change is confined to `packages/core/run-bun-tests.ts`:

- `RunTestFileOptions` gains the internal test seam
  `scanJUnitReport?: (reportPath: string) => boolean`, resolved to the
  unchanged `junitReportContainsPerTestTimeout` when absent. This mirrors
  the existing `removeAttemptDir` and `reapTimedOutChild` seams. No export,
  script, workflow, or dependency changed; the module's public exports are
  identical.
- The close handler catches the scan error instead of letting it escape the
  listener. With a caught scan error the classified result is never built,
  so the close path is claimed exactly once and cleanup runs exactly once
  through the same single branch: `cleanupAttemptDir(attemptDir, options)`
  with both outcomes chained to a rejection.
  - Cleanup succeeds: `runTestFile` rejects with the original scan error
    object itself (identity preserved, not a copy or a message).
  - Cleanup fails: `runTestFile` rejects with an `AggregateError` whose
    `errors` array is `[scanError, cleanupError]` in that order, with the
    message `report scan and attempt cleanup both failed for <file>: could
    not remove <attemptDir>`. Neither error is swallowed; both are
    retained on the rejection.
- Because the cleanup promise is always chained, no unhandled rejection can
  be emitted on this path. Because the rejection always happens after
  cleanup settles, `runTestFile` can never stay pending. Fail-fast behavior
  (an infrastructure scan failure aborts the run rather than becoming a
  test outcome) is preserved; the accepted OCR round 1 finding 4 rejection
  (never degrade a scan error to `timedOut: false`) is unchanged.
- The timer path, `resolved` latch, reap behavior, retry policy, timeout
  budgets, JUnit generation, and Windows taskkill logic are untouched.
  The rejected OCR thread (C) produced no change.

TDD evidence for B (all under `tmp/issue3472/pr-remediation/`):

- RED (behavioral): `red-scan-error-tests.log`, exit 1. Two new
  behavioral `runTestFile` tests drove real failing child processes
  (`fail.test.ts` fixtures exiting 1) with a narrowly injected
  `scanJUnitReport` seam, run against the unchanged production runner.
  Test 1 failed because the promise resolved with a TestResult instead of
  rejecting with the exact scan error. Test 2 failed because the promise
  resolved normally instead of rejecting with an ordered AggregateError.
  An early authoring-syntax RED (unterminated string literal from the
  fixture writer) was captured in the same log file before the behavioral
  RED; the behavioral RED was then re-captured cleanly.
- RED (typecheck): `red-typecheck.log`, TS2353 twice, `scanJUnitReport`
  not a known property of `RunTestFileOptions` (plus one TS7006 on the
  untyped callback parameter), before the production option existed.
- GREEN: `green-scan-error-tests-1.log` through
  `green-scan-error-tests-5.log`, five consecutive full-file runs, each
  exit 0 with 31 pass / 1 skip / 0 fail, plus `green-final-formatted.log`
  (exit 0 after prettier) and `green-typecheck.log` (runner config clean).

The two new behavioral tests (in `packages/core/test/run-bun-tests.test.ts`,
describe block `runTestFile: report-scan failure settlement`):

1. Scan error plus successful cleanup: asserts the rejection is the exact
   original scan error object (`rejects.toBe(scanError)`), exactly one scan
   call, and that the attempt directory (runner-owned
   `llxprt-runner-junit-` under `tmpdir()`) no longer exists afterward.
2. Scan error plus nonretryable cleanup error (EINVAL, so exactly one
   removal attempt by construction): asserts an `AggregateError` whose
   `errors` are exactly `[scanError, cleanupError]` in that order, the
   specific aggregate message, exactly one cleanup attempt
   (`removals` length 1), the promise resolved to no TestResult, and an
   `unhandledRejection` listener observed zero unhandled rejections after
   settlement. The real failing child exercises the genuine close path;
   only the scan operation is injected, so this is not a helper unit test.

### Verification (all logs under `tmp/issue3472/pr-remediation/`)

Focused core runner repetition, five consecutive full-file runs
(`green-scan-error-tests-1..5.log`), each exit 0, 31 pass / 1 skip /
0 fail. The only `(fail)` lines in every log belong to the tests' own
fixture children (the 300ms per-test timeout fixture and the assertion
fixtures), the behavior under assertion.

The exact unchanged Windows test-infra command sequence, run serially from
the repo root, every command exit 0:

1. `bun test --preload ./scripts/tests/test-setup.ts scripts/tests/run_bun_tests.test.ts scripts/tests/test-orchestrator.test.ts scripts/tests/test-shard-orchestrator.test.ts`
   (`win-seq-1-meta-tests.log`, 101 pass / 0 fail).
2. `(cd packages/cli && bun test test/run-bun-tests.test.ts)`
   (`win-seq-2-cli.log`, 78 pass / 0 fail).
3. `(cd packages/core && bun test test/run-bun-tests.test.ts)`
   (`win-seq-3-core.log`, 31 pass / 1 skip / 0 fail).
4. `(cd packages/agents && bun test ./test-bun/run-bun-tests.issue3253.bun.ts)`
   (`win-seq-4-agents.log`, 5 pass / 0 fail).
5. `(cd packages/auth && bun test src/__tests__/run-bun-tests.behavior.test.ts)`
   (`win-seq-5-auth.log`, 12 pass / 0 fail).

Test audit: `bun scripts/test-audit/scan.ts` exit 0 with 2023 findings
(`audit-branch.log`, `AUDIT_EXIT:0`); the candidate `findings.tsv` is
byte-identical to the main baseline (`audit-compare.log`, `CMP_EXIT:0`),
so this remediation adds zero audit findings (2 new tests, same count).

Full required cycle, run serially, every complete command exit 0:

- `npm run test`: exit 0 (`full-01-test.log`, `FULL_TEST_EXIT:0`). All
  workspaces green, including `Passed 405/405` core and `Passed 719/719`
  CLI test files. The runner test file passed inside it. No
  shared-state sibling collision occurred in this cycle.
- `npm run lint`: exit 0 (`full-02-lint.log`, `LINT_EXIT:0`).
- `npm run typecheck`: exit 0 (`full-03-typecheck.log`,
  `TYPECHECK_EXIT:0`).
- `npm run format`: exit 0 (`full-04-format.log`, `FORMAT_EXIT:0`); the
  candidate file hashes are identical before and after
  (`pre-format-hashes.txt` vs `post-format-hashes.txt`), so the formatter
  changed nothing in them. Prettier had flagged one pre-format issue in
  `run-bun-tests.ts` (the new scan expression's line width); it was fixed
  with `prettier --write` on that file only, before the full-cycle format
  run, and the focused tests were rerun green on the formatted code
  (`green-final-formatted.log`).
- `npm run build`: exit 0 (`full-05-build.log`, `BUILD_EXIT:0`).
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and
  nothing else"`: exit 0, haiku returned (`full-06-smoke.log`,
  `SMOKE_EXIT:0`).
- `git diff --check`: clean. Working tree relative to head `5ceca1e4`:
  exactly the expected files. This remediation modifies
  `packages/core/run-bun-tests.ts` (defect B),
  `packages/core/test/run-bun-tests.test.ts` (defects A and B), and this
  plan (this required evidence update); `sandbox-capability.test.ts`, the
  fourth PR candidate file, needed no change because neither accepted
  classification touches it. No file outside the four PR candidates is
  modified. No generated fixture directory remains under
  `packages/core/test/` and no leftover fixture process is running.

Scope confirmation: no workflow, dependency, package script, lockfile,
public API or export map, `.llxprt`, quality tool, Config/LSP production
behavior, timeout budget, retry count, exact marker, bounded scanner,
cleanup retry policy, process reaping, Windows taskkill, or unrelated
test/refactor change. AC4 remains excluded and approval-gated; nothing in
this cycle implemented or verified Windows workflow coverage. The rejected
OCR timer/close thread was not implemented. Nothing was committed, pushed,
or resolved on GitHub.