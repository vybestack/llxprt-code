# Plan: Bound `ast_edit` Preview Context and Eliminate Native Repository Fan-Out (Issue #3242)

Plan ID: PLAN-20260818-ISSUE3242
Generated: 2026-08-18
Issue: #3242

## Problem statement

A localized `ast_edit` preview on a 5,242-line, symbol-dense Rust file in `acoliver/worldviewer` rendered all 173 declarations. The preview also started up to five concurrent whole-workspace native `findInFiles` traversals. Those traversals ignored `.gitignore` and `.llxprtignore`, had no per-file size gate, and were abandoned by a JavaScript timeout without cancellation. Native work could therefore continue after preview returned and overlap the immediately following `force=true` apply. The incident exhausted host RAM and the execution environment died while the apply surfaced as `null`.

The target file's local declarations and preview text are not large enough to explain host-level OOM by themselves. The confirmed amplification is repository relationship analysis inherited from `ASTContextCollector.collectEnhancedContext()`. This is the same fan-out removed from `ast_read_file` by issue #3232, except `ast_edit` preview still enables it.

## Preflight findings

1. `ASTEditToolInvocation.executePreview()` calls `collectEnhancedContext()` with `collectWorkingSet: false` but leaves `collectRepositoryContext` at its default `true`.
2. Repository collection obtains Git metadata, chooses up to five target declarations, and starts one `findRelatedSymbols()` search per symbol concurrently.
3. Each all-language relationship search enumerates the workspace independently. Its ignore list contains only `node_modules`, `dist`, and `build`; Git and LLxprt ignore rules are not consulted.
4. The 10,000-file guard is applied only after enumeration. Files selected for native parsing have no per-file size gate.
5. The three-second relationship timeout is a non-cancelling `Promise.race`. Native traversal can continue after the returned promise settles and overlap the next tool invocation.
6. `executeApply()` performs `calculateEdit()` and writes the candidate. It does not collect enhanced context, rebuild a repository index, or retain a preview cache. The issue hypothesis that force mode duplicates a cached preview analysis is rejected. The cross-call retention is unfinished native work started by preview.
7. Preview renders every extracted declaration. It has no edit-line proximity selection and no model-facing byte cap.
8. The optimized local snippet collection already has a 1,000-character source budget, but preview reports its item count without a preview-specific item cap.
9. Every normal tool path returns a `ToolResult`; no `ast_edit` code path returns `null`. The observed `null` is consistent with process/host death outside normal return handling.
10. `ToolErrorType` has no resource-exhaustion member. An RSS watermark cannot guarantee recovery from native OOM: a pre-check cannot predict a later allocation, and a post-check runs too late. The accepted fix removes the unbounded producer and proves bounded process behavior instead of adding a speculative threshold.
11. LLxprt Code's largest current TypeScript source files are roughly 1,100–1,500 lines, while the incident file is over 5,200 lines. Preview limits must remain useful for LLxprt Code, LLxprt Jefe, and Worldviewer rather than adopting the issue's illustrative small defaults verbatim.

## Accepted behavior

### REQ-3242-1: Preview repository relationship fan-out is unreachable

**Full text:** `ast_edit` preview must not collect repository metadata, build a workspace symbol index, enumerate the workspace for related symbols, or launch native related-symbol searches. The preview does not require repository-wide relationships to validate or describe a localized exact replacement, and the current native producer cannot be cancelled safely.

- GIVEN a Git workspace containing many related symbols, ignored trees, and oversized source files
- WHEN a real `ast_edit` preview runs
- THEN it performs target-file analysis only
- AND no repository-relationship Git commands or native relationship traversal are started
- AND no preview-owned repository work remains active after the result resolves
- AND apply semantics remain unchanged

This requirement satisfies the issue's ignored/oversized-file safety criterion by making those files unreachable from preview repository analysis, rather than adding another ignore implementation around an uncancellable producer.

### REQ-3242-2: Declaration context is proximity-prioritized and bounded

**Full text:** Preview must render a deterministic, source-ordered subset of declarations selected by distance from the exact replacement's start line. It must retain enough context for large LLxprt/Jefe/Worldviewer-style files while preventing whole-file symbol-table output.

The initial internal policies are:

- at most **128 rendered declarations**;
- nearest declarations are selected by absolute line distance from the edit start;
- selected declarations are rendered in source order;
- an exact 128-declaration file is complete;
- a file with 129 or more declarations is explicitly marked bounded and reports selected versus total counts;
- at most **64 relevant snippets** are retained/reported for preview;
- small files within the policies retain their existing complete context behavior.

These values deliberately scale above the issue's illustrative 32-declaration/12-snippet suggestion. They are internal safety policies, not public settings or schema.

- GIVEN the synthetic 5,250-line Rust regression file with at least 170 declarations
- WHEN a localized edit is previewed near the middle, head, or tail
- THEN declarations nearest the edit are selected first
- AND no more than 128 are rendered
- AND unrelated declarations outside the selected neighborhood are absent
- AND the rendered declaration lines remain source ordered
- GIVEN 128 declarations
- WHEN preview runs
- THEN all 128 are available and no bounded marker is emitted
- GIVEN 129 declarations
- WHEN preview runs
- THEN only 128 are emitted and the bounded marker is present
- GIVEN a new or declaration-free file
- WHEN preview runs
- THEN preview succeeds with zero declaration context

A blanket `selected == all declarations` fallback is not accepted: for ordinary files below the policy, all declarations are finite and useful. The reproduction is bounded because its total exceeds the policy.

### REQ-3242-3: Model-facing preview content has a hard UTF-8 byte budget

**Full text:** `ToolResult.llmContent` for preview must never exceed **256 KiB UTF-8**, including path, validation errors, summary, declarations, truncation metadata, timestamp, and next-step instruction. Mandatory status and next-step lines take priority over optional declaration detail.

The 256 KiB policy replaces the issue's illustrative 64 KiB suggestion so previews remain useful for large production codebases while staying tiny relative to the memory incident. It applies to model-facing text, not `returnDisplay`: the existing diff display intentionally carries the current/candidate content needed by confirmation UI and remains subject to the existing 20 MiB target-file gate.

- GIVEN ordinary content below the budget
- WHEN preview runs
- THEN wording and detail remain compatible
- GIVEN declaration names, paths, or validation detail that would cross the budget
- WHEN preview is assembled
- THEN optional context is omitted deterministically
- AND the result includes a bounded marker
- AND the complete UTF-8 `llmContent` is at most 262,144 bytes
- AND the timestamp and apply instruction remain present
- GIVEN multibyte text at the boundary
- WHEN preview is assembled
- THEN truncation never splits a UTF-8 sequence

### REQ-3242-4: Preview followed immediately by force apply completes and drains

**Full text:** A real preview followed immediately by `force=true` against the same generated large file/workspace must complete normally, apply the exact requested change, and leave no repository traversal allocating after either result.

- GIVEN the 5,250-line, at-least-170-symbol Rust fixture in a fan-out-shaped Git workspace
- WHEN preview runs and force apply follows immediately with the preview timestamp
- THEN preview returns a non-null `ToolResult` without error
- AND apply returns a non-null success `ToolResult`
- AND the requested bytes are present on disk
- AND peak child-process RSS stays below the established cross-platform safety ceiling
- AND post-result RSS growth stays below the quiet-window ceiling
- AND the child exits normally

The child-process memory test is the behavioral substitute for the impossible claim that CI can induce a true machine OOM and still assert a structured return. It proves the actual incident path is bounded and drained without endangering the test host.

### REQ-3242-5: Existing preview/apply validation and failure behavior is preserved

**Full text:** Bounding context must not weaken exact-match validation, AST validation, file freshness, new-file preview, or apply refusal behavior.

- absent `old_string` still returns `EDIT_NO_OCCURRENCE_FOUND` and performs no write;
- missing files with non-empty `old_string` still return `FILE_NOT_FOUND`;
- stale `last_modified` still blocks apply;
- newly introduced syntax errors still block apply and preserve file bytes;
- pre-existing syntax errors remain categorized rather than treated as newly introduced;
- new-file preview/apply remains supported;
- files rejected by the existing target-file size gate still return its structured `FILE_TOO_LARGE` error.

## Inputs and boundary matrix

| Input/boundary | Expected behavior | Evidence |
| --- | --- | --- |
| 5,250-line Rust file, >=170 declarations, middle edit | nearest <=128 declarations, source ordered, bounded marker | real-tool regression test |
| Same fixture, edit near head | head-adjacent declarations selected | real-tool regression test |
| Same fixture, edit near tail | tail-adjacent declarations selected | real-tool regression test |
| 128 declarations | complete context, no bounded marker | exact-limit real-tool test |
| 129 declarations | 128 rendered, bounded marker | one-over real-tool test |
| Sparse declarations | nearest declarations win even across large line gaps | real-tool test |
| Tied distances | deterministic line-order tie break | focused selection test through preview output |
| No declarations/new file | zero context, valid preview | existing plus extended real-tool tests |
| Multibyte names/detail at byte edge | valid UTF-8 <=256 KiB, mandatory footer retained | byte-boundary test |
| Git workspace with ignored/oversized related files | no repository relationship commands/traversal | invocation-wiring canary plus memory fixture |
| Preview then force apply | both non-null; apply succeeds; content correct | real-tool integration test |
| Fan-out-shaped workspace | bounded peak RSS and post-result drain | cross-platform child-process test |
| Absent match/stale timestamp/new syntax error | existing typed failures preserved | existing force/preview suites |

## Test-first implementation sequence

### Phase 1: Repository fan-out opt-out

1. Add a failing invocation-wiring test around the real `ASTEditTool` proving preview starts no repository relationship phase. Reuse the issue #3232 Git-command canary pattern where supported.
2. Add a safe child-process regression workspace containing many related files plus ignored/oversized trees. Record peak RSS and a post-result quiet window for preview followed by apply.
3. Make preview pass `collectRepositoryContext: false` and thread its existing signal through collector options.
4. Run the focused tests and record RED/GREEN behavior.

### Phase 2: Scaled proximity and item bounds

1. Add the deterministic ~5,250-line Rust fixture generator with at least 170 real Rust declarations and unique edits at middle/head/tail.
2. Add failing behavioral assertions for proximity priority, source order, 128 exact/one-over behavior, 64 snippet cap, and bounded metadata.
3. Implement the smallest internal selection helper used by preview assembly. Keep policy internal; do not add tool parameters or public configuration.
4. Preserve complete small-file output behavior where it fits the policies.

### Phase 3: UTF-8 output budget and preview/apply integration

1. Add failing ordinary, over-budget, and multibyte-boundary tests asserting total `llmContent` bytes and mandatory lines.
2. Implement budget-aware preview assembly that reserves mandatory status/footer bytes before adding optional declaration detail.
3. Add the real preview-then-force apply case using the preview timestamp and verify exact file content.
4. Run all AST-edit suites, including existing validation and force-flag tests.

### Phase 4: Full verification and review remediation

1. Run the complete repository verification cycle.
2. Run a clean DeepThinker issue/compliance review and Open Code Review.
3. Classify every finding as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`. A suggestion does not expand scope.
4. Remediate all Blocker-Fix and In-scope-Fix findings test-first and repeat the full verification cycle. Use no more than two local OCR runs.
5. Create the PR only from the verified candidate, then watch all CI and CodeRabbit checks, triage every finding, and use no more than two PR OCR runs.

## Behavioral evidence required for completion

1. A generated Rust fixture is approximately 5,250 lines and has at least 170 declarations as parsed by the real extractor.
2. Its preview contains only proximity-selected declarations, respects 128/64 item policies, is source ordered, and carries truthful bounded metadata.
3. Preview `llmContent` is valid UTF-8 and no larger than 256 KiB, including an over-budget regression case.
4. Preview starts no repository relationship analysis, so ignored and oversized repository files cannot be read by that phase.
5. Preview followed by force apply succeeds and writes the exact intended bytes.
6. The safe child-process regression stays below the calibrated cross-platform peak RSS ceiling, shows bounded post-result growth, and exits normally.
7. Existing typed target-file resource failures and edit/validation failures remain intact; normal tool code never returns `null`.
8. Focused tests, full local verification, CI, reviews, ancestry, and conflict checks all pass on the candidate head.

## Explicitly rejected hypotheses and changes

- **Reject:** adding preview-cache eviction. No preview analysis cache exists, and apply does not rebuild enhanced context.
- **Reject:** a JavaScript timeout around native `findInFiles`. The existing timeout abandons waiting but does not cancel native work.
- **Reject:** a heap-only or RSS watermark advertised as an OOM guarantee. It cannot reliably predict or catch process-killing native allocation and would add platform-sensitive behavior without fixing the producer.
- **Reject:** general repair of `CrossFileRelationshipAnalyzer`, repository ignore semantics, or native cancellation. Preview will not call that subsystem. Redesigning it for other consumers is separate scope.
- **Reject:** a new public setting, schema, dependency, workflow, or agent-memory change.
- **Reject:** shrinking the established 20 MiB target-file limit or changing diff/confirmation display payloads.
- **Defer:** improving repository relationship analysis for callers that intentionally consume it.

## Scope boundaries

- No general AST collector rewrite.
- No changes to `ast_read_file`, bounded working-set acquisition, providers, UI, or unrelated tools.
- No public tool parameter or output-type changes.
- No dependency, lockfile, workflow, quality-rule, lint-threshold, ignore-rule, or `.llxprt` change.
- No speculative cleanup of local AST node/snippet duplication unless a failing accepted-behavior test proves it is required.
- No attempt to induce actual machine OOM in tests.

## Verification commands

```bash
bun test packages/tools/src/tools/ast-edit/__tests__/ast-edit-3242-regression.bun.test.ts
bun test packages/tools/src/tools/ast-edit/__tests__/ast-edit-preview.test.ts
bun test packages/tools/src/tools/ast-edit/__tests__/ast-edit-preview-gaps.test.ts
bun test packages/tools/src/tools/ast-edit/__tests__/ast-edit-force-flag.test.ts
bun test packages/tools/src/tools/ast-edit/
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
git diff --check
```

Before pushing and before creating the PR, repeat the full verification cycle. After PR creation, wait for every required check, resolve all actionable review threads, verify correct ancestry and conflict-free status, and stop when the PR is green and ready to merge. Do not merge without explicit user instruction.
