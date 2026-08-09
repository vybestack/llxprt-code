# Issue 3185: CLI CI Partition Plan

## Scope

Split only the existing logical `cli` test shard into parallel GitHub Actions matrix legs. Keep the logical shard name, package selection, test discovery, per-file process isolation, canonical local suite, and required `Test` aggregator unchanged.

The implementation must not add dependencies, a new orchestration subsystem, code-coverage instrumentation, test exclusions, shared cross-file state, or unrelated workflow changes.

## Verified baseline

The issue cites four successful CLI-bearing CI runs:

| Run | Complete verdict | CLI job |
| --- | ---: | ---: |
| 31290737638 | 14m34s | 12m34s |
| 31285748447 | 15m00s | 10m00s |
| 31285400987 | 14m17s | 12m26s |
| 31276892758 | 14m04s | 12m27s |
| Mean | 14m29s | 11m52s |

The timestamps and conclusions were re-read from GitHub Actions before implementation. Current CLI discovery returns 682 sorted test files. The current runner executes each file in a separate `bun test` process and writes `packages/cli/junit.xml`. The PR workflow emits one matrix row per logical shard and runs the test matrix after `node_consumer_smoke`.

The repository currently has test-file coverage, not PR code-coverage instrumentation: `scripts/check-test-file-coverage.ts` verifies that every discovered test file belongs to exactly one executor. “Coverage evidence” below therefore means this test-file coverage invariant plus complete JUnit inventories.

## Accepted behavior

1. A representative CLI-affecting pull request receives its complete CI verdict in under 10 minutes on average across at least three successful GitHub Actions runs carrying the same partition implementation.
2. The union of CLI partitions equals the complete, structurally discovered CLI test inventory. No test is deleted, skipped, excluded, duplicated, or silently omitted.
3. Partition assignment is deterministic, pairwise disjoint, balanced by file count, and total for every discovered path. Adding or moving a conforming CLI test automatically places it in exactly one partition; it cannot fall outside an allow-list because no allow-list or manifest is used.
4. Missing or malformed external partition identity fails before any test process starts. An explicitly selected empty partition also fails rather than producing a green no-op run.
5. `discoverTestFiles()` remains unpartitioned so the repository test-file coverage guard continues to inspect the complete inventory.
6. Test isolation remains unchanged: every selected file still runs in its own Bun process with existing concurrency, timeout, and process-tree handling.
7. Each partition produces a complete JUnit document for its selected files. Matrix job names, reporter check names, and fork artifact names are unique per partition; the existing JUnit path remains consumable.
8. Unset partition identity remains a complete run. `npm run test`, `bun scripts/test.ts`, `bun scripts/test.ts --shard cli`, and nightly execution retain their complete local behavior.
9. Before/after workflow wall-clock, each partition’s job and test-step duration, inventory and case counts, JUnit checks, and test-file coverage are recorded from candidate-head CI.

## Inputs and boundary cases

### CLI runner input

`LLXPRT_CLI_TEST_PARTITION` is the only new external input.

- Unset, empty, or whitespace: run the full discovered inventory.
- `1of1`: run the full discovered inventory.
- `1of3`, `2of3`, `3of3`: run the corresponding one-based sorted round-robin partition.
- Noncanonical forms, zero/negative values, unsafe integers, or index greater than count: fail fast with an error naming the variable and received value.
- A well-formed identity that selects no files: fail fast with a distinct error.

### Matrix input

- No selected logical shards: no rows, preserving the existing docs-only/no-tests path.
- `cli`: three Ubuntu/Node 24 rows carrying `1of3`, `2of3`, and `3of3`.
- Any other shard: one row carrying `1of1`.
- Full logical selection: all current logical shards remain represented and every `(shard, partition, os, node-version)` tuple is unique.

## Design

### Runner partition

After `discoverTestFiles(root)` returns the complete sorted list, parse the optional partition identity and select files by:

```text
file position modulo partition count equals partition index minus one
```

This maps every array position to exactly one partition and preserves relative order. With the current inventory, three partitions contain 228, 227, and 227 files. Discovery itself must not read the partition input.

### Matrix expansion

Keep `selectedShards` and the canonical shard map logical. A small matrix builder in `scripts/affected-test-shards.ts` expands `cli` into three physical rows and assigns `1of1` to other logical shards. This avoids changes to `scripts/test.ts`, `scripts/test-shards.ts`, the checked-in affected-shard graph, the coverage-complete calculation, and the required `Test` aggregator.

The workflow passes each row’s identity through `LLXPRT_CLI_TEST_PARTITION`. Only the CLI runner consumes it. Matrix job names, JUnit reporter names, and fork artifact names include the identity.

## Test-first sequence

All changed/new tests use `bun:test`.

### RED 1: CLI runner behavior

Extend `packages/cli/test/run-bun-tests.test.ts` first to prove:

- absent and blank identities mean no partition;
- canonical identity parses;
- malformed, out-of-range, and unsafe identities fail;
- `1of1` is identity selection;
- partitions are deterministic, order-preserving, balanced, exhaustive, and disjoint across the real discovered inventory;
- adding a test fixture causes it to appear in exactly one partition;
- discovery returns the complete fixture inventory even while the environment variable is set;
- selection never introduces an input path that discovery did not return.

Run this file and record the expected RED failure before production edits, then implement only the runner behavior needed to make it green.

### RED 2: selector matrix behavior

Extend `scripts/tests/affected-test-shards.test.ts` first to prove:

- CLI-only selection creates exactly the three expected rows;
- a non-CLI shard creates one `1of1` row;
- an empty selection creates no rows;
- full selection preserves every logical shard;
- every physical row is unique and Ubuntu-only;
- GitHub output still reports unchanged logical shard, test-presence, and coverage-complete values while its matrix contains all CLI rows;
- configured partition counts name real logical shards and are positive integers.

Run this file and record RED before implementing matrix expansion.

### RED 3: workflow wiring

Add a focused Bun test under `scripts/tests/` using the existing workflow YAML parser. Prove that the `test_shard` job:

- includes partition identity in its display name;
- passes the exact environment variable to the shard test step;
- retains the logical `bun scripts/test.ts --shard` command;
- includes partition identity in reporter and fork artifact names;
- retains the existing JUnit glob and logical shard conditions.

Run it RED before editing `.github/workflows/ci.yml`, then make only the required wiring changes.

## Local verification

Required targeted checks:

- CLI runner test file
- affected-shard selector test file
- workflow wiring test file
- `bun scripts/check-test-file-coverage.ts`
- `npm run lint:test-shards`
- CLI partition invocations for all three identities, confirming the union count
- unpartitioned `bun scripts/test.ts --shard cli`, confirming the complete inventory

Required repository gates before push:

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

## Candidate-head CI evidence

For at least three successful runs carrying the same implementation:

1. Measure workflow `created_at` to the latest completed job and compute the mean. Acceptance requires a mean below 600 seconds.
2. Record all three CLI partition job durations and their `Run shard tests` step durations.
3. Extract each runner header, passed-file summary, and case-count summary. Confirm identities are exactly `1of3`, `2of3`, `3of3`, each reports the same discovered total, and selected file counts sum to the discovered total.
4. Confirm three distinct successful JUnit reporter checks and, where applicable, unique fork artifacts.
5. Confirm the test-file coverage guard is green with zero uncovered and zero multiply owned files.
6. Compare candidate partitioning files across measured heads; implementation changes reset the three-run evidence set.
7. Record the completed evidence here, in the PR, on issue 3185, and on parent issue 2702.

## Review finding triage

Every finding is assigned exactly one class:

- **Blocker-Fix:** accepted behavior, correctness, data/test loss, security, required gate, or mergeability would fail.
- **In-scope-Fix:** directly improves the bounded partition implementation or its required evidence without expanding architecture.
- **Reject:** factually incorrect, already covered, or conflicts with accepted behavior.
- **Defer:** valid but outside this issue, requiring another subsystem, public abstraction, dependency, unrelated workflow change, or adjacent cleanup.

Only Blocker-Fix and In-scope-Fix findings authorize changes in this effort.

## Explicitly out of scope

- New dependencies, orchestration systems, logical shard families, timing manifests, or public partition APIs.
- Code-coverage instrumentation or coverage-threshold changes.
- Changes to unrelated packages, individual CLI test behavior, test concurrency/timeouts, nightly workflow, selector dependency graph, `node_consumer_smoke` gating, or required-check aggregation.
- Test deletion, exclusion, consolidation, shared state, or `isolate=false`.
- Lint/complexity/safety weakening, suppression directives, ignores, or unrelated refactors/documentation cleanup.

## Local implementation evidence

- Focused partition, selector, and workflow tests: 156 passed, 0 failed.
- Test-file coverage guard: zero uncovered and zero doubly executed files.
- Logical shard guard: all 16 workspaces remain covered by the six canonical shards.
- Actual local CLI partition executions selected 228, 227, and 227 of the same 682 discovered files. Their case totals sum to 8,835 passed, 5 pre-existing skipped, 13 todo, and 8,853 total, matching the canonical unpartitioned CLI run.
- `npm run format`, `npm run lint`, `npm run typecheck`, and `npm run build` passed. The `stepfun-37` real-model smoke test passed.
- Two exact `npm run test` attempts and two runs with the supported agents concurrency override completed the unchanged workspaces but encountered changing `packages/agents` per-file child-process watchdog failures on macOS. Every reported file passed immediately when rerun alone. This implementation does not touch agents code, its runner, concurrency, or timeouts. No clean exact full-suite result was obtained locally; candidate-head Linux CI must therefore be green before completion, and any reproduced agents failure is a mergeability blocker.
- The original implementation subagent was instructed to work test-first but timed out without returning its RED transcript, so temporal RED evidence for the initial three slices is unavailable and is not claimed. Review remediation has captured RED evidence for unsafe-integer and noncanonical-whitespace inputs before their production fixes.

## DeepThinker review triage

| Finding | Class | Disposition |
| --- | --- | --- |
| Whitespace-wrapped noncanonical identities were accepted | Blocker-Fix | Fixed test-first by validating the original nonblank value; surrounding space, newline, and tab cases now fail. |
| Matrix construction mutated an accumulator | In-scope-Fix | Replaced with immutable `flatMap`/`Array.from` transformation. |
| Directly affected matrix and smoke comments were stale | In-scope-Fix | Corrected without changing workflow behavior. |
| Required full-suite gate lacked a clean result | Blocker-Fix | No unrelated runner change made; bounded evidence recorded above, with candidate-head CI retained as a hard completion gate. |
| Initial temporal RED transcript was unavailable | In-scope-Fix | Limitation recorded honestly above; no evidence was fabricated. |
| Change the unrelated agents harness | Defer | Outside issue scope absent a candidate-head failure. |
| Round-robin is nondeterministic, incomplete, duplicated, or unbalanced | Reject | Contradicted by real-inventory behavioral tests and all three actual partition runs. |
| Add partition-specific JUnit paths or alter the logical CLI smoke condition | Reject | Matrix workspaces are isolated; existing paths remain consumable and names are already partition-unique. |

## Open Code Review triage

OCR reviewed six of seven code/test/workflow files and returned one Medium finding; its `scripts/affected-test-shards.ts` task failed after an invalid line-range tool request. DeepThinker had already completed a full review of that file, and the two-review-cycle limit prevents another independent review round.

| Finding | Class | Disposition |
| --- | --- | --- |
| JavaScript `$` allegedly accepts `1of3` followed by a newline | Reject | Bun 1.3.14 returns `null` for the anchored regex against that input, and the behavioral trailing-newline rejection test passes. The claimed defect is not reproducible in the actual runner. |
