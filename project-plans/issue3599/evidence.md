# Issue #3599 behavioral evidence

Test file: `packages/tools/src/tools/read-file-column-offset.issue3599.bun.test.ts`
(29 tests, real temp files and a real temporary git repository, real `ReadFileTool`
and `ReadLineRangeTool`; the recommended `read_file {json}` call is parsed out of
the tool output and executed).

| Criterion | Test |
| --- | --- |
| 1. One long JSON line: no bogus "offset 1", discloses 2000 cap and length, recommended call retrieves the tail sentinel | `a single line longer than the cap > discloses the cap and recommends a call that retrieves the tail` |
| 2. More than two windows rebuild the original | `can be followed across more than two windows to rebuild the original` |
| 3. 1999/2000/2001/4000(/4001) boundaries, no empty extra window | `window boundaries > reads a N-character line in K window(s) with no empty window` |
| 3. Negative and fractional `column_offset` rejected | `rejects a negative column_offset`, `rejects a fractional column_offset` |
| 3. At or beyond line end terminates | `returns an empty window with no continuation at the end of the line` |
| 3. `column_offset` works on short lines | `applies the column window to a short line` |
| 4. Mixed short/long lines, nonzero line offset in absolute coordinates, real pagination alongside clipping | `uses absolute line numbers for clipped lines and still paginates real lines` |
| 4. Multiple clipped lines in one read, no false next page | `lists every clipped line in one read without suggesting another page` |
| 4. Clipped list is bounded and the omitted lines are recoverable: the narrowing call is executed, then the tail calls it lists, at `column_offset` 0 and 50 | `bounds the clipped-line list at column_offset N and the omitted lines are recoverable` |
| 4. A nonzero `column_offset` applies to every selected line (long, medium, short), and the advertised tails are retrieved | `applies a nonzero column window to every selected line` |
| 4. Annotated clipped lines: git marker first, then the line number, on the clipped window and the continuation window, in both tools (real git repo, modified line) | `annotated clipped lines > read_file puts the git marker first...`, `annotated clipped lines > read_line_range puts the git marker first...` |
| 4. Line numbers in continuation windows | `keeps absolute line numbers in a continuation window` |
| 5. `read_line_range` guidance executes a `read_file` tail retrieval | `read_line_range > directs a clipped line to a read_file call that retrieves the tail`, `adds no clipping note for lines within the cap` |
| 6. Ordinary reads, real pagination, last page, line-number formatting, other helper consumers | `unchanged behavior > *` |
| Unicode: windows do not split surrogate pairs and concatenate to the source, for `read_file` and for the windows `read_line_range` advertises | `does not split a surrogate pair across windows`, `read_line_range > does not split a surrogate pair across the windows it advertises` |
| Helper boundary: callers that omit the column offset keep the exact original clip (`substring(0, 2000)` plus marker, even across a surrogate pair); an explicit column offset selects continuation-aware clipping | `unchanged behavior > keeps the exact baseline clip for helper callers that omit the column offset`, `... lets a caller select continuation-aware clipping explicitly with a column offset`, `... keeps the default 2000-character clip for other helper consumers` |

## RED / GREEN

First pass (before the review):

- RED (whole file against unmodified source): `tmp/verify3599/red-all.log`, 6 pass / 15 fail.
  The 6 passes are guards for behavior that must not change (small file, line-number
  formatting, default helper clip, no-clip range read) plus the 1999 and 2000 boundary
  cases, which already read as a single window. An earlier draft of the continuation
  line-number test passed vacuously, so it was tightened to compare the window text
  before this RED log was recorded.
- GREEN: `tmp/verify3599/green-all.log`, 22 pass / 0 fail.
- RED for the list bound: cap mutated to 100, `tmp/verify3599/red-list-cap.log`, 1 fail; restored.
- RED for the surrogate guard: guard disabled, `tmp/verify3599/red-surrogate.log`, 1 fail; restored.
- Before/after repro: `tmp/verify3599/repro.log` (before), `tmp/verify3599/repro-after.log` (after).

The first pass wrote tests as one batch and implemented as one batch, not strictly
one behavior at a time. The list-bound and surrogate tests were added after the
implementation and validated by mutation. That history cannot be made test-first
retroactively and stays disclosed.

Review remediation (test-first; logs in `tmp/verify3599/remediation/`):

- RED: new tests written first and run against the unremediated candidate,
  `red.log`, 26 pass / 3 fail. The failures are the helper default (the omitted
  column argument shortened `'x'.repeat(1999) + '😀' + ...` to 1999 characters instead of
  the original 2000) and the bounded-list narrowing at `column_offset` 0 and 50 (the
  omitted lines had no executable continuation).
- The multi-line column window and the git marker placement tests describe behavior
  that already held, so they could not fail before the fixes. Mutation checks:
  applying the column window to the first line only, and swapping marker and
  line-number order, make those tests fail
  (`red-mutation-window-gitorder.log`: 4 fail); both mutations were reverted.
- GREEN: `green.log`, 29 pass / 0 fail (final run in the gate table below).

## Review and triage

- OCR: review skipped per Andrew 2026-10-09. It was not run.
- Delegated review: completed. A delegated reviewer produced an initial review of the
  candidate; the findings were triaged and are summarized in `plan.md` (four
  in-scope fixes: helper default, durable regression tests, immutable collection,
  review labelling; historical TDD provenance deferred; paging subsystem, grapheme
  offsets, automatic shifting of explicit positions and duplicate core/dependency/
  workflow/memory/rule changes rejected).
- All four in-scope fixes are done in this candidate: the helper default, the durable
  regression tests, the immutable collection, and the review labelling carried by this
  file.
- Source follow-up: passed. A findings-only follow-up review verified the original
  scope and the four in-scope findings above. All four are resolved, and no Blocker or
  In-scope finding remains. Two local source review cycles were run in total (the
  initial review and this follow-up); no further cycles were run.

## Earlier environment notes

- During first verification, `default-app-layout.cap` failed on the unmodified baseline
  (`tmp/verify3599/baseline-default-app-layout.cap.log`: 14 pass, 1 fail) because the
  installed `node_modules` did not have the repository's `patches/` applied (the `ink`
  patch had not been applied). Running `patch-package` (`tmp/verify3599/env-fix/`) fixed
  the local install, and the file then passed (`tmp/verify3599/rerun/patched-cap.log`,
  15 pass; `patched-resize.log`, 6 pass). This is a local installation fix with no
  repository change.
- The later full-suite failures under host load are described below. They are
  attributed to contention only as an inference; no unrelated cause was diagnosed.

## Full verification after the review remediation

Run by `tmp/verify3599/remediation/run-gates.sh`; exits in `tmp/verify3599/remediation/exits.log`.

| Command | Exit | Log |
| --- | --- | --- |
| `npm run format` | 0 | `tmp/verify3599/remediation/format.log` |
| `npm run typecheck` | 0 | `tmp/verify3599/remediation/typecheck.log` |
| `npm run lint` | 0 | `tmp/verify3599/remediation/lint.log` |
| `npm run build` | 0 | `tmp/verify3599/remediation/build.log` |
| `npm run test` (run 1, default concurrency) | 1 | `tmp/verify3599/remediation/test.log` |
| `npm run test` (run 2, default concurrency) | 1 | `tmp/verify3599/remediation/test-rerun.log` |
| `npm run test` (post-review attempt 1, concurrency 1) | 1 | `tmp/verify3599/postreview/test-1.log` |
| `npm run test` (post-review attempt 2, concurrency 1) | 0 | `tmp/verify3599/postreview/test-2.log`, `test-2.exit.log` |
| `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` | 0 | `tmp/verify3599/remediation/smoke.log` |
| `bun scripts/test-audit/scan.ts` | 0 | `tmp/verify3599/remediation/scan-candidate/` |

The first lint run on this remediation failed `max-lines` on `fileUtils.ts` (807 > 800).
The rule was left alone. The guidance formatter moved to
`packages/tools/src/utils/clippedLineGuidance.ts` and all gates were rerun
(`tmp/verify3599/remediation/attempt1/` holds the superseded logs).

`npm run test` did not exit 0 in either run, and every failure is in a file this change
does not touch. The machine had a load average of about 20 from sibling sessions.

- Run 1: 4 CLI sandbox files hit 30s timeouts (`sandbox-orphan-reaping`,
  `sandbox-podman-diagnostics`, `sandbox-launch-release`, `sandbox-seatbelt`) and 2 tools
  files failed (`ast-read-memory.bun.test.ts`, `direct-web-fetch.test.ts`).
- Run 2: tools and every other workspace passed; one CLI file failed
  (`sandbox-podman-diagnostics`, a different test than in run 1).
- All six files pass when run alone (`tmp/verify3599/remediation/iso-*.log`,
  `iso-exits.log`, all exit 0). The earlier baseline (pre-remediation) full run
  exited 0: `tmp/verify3599/final5/test.log`, `final5/exits.log`.

The new test file passes 29/29 in both full runs, and its own run is in `green.log`.

## Final full-suite run on the current candidate (post-review)

Candidate state during the runs: HEAD `c214b23f16771da9536468e1b79e151e336f214f`, the three
modified tracked files (`read-file.ts`, `read_line_range.ts`, `fileUtils.ts`) with
`git diff` SHA-256 `3a159f8b0af637433b17a8154a16c8b73b08fc96381d661f48163f76d0ccda99`,
plus the untracked test file, `clippedLineGuidance.ts` and `project-plans/issue3599/`.
The diff hash was identical before attempt 1, before attempt 2 and after attempt 2, so
no source changed between the runs. Nothing is committed or pushed.

The earlier failures coincided with heavy host load (load average 20 to 55 from
sibling checkouts on 16 cores) and every one passed when rerun, which points to
contention rather than the change; that is an inference, not a diagnosis. The runners already document a concurrency override
(`dev-docs/bun.md`, `dev-docs/test-runner-inventory.md`, `scripts/lib/bun-test-policy.ts`):
`LLXPRT_CORE_TEST_CONCURRENCY`, `LLXPRT_CLI_TEST_CONCURRENCY`,
`LLXPRT_AGENTS_TEST_CONCURRENCY` and `LLXPRT_AUTH_TEST_CONCURRENCY`. The other
workspaces use the shared `scripts/run_bun_tests.ts`, which already runs files one at a
time. The override only lowers the number of files in flight. No test, assertion,
timeout, filter or exclusion was changed.

Exact command, run by `tmp/verify3599/postreview/run-test.sh <attempt>` under `nohup`:

```
LLXPRT_CORE_TEST_CONCURRENCY=1 LLXPRT_CLI_TEST_CONCURRENCY=1 \
LLXPRT_AGENTS_TEST_CONCURRENCY=1 LLXPRT_AUTH_TEST_CONCURRENCY=1 npm run test
```

- Attempt 1 (`test-1.log`, exit 1, load average 55 at finish). Two failures, both in files
  this change does not touch:
  - `packages/core/src/services/shellBoundedAcquisition.bun.test.ts`, "preserves exit code
    and completes despite bounded output": a spawned child returned exit code 1 instead of 0.
    Core reported 462/463 files.
  - `packages/cli/src/utils/sandbox-launch-release.test.ts`, "leaves no sidecar
    process-group descendants after repeated proxied launches": `kill(-pgid, 0)` returned
    `EPERM`, a permission error on the probed process group, while sibling sessions were
    running. The cause was not investigated. CLI reported 775/776 files, 9910 passed, 1 failed.
  - Every other workspace passed.
- Attempt 2 (`test-2.log`, `test-2.exit.log`: `test attempt 2 exit 0`, finished 05:22 with
  load average 18), same command, same candidate. Every workspace passed:
  tools 140/140, storage 38/38, auth 45/45, settings 23/23, telemetry 45/45,
  ide-integration 10/10, policy 12/12, mcp 42/42, core 463/463, lsp 13/13,
  providers 648/648, agents 420/420 plus its second command 7/7, zed-acp 33/33,
  CLI 776/776 (9911 passed, 0 failed, 5 skipped, 13 todo), a2a-server 22/22,
  test-utils 15/15 and vscode-ide-companion 7/7. The 29 new tests pass in this run (`src/tools/read-file-column-offset.issue3599.bun.test.ts`,
  29 pass, 0 fail). The four `(fail)` lines in the core section of the log
  (`hangs`, `fails` x3) are runner self-test fixtures that are expected to fail inside
  files that report passing; they also appear in the baseline `final5/test.log`.

The first full-suite exit 0 on the current candidate is therefore attempt 2 of the
post-review runs. The two attempt 1 failures did not reproduce and were not investigated
further, since they touch neither the tools package nor the clipping code.

Other gates on this candidate were green in the remediation run above (format,
typecheck, lint, build, smoke, test audit scan) and are unchanged because no source
file changed afterwards.

Test audit scanner: the baseline `findings.tsv` (HEAD, without the new test file,
`tmp/verify3599/scan-baseline/`) and the candidate (`tmp/verify3599/remediation/scan-candidate/`)
are byte-identical (2113 lines each); no findings for the new test file or the new
guidance module.

Smoke output: three-line haiku, exit 0.

## CodeRabbit threads on merged PR 3855 (integration triage)

Candidate base: merge commit `1af0ca5a3` (main `e8ad032fa` merged into issue3599). No
design review was run; these are two CodeRabbit threads on the conflict integration.

| Thread | Location | Classification | Outcome |
| --- | --- | --- | --- |
| `PRRT_kwDOPB5qbc6rTNZs` | `read-file.ts:354`, pass `column_offset` without defaulting it to 0 | Reject | `read_file` is deliberately opt-in to continuation at the default 0, so the tail guidance this issue asks for reaches callers who omit the parameter. Passing `undefined` would restore the legacy clip with no way to read the rest of a long line. The tests that omit `column_offset` (for example "discloses the cap and recommends a call that retrieves the tail") fail without it. No code change. |
| `PRRT_kwDOPB5qbc6rTNZv` | `fileUtils.ts:886`, `columnOffset` displaced the public seventh `readText` argument | In-scope fix | Valid merge-integration defect. Upstream `processSingleFileContent(…, imageBudget, readText)` had `readText` seventh; the merge inserted `columnOffset` in front of it. A function passed as the seventh argument was read as a numeric offset and silently ignored as a reader. |

Fix: the exported signature is now `(filePath, rootDirectory, offset, limit, imageResizePolicy,
imageBudget, readText = readFileWithEncoding, columnOffset?)`, so the upstream positional
contract is unchanged and `columnOffset` is appended after it. The `read_file` and
`read_line_range` calls were reordered to match. The internal `processTextFile` argument order is
unchanged. No union type, `typeof` switch or compatibility wrapper was added.

RED then GREEN (`src/tools/read-file-column-offset.issue3599.bun.test.ts`):

- New tests: "reads through the seventh-argument reader when the column offset is omitted"
  (the callback reads a different temp file, so alternate content proves the injected reader
  was used), "keeps the injected reader when a column offset follows it", and "serves the
  registered read_file tool from the host reader with continuation enabled" (host
  `readTextFile` returns different content from the file on disk, and the recommended
  continuation call carries the explicit offset). The existing "explicit column offset"
  test was changed to pass `undefined` for the reader and `0` as the eighth argument.
- Before the fix (`tmp/verify3599/conflict-signature/red.log`): 29 pass, 3 fail. The failures
  were the reader-omitted-offset test, the reader-plus-offset test, and the re-ordered explicit
  offset test.
- After the fix (`green.log`): 32 pass, 0 fail.

Full gates after the fix, logs in `tmp/verify3599/conflict-signature/`, run by `run.sh`
with the existing `LLXPRT_*_TEST_CONCURRENCY=1` controls and no suite changes:
lint exit 0, typecheck exit 0, format exit 0 (no files changed by format), build exit 0, smoke
(`lunahigh`, three-line haiku) exit 0, test-audit scan exit 0, `npm test` exit 0 on the
first attempt (CLI: 10133 passed, 0 failed, 5 skipped, 13 todo). The four `(fail)` lines in the
core section (`hangs`, `fails` x3) are the runner self-test fixtures, as in earlier runs.

Test audit: a baseline scan of a clean `1af0ca5a3` worktree and the candidate scan both report
2225 findings and their `findings.tsv` files are byte-identical. The three added tests produce no
findings.
