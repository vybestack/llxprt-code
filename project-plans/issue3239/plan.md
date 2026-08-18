# Plan: Serialize Same-Path Mutating Tool Calls (Issue #3239)

Plan ID: PLAN-20260817-ISSUE3239
Generated: 2026-08-17
Issue: #3239
Status: Verified — ready for pull request

## Problem statement

Tool calls in one scheduler batch execute concurrently. File-mutating tools use whole-file read-modify-write operations, so two calls whose target locations overlap can both read the same snapshot and then overwrite each other. Both calls may report success even though one update is lost; overlapping non-atomic writes can also leave partial file content.

The existing tool invocation contract already exposes each call's target locations through `toolLocations()` and classifies operations through `Kind`. The scheduler therefore has enough validated information to preserve parallelism while ordering only conflicting mutations.

## Preflight findings

1. `CoreToolScheduler.attemptExecutionOfScheduledCalls()` launches every scheduled invocation immediately and awaits the batch with `Promise.all`.
2. Scheduled calls already contain the validated tool and invocation, including `tool.kind` and `invocation.toolLocations()`.
3. Six built-in file mutation tools already expose the exact metadata needed for one generic fix: `replace`, `write_file`, `insert_at_line`, `delete_line_range`, `apply_patch`, and `ast_edit` are all `Kind.Edit` and return their target path from `toolLocations()`.
4. Scheduler-owned overlap ordering therefore fixes the reported race for all six tools without tool-name lists, new tool parameters, or per-tool locks.
5. Existing scheduler behavior intentionally preserves response publication order while allowing completion order to differ. The fix must preserve that contract.
6. The scheduler has explicit abort handling. A call waiting on a same-path predecessor must not begin side-effecting work after the batch signal is aborted.
7. `ast_edit`'s optional `last_modified` contract is independent optimistic concurrency control. Scheduler ordering protects same-batch calls even when that optional value is omitted.
8. The user explicitly accepted `save_memory` and todo persistence only if their races are real. A deterministic `save_memory` reproduction forced two concurrent additions to read the same snapshot: both calls completed, but the resulting memory contained only `beta` and lost `alpha`.
9. A real-filesystem TodoStore reproduction ran concurrent `writeTodos(newTodos)` and `writePausedState(true)` operations 50 times. It produced 48 valid-but-lost updates and 2 JSON-corrupt files containing invalid interleaved/truncated data. This is a proven instance of the reported failure class, not speculative hardening.
10. `save_memory` is currently `Kind.Think` and exposes no scheduler location despite writing a resolved file. It can join the accepted scheduler ordering by reporting its resolved memory path and using mutation metadata.
11. Todo tools obtain a fresh `TodoStore` instance for each call, and their legacy invocation wrapper exposes no location. The narrow fix is therefore an internal per-resolved-path TodoStore operation queue shared across instances; it must cover each complete read or read-modify-write transaction and retain parallelism across different todo files.

## Proposed accepted behavior

### REQ-3239-1: Preserve all same-path mutations in request order

**Full text:** Within one scheduler batch, mutating tool invocations whose normalized target-location sets overlap must execute in model request order rather than concurrently.

- GIVEN two or more `replace` calls in one batch with non-overlapping text anchors in the same file
- WHEN the batch executes
- THEN each later call reads the result of every earlier same-file mutation
- AND every requested replacement persists
- AND every successful response corresponds to content present in the final complete file
- AND the file tail remains intact

### REQ-3239-2: Retain parallelism for independent paths

**Full text:** Mutating calls whose normalized target-location sets do not overlap must remain eligible to execute concurrently.

- GIVEN mutating calls targeting different files
- WHEN they are submitted in one batch
- THEN neither call waits for the other solely because both are mutating

### REQ-3239-3: Fix every file mutation tool with the same scheduler race

**Full text:** Conflict detection must use validated invocation locations and existing mutating `Kind` values, without adding tool-name lists, public parameters, dependencies, or a public lock abstraction. The behavior must cover `replace`, `write_file`, `insert_at_line`, `delete_line_range`, `apply_patch`, and `ast_edit`.

- every `Kind.Edit`, `Kind.Delete`, or `Kind.Move` call with at least one location participates in overlap ordering, including future tools that use the same contract
- a multi-location mutation waits for all earlier mutations that overlap any of its locations
- read/search/fetch/execute/think/other calls are not newly serialized
- calls without a target location retain current scheduling behavior
- paths are compared after platform-native lexical normalization; filesystem-identity aliases such as symlinks and hardlinks are outside this issue

### REQ-3239-4: Preserve failure, response, and cancellation semantics

**Full text:** Ordering dependencies must not suppress later tool results or start queued side effects after cancellation.

- an earlier mutation's tool-level failure does not prevent a later same-path mutation from receiving its own execution/result
- response publication remains in original request order
- if the batch aborts while a same-path mutation is waiting, the waiting mutation does not start after its predecessor settles
- existing scheduler completion and abort behavior remains compatible

### REQ-3239-5: Preserve concurrent `save_memory` additions

**Full text:** Concurrent `save_memory` additions targeting the same resolved memory file must execute in request order so each successful fact remains in the file. Memory files for different scopes/paths remain independent.

- the invocation reports the exact resolved project/global/core memory path through the existing location contract
- normal memory additions participate in scheduler same-path mutation ordering
- two successful additions to one memory file both persist
- additions to different resolved memory files remain parallel
- no memory schema, scope, confirmation, or storage-path semantics change

### REQ-3239-6: Make TodoStore transactions concurrency-safe across instances

**Full text:** TodoStore operations targeting the same resolved todo file must not interleave filesystem reads and writes. A todo-list update and pause-state update started concurrently must preserve both fields and leave valid complete JSON.

- queue ownership is internal to TodoStore and keyed by the once-resolved file path so fresh store instances coordinate
- `readTodos` and `readPausedState` cannot observe a same-process partial write
- each `writeTodos` read-preserve-write transaction is indivisible relative to same-path todo operations
- each `writePausedState` read-preserve-write transaction is indivisible relative to same-path todo operations
- different session/agent/path files remain parallel
- two complete `writeTodos` requests retain the API's intentional request-order last-list-wins semantics without corruption
- no todo schema, persistence format, resolver, reminder, continuation, or event semantics change

## Inputs and boundary cases

| Input/boundary | Accepted behavior |
| --- | --- |
| Two `replace` calls, same exact absolute path | Sequential in request order; both edits persist |
| Three or more same-path mutations | Entire chain executes in request order |
| `absolute_path` versus legacy `file_path` resolving to the same location | Sequential after invocation normalization |
| Different target files | Parallel execution retained |
| Multi-location mutation overlapping an earlier mutation on one path | Waits for the earlier overlapping mutation |
| Earlier same-path mutation returns an error result | Later call still executes and reports its own result |
| Abort while a call waits on a predecessor | Waiting call does not begin side effects |
| Read plus ordinary workspace-file mutation on the same file | No new read/write ordering guarantee in this issue |
| Two `save_memory` additions to one resolved memory path | Sequential; both facts persist |
| `save_memory` additions to different scope paths | Parallel execution retained |
| Todo list write plus pause-state write to one todo file | Both fields persist as valid complete JSON |
| Todo read concurrent with same-path todo write | Read observes a complete before-or-after state, never partial JSON |
| Todo operations for different session/agent paths | Parallel execution retained |
| Separate processes, symlink aliases, or hardlink aliases | Outside this issue |

## Explicit scope boundaries

- No `last_modified` parameter or schema change for `replace` or `write_file`.
- No atomic-write helper or rewrite of individual file tools.
- No tool-description warning once same-batch conflicts are fixed.
- No cross-process filesystem lock or coordination; accepted ordering is process-local.
- `save_memory` changes are limited to exposing its already-resolved path/mutation metadata and proving same-path additions persist.
- Todo changes are limited to an internal process-local, per-resolved-path operation queue and its behavioral tests; no public lock abstraction is added.
- No dependency, workflow, agent-memory, quality-tool, lint-policy, complexity-threshold, or unrelated refactor change.
- No changes to independent-call parallelism or result publication ordering beyond the accepted overlap dependencies.

## Test-first implementation sequence

### Phase 1: RED — scheduler behavioral regressions

Add focused Bun tests beside `CoreToolScheduler` using real scheduler behavior and test tool invocations that expose real mutation locations.

1. Same-path mutations: hold the first call open and prove the second does not start; release calls and prove request-order completion.
2. Three-call chain: prove every same-path mutation starts only after its predecessor settles.
3. Different paths: use a barrier to prove both calls start before either is released.
4. Multi-location overlap: prove overlap on any location creates the dependency.
5. Failure continuation: prove a failed predecessor does not suppress the later same-path call.
6. Abort while waiting: prove the waiting invocation never starts after abort.
7. Real built-in tool integration matrix through the scheduler:
   - `replace`: two non-overlapping replacements both persist and the tail remains complete.
   - `write_file`: two writes complete in request order, the second complete payload is final, and no partial tail remains.
   - `insert_at_line`: two inserts both persist in request order.
   - `delete_line_range`: two deletions based on sequential file state both persist.
   - `apply_patch`: two non-overlapping patches both persist.
   - `ast_edit`: two edits without `last_modified` both persist in request order.
8. Mixed-tool same-path regression: at least two different built-in mutators targeting one file are ordered by path rather than tool name.
9. Real `save_memory` scheduler regression: concurrent same-scope additions both persist; different resolved paths can start in parallel.
10. Real TodoStore regressions across separate store instances:
    - concurrent `writeTodos` plus `writePausedState` preserves both values and valid JSON;
    - a concurrent read returns complete parseable before-or-after state;
    - same-path operations execute in request order after an earlier failure;
    - different session/agent/path operations can overlap;
    - queue entries are released after success and failure.

Run each focused test before its production change and retain the failing RED evidence.

### Phase 2: GREEN — minimal scheduler ordering

1. Build turn-local/scheduler-batch dependency chains from mutating scheduled calls and normalized `toolLocations()` paths.
2. Launch independent calls immediately.
3. Launch an overlapping call only after its earlier path dependencies settle, unless the batch signal has aborted.
4. Keep the existing aggregate wait, ordered publication, and error handling contracts.
5. Have `save_memory` expose its resolved path and participate in the existing mutation contract; add no tool-name special case.

### Phase 3: GREEN — TodoStore transaction ordering

1. Resolve the todo path once at each public store operation boundary.
2. Queue the complete read or read-modify-write transaction behind earlier operations for that exact normalized path, including operations from other TodoStore instances.
3. Release and remove queue state after success or failure so later operations continue and the map does not retain inactive paths.
4. Keep different todo paths independent and preserve the existing data format and resolver behavior.

### Phase 4: Verification and review

1. Run focused scheduler and real-replace tests.
2. Run the complete verification cycle.
3. Run DeepThinker compliance review and classify each finding as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`.
4. Run at most two local Open Code Review passes, remediating all accepted findings test-first.
5. Commit, push, create the PR, watch CI, and run at most two PR OCR review passes.
6. Resolve every accepted review finding and confirm conflict-free ancestry before reporting ready to merge.

## Behavioral evidence required for completion

- A pre-fix failing test demonstrates overlapping same-path execution/lost-update risk.
- Post-fix same-path scheduler tests prove ordered starts for two and three calls.
- Real temporary-file scheduler tests prove request-order, complete-file behavior for `replace`, `write_file`, `insert_at_line`, `delete_line_range`, `apply_patch`, and `ast_edit`.
- A mixed-tool same-path test proves ordering is path-based rather than tool-name-based.
- Different-file tests prove independent mutations still overlap in execution.
- Failure and abort tests prove no suppressed result and no post-abort queued side effect.
- A real scheduler-backed memory test proves concurrent same-file facts both persist and different memory paths remain independent.
- Real TodoStore tests using separate instances prove list/pause updates are both retained, concurrent reads never parse partial JSON, failures do not poison the queue, and different todo paths remain parallel.
- Full local verification and smoke test pass on the candidate head.
- CI passes on the candidate head; all reviews are complete and triaged; all `Blocker-Fix` and `In-scope-Fix` findings are resolved; the PR is conflict-free.

## Verification commands

```bash
bun test packages/agents/src/core/coreToolScheduler.same-path-mutations.test.ts
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
git diff --check
```

## Alternatives deliberately not accepted in this proposal

1. Optional `last_modified` CAS: callers that omit it remain vulnerable, so it does not by itself deliver transparent safety for the reported batch.
2. Atomic rename only: prevents partial writes but still allows a stale whole-file snapshot to overwrite a successful edit.
3. A `replace`-only module-global mutex: fixes a narrower execution path, introduces process-global state, and leaves sibling mutators with the same scheduler race.
