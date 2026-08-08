# Plan: Bound Long-Running Session Memory

Plan ID: PLAN-20260807-ISSUE3114
Generated: 2026-08-07
Issue: https://github.com/vybestack/llxprt-code/issues/3114

## Scope

This plan completes the remaining accepted work for issue 3114. Several sub-issues were split out and merged independently while this work was in progress; none of them may be duplicated here.

Already on `main` and therefore excluded from this change set:

- **PR #3117 (issue #3111)** — thinking-block coalescing in `StreamOutputAccumulator`. The primary retention fix. Exercised as acceptance evidence by the reasoning workload below, but not re-implemented.
- **PR #3123 (issue #3112)** — honest Bun memory footer and runtime-aware `--max-old-space-size` suppression.
- **PR #3125 (issue #3109)** — read-only history view instead of deep cloning.
- **PR #3124 (issue #3113)** — bounded and rotated error reports.

### In scope

- Await per-turn iterator cleanup before final timeout-controller teardown.
- Extend the existing issue-2852 memory target and runner with a reasoning workload and plateau verdicts for JSC heap, Bun external memory, and dirty WebKit Malloc.
- Correct the sandbox documentation that PR #3123 left describing the pre-#3112 behavior.

### Out of scope

- Issue 3109 history cloning, which was disproven as a retention cause and has since merged separately.
- Issue 3113 error-report rotation and rate limiting, which is a separate subsystem and disk/allocation problem, and has since merged separately.
- Shell output/backpressure candidates that were not the retained-string cause.
- Dependencies, workflows, public abstractions, speculative hardening, and unrelated refactors.

## Requirements and acceptance scenarios

### REQ-3114-1: Lossless bounded reasoning retention

**Requirement:** A reasoning span with a stable stream identifier retains one latest block regardless of streamed delta count, without losing complete reasoning content or provider metadata.

- **Given** a provider emits many full-so-far thinking blocks for one span,
- **when** the real stream accumulator materializes the response,
- **then** it contains one thinking block with the final complete text and metadata.
- **Boundary:** an interrupted span retains its latest delta; spans without identifiers preserve fallback behavior; unrelated content blocks retain their order.

**Evidence:** Keep `packages/agents/src/core/streamOutputAccumulator.bun.test.ts` green and exercise the same accumulator from the memory target. No new production implementation is required.

### REQ-3114-2: Cooperative stream cleanup completes at turn end

**Requirement:** A turn must await its provider iterator's cooperative asynchronous cleanup before the turn generator finishes, without allowing the turn's own abort to short-circuit that wait.

- **Given** `Turn.run()` is consuming a provider iterator whose `finally` waits on a controlled release,
- **when** the turn completes or its consumer exits early,
- **then** the turn remains unfinished until the provider cleanup release settles.
- **Boundary:** a non-cooperative `return()` remains bounded by the existing cleanup timeout.

**Integration contract:** `Turn.cleanupStreamResources()` owns final iterator closure and timeout-controller teardown. `closeIteratorBounded()` retains its existing external-abort behavior; only the caller's ordering and signal choice change.

### REQ-3114-3: Multi-metric post-GC plateau proof

**Requirement:** The existing issue-2852 harness must demonstrate that repeated equivalent reasoning turns plateau after GC rather than grow with turn count.

- **Given** a reasoning-mode target repeatedly sends full-so-far thinking updates through the real `StreamOutputAccumulator`,
- **when** the runner records post-GC checkpoints,
- **then** it evaluates JSC heap, `process.memoryUsage().external`, and dirty WebKit Malloc independently with the existing 10% plateau tolerance,
- **and** the overall verdict passes only when every required metric plateaus.
- **Boundary:** the first post-GC sample remains warm-up; missing/insufficient metric samples fail rather than silently pass.

**Integration contract:** add a `reasoning` mode to `scripts/issue-2852-memory-target.ts`; extend `scripts/issue-2852-memory-runner.ts`; reuse parsing and plateau helpers in `scripts/issue-2852-memory-benchmark.ts`.

### REQ-3114-4: Honest Bun memory footer

**Delivered upstream — not implemented here.** Issue #3112 was split out and merged as PR #3123 while this work was in progress. `Footer.tsx` now omits the V8 denominator under Bun and retains Heap, RSS, External and ArrayBuffers. Re-implementing it in this change would duplicate merged work, so the footer is taken unchanged from `main`.

### REQ-3114-5: Runtime-aware memory arguments

**Delivered upstream — not implemented here.** Also merged as PR #3123: `shouldRelaunchForMemory()` and `computeSandboxMemoryArgs()` return an empty argument list under Bun, with the Node paths unchanged.

The one gap PR #3123 left is documentation: `docs/sandbox.md` still described the Node heap limit as automatically derived regardless of runtime. That correction is carried here so the documented behavior matches the shipped behavior.

### REQ-3114-6: No silent content loss

**Requirement:** The implementation must not introduce truncation or discard conversation content.

- The reasoning accumulator's latest block contains the complete full-so-far reasoning value and metadata.
- No new length, count, or disk bound is introduced by this plan.
- Therefore no new truncation label is required.

## Test-first implementation sequence

### Phase 0: Preflight

- Confirm the merged accumulator implementation and its Bun behavioral tests are in branch ancestry.
- Confirm `Turn.run()` owns iterator finalization and that the existing cleanup timeout bounds non-cooperative iterators.
- Confirm the memory target already emits process memory and the runner already captures dirty WebKit Malloc.
- Confirm `process.versions.bun` is configurable in Bun tests so Node behavior can be simulated without a production testing hook or public abstraction.
- Confirm CLI and agents test runners discover new Bun test files.

### Phase 1: Turn cleanup RED/GREEN

1. Add a Bun behavioral test that drives the public `Turn.run()` generator with a provider iterator whose asynchronous `finally` is controlled by a deferred release.
2. Demonstrate RED: after early consumer exit, the turn incorrectly finishes before that release.
3. Change `cleanupStreamResources()` to request and await bounded iterator closure before aborting the timeout controller, without handing cleanup the controller signal that finalization itself owns.
4. Demonstrate GREEN and run existing iterator/Turn tests to preserve timeout and rejection behavior.

### Phase 2: Memory harness RED/GREEN

1. Add Bun-native tests for reasoning target selection, required metric extraction, and an overall verdict that fails if any one required metric grows.
2. Demonstrate RED because reasoning mode and multi-metric verdicts do not exist.
3. Add deterministic reasoning turns through the real accumulator, force post-turn GC, and verify each materialized result is one complete block.
4. Extend runner output and failure logic to report plateau results for heap, external, and dirty WebKit Malloc.
5. Demonstrate GREEN, then run the real reasoning target/runner on macOS with `--expose-gc` and preserve its captured output as verification evidence rather than a committed artifact.

### Phase 3 and Phase 4: superseded by PR #3123

The footer and bootstrap phases were planned before issue #3112 was split out and merged. Their implementation and tests now live on `main`, so both phases are dropped rather than duplicated. Only the sandbox documentation correction that PR #3123 did not make is carried here.

Verify the footer still renders honestly through the tmux harness, since this change set rebases onto that merged behavior.

### Phase 5: Verification and bounded review

Run focused tests after each phase, then run:

```sh
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Run the tmux-harness footer check, DeepThinker review, and detached Open Code Review with `--timeout 20`. Classify every finding as:

- **Blocker-Fix:** violates safety, correctness, accepted requirements, architecture, tests, lint, or CI.
- **In-scope-Fix:** a valid defect within REQ-3114-1 through REQ-3114-6.
- **Reject:** factually incorrect or contradicted by source/behavior.
- **Defer:** valid but outside the explicit scope above.

Do not perform more than two review/remediation cycles. All Blocker-Fix and In-scope-Fix findings must be resolved before commit.

## Completion gate

Issue 3114 is complete only when:

- Every requirement above has behavioral evidence.
- The real reasoning memory run reports a post-GC plateau for all required metrics.
- Full local verification and the Bun smoke test pass on the candidate head.
- Footer behavior has been exercised in the tmux harness.
- Reviews are complete and every finding is classified and resolved appropriately.
- The PR candidate head has correct ancestry, no conflicts, green CI, and no unresolved required review threads.
- No out-of-scope cleanup, hardening, workflow, dependency, or public abstraction change was added.
