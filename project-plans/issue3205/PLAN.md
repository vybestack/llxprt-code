# Plan: Bound Workspace Analysis and Large-File Materialization (Issue #3205)

Plan ID: PLAN-20260810-ISSUE3205
Generated: 2026-08-10
Parent: #3202

## Accepted behavior

### Structural analysis

1. `dependencies`, `references`, and `exports` enforce finite file and retained-record budgets while traversing. They do not enumerate an unbounded file list and then slice it, and they do not build an unbounded record aggregate before limiting it.
2. The budgets are internal count policies owned by the structural-analysis module. They follow the validated, finite-budget pattern established by #3200 and may use the existing validated `tool-output-max-items` setting as an input, but they do not use the byte-oriented head/tail stream collector and do not add public tool parameters or settings.
3. The exact effective file and record budgets are reported with count metadata. At the exact limit, an exhausted traversal is complete; a one-over traversal is partial. Collection may observe one sentinel item beyond a retention limit to determine that more data exists, but it must not retain that item.
4. A budget stop or abort returns the records retained so far with `truncated: true`, an explicit partial indicator/reason, and accurate observed/retained/budget accounting. Counts that cannot be known after an early stop are marked inexact rather than presented as totals.
5. Existing `callers` and `callees` `maxNodes` behavior is unchanged. `definitions` and `hierarchy` are outside this issue because the issue body and required behavioral matrix specifically identify dependencies/references/exports; they are not pulled in as adjacent cleanup.
6. Structural tool serialization creates the aggregate JSON once for `llmContent`. `ToolResult.metadata` contains only bounded summary/truncation fields and does not retain a second reference to the full results aggregate.

### AST grep

1. `maxResults` is an acquisition-time retained-match bound. The tool materializes at most `maxResults` match records and stops the search after observing the first additional match needed to prove truncation; it does not collect every match and slice afterward.
2. Exact-limit input is complete and not truncated. One-over and far-over input returns exactly `maxResults` records and explicit partial metadata. Any count that is only a lower bound is labeled inexact; the tool does not claim an exact total after stopping early.
3. Abort during directory traversal returns the retained matches as a clearly identified partial result rather than silently presenting them as complete.
4. The existing AST parser/language behavior, pattern/rule semantics, glob semantics, workspace boundary, and public parameters remain unchanged.

### Shared pre-read file-size policy

1. Extend and export/reuse the existing stat/size policy in `packages/tools/src/utils/fileUtils.ts`; do not create a second file-size utility.
2. Before reading, parsing, diffing, backing up, or copying an existing target, the policy applies to the public AST read and modification paths: `ast_read_file`, AST edit preview/apply, `edit`, `apply_patch`, `insert_at_line`, `delete_line_range`, and the read-before-write path of `write_file`.
3. A regular file whose size equals the existing 20 MiB limit remains accepted. A file one byte over is rejected before content materialization with the existing `FILE_TOO_LARGE` classification/message contract. Missing-file creation behavior and directory/error behavior remain compatible.
4. `read_file`, `read_line_range`, and `read_many_files` continue to use the same gate with their existing acquisition limits, output formatting, and truncation behavior unchanged.
5. This issue does not add byte streaming for whole-file edits, change the 20 MiB limit, redesign AST parsing, or introduce a generic result-streaming protocol.

## Inputs and boundary cases

- Structural count inputs: no setting, a valid positive `tool-output-max-items`, exact effective file/record budget, one item over, many items over, and abort after partial traversal.
- Dependency records include forward and optional reverse records under one bounded accounting policy; deduplication must not allow retained output to exceed the record budget.
- Reference records are bounded across all result categories, not independently per category.
- Export records are bounded across the complete result.
- AST grep: zero/below-limit, exact `maxResults`, one-over, far-over across real files, and abort during a real directory traversal.
- File size: existing target at exactly `MAX_FILE_SIZE_BYTES`, target at `MAX_FILE_SIZE_BYTES + 1`, new-file write, and host filesystem-service versus native filesystem read paths.
- Signals already aborted before work and signals raised during traversal must never produce a falsely complete result.

## Behavioral evidence (Bun and `bun:test` only)

1. Extend the real-fixture structural-analysis suite with dependencies, references, and exports fixture trees that exceed file and record budgets. Assert retained aggregate size, exact-limit versus one-over metadata, abort partiality, and bounded serialized/metadata shapes. Do not use mock call-count assertions.
2. Add a real-fixture AST grep behavioral suite with far more matches/files than requested. Assert that output retains only the requested records and reports a lower-bound/inexact count after the first omitted match, which distinguishes bounded acquisition from the old collect-all-and-slice behavior. Cover exact-limit and abort.
3. Extend existing AST/edit and filesystem tool suites with programmatically created exact-20-MiB and 20-MiB-plus-one targets. Exercise the public tool paths and assert the over-limit error occurs without changing the file.
4. Add focused shared-gate boundary coverage in the existing `fileUtils` test suite and regression coverage sufficient to prove `read_file`, `read_line_range`, and `read_many_files` retain their existing behavior.
5. Tests use real temporary fixture trees/files and the real tools/parser. Filesystem infrastructure may be supplied through established test hosts, but tests must assert public results and filesystem state, not that a mock was called.

## Scope boundaries

- No changes to the #3200 bounded head/tail collector.
- No parser/language redesign and no generic streaming-result protocol.
- No new dependency, package, public tool parameter, setting, workflow, agent memory, suppression, ignore, lint downgrade, or complexity-threshold increase.
- No unrelated refactor and no expansion to structural `definitions`/`hierarchy` unless required to keep a directly shared internal contract compiling; any such compatibility edit must not add new behavior.
- No changes to normal read-tool acquisition policy beyond exposing/reusing its existing gate.

## Test-first sequence

1. Add failing structural dependencies/references/exports budget and abort tests.
2. Implement internal bounded file discovery/record collection and partial metadata; then remove aggregate duplication.
3. Add failing AST grep exact/overflow/abort tests, then implement bounded acquisition and accurate partial metadata.
4. Add failing shared gate and public AST/modification exact/over tests, then extend the existing file-size gate through every accepted target-read path.
5. Run focused suites after each red/green cycle, followed by the repository verification gates.

## Local completion evidence

### RED → GREEN behavioral evidence

- Structural budget tests first demonstrated retained output beyond the requested budget, missing partial metadata, incorrect reverse-dependency accounting, and false complete results. The final real-fixture suite covers exact-limit, one-over, far-over, shared forward/reverse accounting, global reference/export caps, file-budget stops, and pre/mid-traversal aborts.
- AST-grep tests first demonstrated collect-all-then-slice behavior and a false exact total. The final real-fixture suite covers below/exact/one-over/far-over limits, single-file overflow, skipped files, and pre/mid-directory aborts.
- File-size tests first demonstrated that seven accepted public modification/read paths materialized over-limit targets. The final suite covers each public path, exact 20 MiB acceptance, 20 MiB + 1 rejection, unchanged rejected targets, new-file creation, existing read-tool regressions, and native plus host-filesystem-service paths.
- Final focused issue suites: 74 passed, 0 failed, 173 expectations. Full tools workspace: 93/93 isolated test files passed.

### Final-candidate verification

- `npm run format`, `npm run format:check`, `npm run typecheck`, `npm run lint:eslint-guard`, `npm run build`, and `git diff --check` passed.
- The monolithic lint and test commands exceed the local synchronous shell ceiling, so their complete inventories were executed through bounded canonical/scoped partitions. Strict lint passed for all workspaces, integration tests, root-managed sources, and LSP.
- Tests passed for core (386/386 files), tools (93/93 files), providers (563/563 files), agents (372/372 source files plus 6/6 shared native Bun files), and CLI (682/682 files; 8,813 passed cases, 5 skipped, 13 todo). Every smaller workspace test command passed.
- Required smoke command passed with the `stepfun-37` profile and returned only a valid three-line haiku after the profile banner.
- No package manifest or lockfile changed. The shared file-size threshold remains 20 MiB, public tool parameters remain unchanged, and no suppression, ignore, lint downgrade, or complexity-threshold change was introduced.

### Local review disposition

- DeepThinker reviewed the implementation against this accepted plan. Grounded findings about skipped-file partiality, authoritative host-returned size validation, dependency partiality, and boundary coverage were classified `In-scope-Fix` and remediated test-first. Parser/public redesign suggestions were classified `Reject` because they violate explicit non-goals. No `Blocker-Fix` or `Defer` item remains.
- One local Open Code Review cycle selected 20 TypeScript files and emitted 10 findings. Seven grounded finding groups were classified `In-scope-Fix` and remediated; two behavior-changing suggestions were classified `Reject`; no finding was classified `Blocker-Fix` or `Defer`. OCR exhausted its own tool-round budget on `file-size-gate.bun.test.ts` and `structural-analysis/types.ts`; those files were independently covered by the 40-test file-size suite and full tools typecheck. The review-cycle ceiling precludes another local review.

### PR-hosted review disposition

- `In-scope-Fix`: authoritative host-returned AST-edit content was not size-validated immediately after acquisition. A RED host-divergence test proved that a small native target paired with over-20-MiB host content was accepted; the shared byte gate now rejects it before syntax/diff work.
- `In-scope-Fix`: a pre-aborted single-file AST-grep invocation still read and parsed its target. A RED real-file test now proves the invocation returns no matches with `partialReason: "aborted"` before acquisition.
- `In-scope-Fix`: structural record retention could increment accounting after the authoritative signal aborted. Focused RED tracker coverage now proves `tryRetainRecord()` stops without changing counts, and `markAborted()` only marks partiality when its signal is actually aborted.
- `In-scope-Fix`: the shared native stat gate treated every stat failure as a missing target. Real permission-boundary coverage now proves only `ENOENT` returns `null`; unexpected native stat failures are rethrown.
- `Reject`: proposals to add an absolute AST-grep `maxResults` schema ceiling, handle invalid infinite validated settings locally, split forward/reverse dependency budgets, raise the structural file ceiling, or change max-results/abort precedence conflict with the accepted public-contract and shared-budget design.
- `Reject`: claims that early AST-grep termination makes observed `skippedFiles` inaccurate, that dependency duplicate behavior affects export sentinel accounting, or that apply-patch/write confirmation loses the execute-time size error are inconsistent with the implemented ownership and result contracts.
- `Reject`: a redundant test guard, docstring-coverage churn, and the LLxprt walkthrough statement that committed behavioral tests were absent are optional, out of scope, or factually invalid. The committed suites were executed by the tools runner and CI.
- Five findings were therefore classified `In-scope-Fix` and remediated test-first; twelve were classified `Reject`. No PR finding remains classified `Blocker-Fix` or `Defer`.

### PR-remediation verification

- Focused issue and tracker suites passed: 81 tests, 0 failures, 198 expectations. The file-size suite passed 42 tests, AST-grep passed 19, structural integration passed 16, and focused tracker coverage passed 4.
- Full tools verification passed 94/94 isolated Bun test files. The AST-edit regression inventory passed 251 tests with 0 failures and 747 expectations.
- `npm run format`, `npm run format:check`, `npm run typecheck`, `npm run build`, `npm run lint:eslint-guard`, strict zero-warning ESLint for all remediation-touched TypeScript files, and `git diff --check` passed on the remediation candidate.
- The required `stepfun-37` smoke command passed and returned only a three-line haiku after the profile banner.
- The initial PR candidate had already passed all test/lint/build/review checks except one Windows installed-command job whose fixed 10-minute global npm installation ended with `ETIMEDOUT` before issue-specific execution. The failed job was rerun; the authoritative post-remediation CI run is required before final readiness.
- No package manifest, lockfile, workflow, `.llxprt` content, public tool parameter, setting/schema, suppression, ignore, lint downgrade, or complexity-threshold change was introduced.
