# Plan: Bound `ast_read_file` Native Memory and Working-Set Acquisition (Issue #3232)

Plan ID: PLAN-20260814-ISSUE3232
Generated: 2026-08-14
Issue: #3232

## Problem statement

A real `ast_read_file` invocation on a small TypeScript target can start up to five concurrent whole-workspace `@ast-grep/napi.findInFiles` traversals. The JavaScript timeout does not cancel those native producers, and the callback adapter can let the tool return before native traversal completes. A bounded Darwin reproduction reached approximately 7.82 GB RSS from one invocation; overlapping calls can exhaust a 32 GB workstation.

For `ast_read_file`, the resulting `repositoryContext`, `relatedFiles`, and `relatedSymbols` are absent from both `llmContent` and `returnDisplay`. The dominant native traversal is therefore dead work on this path. The useful Git working-set context is rendered to the LLM, but its current all-at-once file acquisition is also unbounded.

## Preflight findings

1. `ASTReadFileToolInvocation.execute()` passes the complete target to `ASTContextCollector.collectEnhancedContext()` and does not pass its `AbortSignal`.
2. `ASTEditToolInvocation.executePreview()` uses the same collector and renders repository and related-symbol data; that behavior is outside the removal and must remain intact.
3. `collectEnhancedContext()` already has caller-specific options for working-set collection, so caller-specific repository collection belongs at the same boundary rather than in output formatting.
4. `enrichWithWorkingSetContext()` currently reads every working-set file concurrently with `Promise.allSettled`, then retains every successful file and every extracted declaration.
5. The shared acquisition package provides a validated 4 MiB default byte budget and a finite 64 MiB hard maximum. The working-set implementation should reuse this established primitive instead of inventing another byte-budget type.
6. Existing tests use real temporary files, real Git repositories, and the real `ASTReadFileTool`; these patterns satisfy the behavioral-test requirement without mocking the component under test.
7. The dedicated Windows memory workflow currently runs only the memory-diagnostics test directory and is not triggered by AST tool changes.

## Requirements and behavior

### REQ-3232-1: Eliminate unobservable repository analysis from `ast_read_file`

**Full text:** `ast_read_file` must not collect repository metadata, build a workspace symbol index, enumerate a workspace for related symbols, or launch native related-symbol searches because none of those results are present in its model-facing or display output. `ast_edit` preview behavior that consumes repository and related-symbol context must remain compatible.

- GIVEN a supported source target containing several declarations and a workspace containing related symbols
- WHEN `ast_read_file` executes
- THEN it returns the same selected display content, local declaration/snippet context, metadata, and bounded working-set context without starting repository relationship analysis
- AND no producer started by the read invocation continues after the invocation resolves
- GIVEN the same target is used for `ast_edit` preview
- WHEN preview context is built
- THEN its existing repository/related-symbol behavior remains available

### REQ-3232-2: Bound working-set acquisition during collection

**Full text:** Working-set context must enforce finite file-count, aggregate-source-byte, retained-declaration, and concurrency policies before unbounded data is materialized. Exact-limit input is complete; the first over-limit condition produces bounded partial context and accurate reason/accounting metadata. Per-file size is checked before reading, aggregate source bytes are charged across the entire collection, and retained results never exceed any policy.

- GIVEN a normal Git working set within every policy
- WHEN `ast_read_file` executes
- THEN the current `WORKING SET CONTEXT` content remains compatible and is reported complete
- GIVEN exact file, byte, or declaration limits
- WHEN collection completes without observing additional eligible data
- THEN it is complete rather than falsely truncated
- GIVEN one-over or far-over input
- WHEN collection reaches a policy
- THEN it retains only bounded context, marks it partial, and identifies the limiting policy to the LLM
- AND it does not read or parse files after the authoritative stop
- GIVEN unreadable, missing, unsupported, or oversized files
- WHEN they are encountered
- THEN the collection remains bounded and reports accurate skipped/partial accounting without failing the target-file read

### REQ-3232-3: Honor cancellation throughout LLxprt-owned acquisition

**Full text:** The invocation signal must be threaded through enhanced-context and working-set acquisition. A pre-aborted signal performs no working-set reads or AST extraction. A signal raised during collection stops scheduling new reads and returns control without fire-and-forget work. The tool must not treat a cancelled partial collection as complete.

- GIVEN an already-aborted signal
- WHEN `ast_read_file` starts
- THEN no working-set file is read or parsed
- GIVEN cancellation during bounded collection
- WHEN an in-flight item finishes
- THEN no additional item is scheduled and the collection is identified as partial due to cancellation
- AND all promises owned by the invocation are settled before it resolves

### REQ-3232-4: Bound model-facing working-set rendering

**Full text:** Model-facing connected-file rendering must consume the bounded retained collection and must not create an unbounded declaration aggregate. A partial marker and concise accounting must fit within the same finite retained-item/output policy. Normal bounded output wording remains compatible.

- GIVEN complete context
- WHEN LLM content is built
- THEN existing `WORKING SET CONTEXT` file/declaration information remains present
- GIVEN partial context
- WHEN LLM content is built
- THEN the model sees an explicit partial marker and reason
- AND no omitted file/declaration is accidentally rendered or retained in result metadata

### REQ-3232-5: Cross-platform memory regression evidence

**Full text:** A safe child-process behavioral test must invoke the real `ASTReadFileTool` against a generated fixture that would trigger the former multi-symbol workspace fan-out, record peak RSS/private memory, and prove bounded completion without callbacks or acquisition continuing after the tool result. The fixture must be large enough to distinguish the old behavior while remaining safe for developer and CI machines. The same test must run under Bun on Windows and at least one non-Windows CI path.

- GIVEN a generated workspace and a target with several prioritizable declarations
- WHEN the real tool executes with a small line limit
- THEN peak process memory stays below a conservative cross-platform ceiling
- AND the child exits normally after proving work has drained
- GIVEN repeated or parallel safe invocations
- WHEN they complete
- THEN memory remains bounded and no invocation leaves native work running behind it

## Design constraints

1. Add an explicit enhanced-context collection option for repository relationship context. Preserve the existing default for callers that consume it, and have `ast_read_file` opt out deliberately.
2. Do not change public tool parameters or remove useful read output.
3. Reuse the shared acquisition byte-budget primitive. Keep count and concurrency policies internal to the AST working-set module.
4. Discover and charge work incrementally. Do not enumerate/read everything and slice afterward.
5. Use bounded workers or an equivalent immutable scheduling design; do not start one promise per working-set file.
6. Preserve deterministic working-set order so bounded output is stable.
7. Make partiality/accounting explicit in the enhanced context through bounded summary metadata, not a second copy of retained declarations.
8. Do not add dependencies, suppressions, lint exceptions, ignore rules, threshold increases, or public settings.
9. Do not redesign `ast_edit` cross-file semantics in this issue. The unsafe `findInFiles` implementation remains reachable only from behavior that currently consumes its output; broader redesign requires separate intent.
10. Prefer fail-fast validation and authoritative producer cancellation over timeout wrappers that merely abandon waiting.

## Test-first implementation sequence

### Phase 1: Read-path repository opt-out

1. Add a failing Bun behavioral test using the real collector/tool and a generated related-symbol fixture. Prove the read result retains local/display/working-set behavior and that the child process does not continue workspace activity after completion.
2. Add a companion regression proving `ast_edit` preview still receives its repository/related-symbol context.
3. Implement the minimal caller-specific repository-context option and pass the read invocation signal through the collector.
4. Run the focused AST-read/edit suites and preserve the RED-to-GREEN evidence.

### Phase 2: Bounded working-set acquisition

1. Add failing real-Git fixture tests for below-limit, exact-limit, one-over, far-over, per-file-size, aggregate-byte, declaration, deterministic ordering, and bounded concurrency behavior.
2. Add failing pre-abort and mid-collection cancellation tests that assert public returned context/metadata and observable filesystem effects rather than mock call counts.
3. Implement validated internal policies, stat-before-read, incremental aggregate charging, bounded scheduling, retained declaration limits, and partial accounting.
4. Add the partial marker to `ast_read_file` LLM rendering and verify normal complete wording remains compatible.
5. Run the focused tests after each RED/GREEN cycle.

### Phase 3: Cross-platform memory regression

1. Add a safe child-process Bun fixture that invokes the real tool and samples RSS/private memory.
2. Verify one, repeated, and parallel bounded invocations without generating a destructive workload.
3. Wire the focused memory regression into Windows CI and an existing non-Windows test path using plain `bun install` where installation is needed.
4. Keep workflow path filters narrow to the AST read implementation, its memory fixture, and the workflow itself.

### Phase 4: Full verification and review remediation

1. Run focused AST/tool tests, then the full repository verification commands.
2. Run DeepThinker review and Open Code Review, classify every finding against issue intent, and remediate grounded findings test-first.
3. Repeat no more than one additional review/remediation cycle if significant changes result.
4. Re-run full verification, smoke testing, Git diff review, and PR checks after remediation.

## Behavioral test matrix

| Area | Below limit | Exact limit | One over | Far over | Abort | Repeated/parallel |
| --- | --- | --- | --- | --- | --- | --- |
| Repository phase on `ast_read_file` | absent | N/A | N/A | N/A | no background producer | bounded |
| Working-set files | complete | complete | partial | partial | partial/cancelled | deterministic |
| Aggregate source bytes | complete | complete | partial | partial | partial/cancelled | bounded |
| Retained declarations | complete | complete | partial | partial | partial/cancelled | bounded |
| Model-facing rendering | compatible | compatible | explicit partial marker | explicit partial marker | explicit cancellation partiality | no duplicate growth |
| Process RSS/private memory | bounded | bounded | bounded | bounded | drains | bounded ceiling |

## Scope boundaries

- No removal of target-file AST declarations, relevant snippets, selected display content, display metadata, or useful bounded working-set context.
- No public schema or CLI setting changes.
- No change to the generic 20 MiB target-file gate.
- No line-range parser redesign in this issue; the dominant dead workspace traversal and used working-set acquisition are the accepted remediation.
- No general rewrite of `CrossFileRelationshipAnalyzer` or `ast_edit` repository relationships unless required to prevent `ast_read_file` from invoking them.
- No unrelated memory-history/provider/UI refactor.

## Verification commands

```bash
bun test packages/tools/src/tools/ast-edit/
bun test packages/tools/src/tools/file-size-gate.bun.test.ts
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
git diff --check
```

Before pushing, run detached Open Code Review with the required timeout floor and verify test files are included. After creating the PR, run `gh pr checks NUM --watch --interval 300`, evaluate every CodeRabbit thread against the source, remediate grounded findings, resolve addressed threads with an explanatory comment, and repeat verification until CI is green.

## Acceptance criteria

- The former repository-wide native fan-out is unreachable from `ast_read_file`.
- Current observable read functionality remains for ordinary bounded inputs.
- Working-set acquisition and rendering are finite by construction and explicitly partial when bounded.
- Cancellation schedules no new work and leaves no invocation-owned background work.
- Safe real-tool memory tests pass on Windows and non-Windows environments.
- All Bun tests and full project verification gates pass.
- No suppression, ignore, lint downgrade, complexity-threshold increase, package dependency, lockfile change, or `.llxprt` modification is introduced.
