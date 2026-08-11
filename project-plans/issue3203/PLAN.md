# Plan: Bound Discovered-Tool and Search Output Acquisition (Issue #3203)

Plan ID: PLAN-20260810-ISSUE3203
Generated: 2026-08-10
Parent: #3202
Dependency: #3200 / PR #3206

## Problem

Discovered tools append complete stdout and stderr strings before returning.
The git-grep, system-grep, and ripgrep paths retain every output Buffer and call
`Buffer.concat()` only after the subprocess closes. Their existing match and
token limits therefore run too late to prevent process-memory exhaustion.
Discovered-tool cancellation also sends only SIGTERM to the immediate child and
can wait forever when the process or one of its descendants ignores it.

## Verified Preflight

- The explicit `@vybestack/llxprt-code-tools/acquisition.js` subpath delivered by
  #3200 exists and exports `createDefaultByteBudget`,
  `BoundedCombinedCollector`, bounded head/tail output, multibyte-safe decoding,
  and `TruncationMetadata`.
- `BoundedCombinedCollector` enforces one aggregate budget across stdout and
  stderr and preserves per-stream output. No second retention implementation is
  needed and no `packages/core` import is permitted.
- The affected unbounded paths are:
  - `DiscoveredTool.runChildProcess` in `tools/tool-registry.ts`;
  - `tryGitGrep` and `setupSystemGrepHandlers` in
    `tools/grep/search-strategies.ts`;
  - `runRipgrepProcess` in `tools/ripGrep.ts`.
- Existing grep/ripgrep output parsing uses completion-time strings and splits
  with host `os.EOL`; subprocess output must instead be framed incrementally
  and accept both LF and CRLF.
- Existing search result contracts already expose partial-result concepts
  (`SearchResults.wasLimited` and ripgrep's limited result presentation).
- Existing test infrastructure uses Bun and `bun:test`. Real filesystem and
  subprocess behavior is exercised in `filesystem-tools.test.ts`; there is no
  discovered-tool execution suite, so a focused behavioral suite is required.
- No acquisition contract change is presently required. Semantic line framing
  may use a bounded incremental decoder while the shared collector remains the
  sole owner of retained process output and omission accounting. If
  implementation proves that the shared public contract must change, document
  the exact change on #3202 before modifying it.

## Formal Requirements

### REQ-3203-01: Bounded shared acquisition

**Full text:** Discovered-tool execution, grep, and ripgrep enforce a shared
aggregate stdout/stderr budget during acquisition, with no full-stream string
concatenation or completion-time `Buffer.concat` in those paths.

**Behavior:**
- GIVEN a subprocess emits more bytes than the acquisition budget
- WHEN one of the affected tools consumes its stdout and stderr
- THEN retained output stays within one shared aggregate budget and exposes
  exact omission metadata when the entire producer stream was observed.

### REQ-3203-02: Accurate partial results

**Full text:** Truncation metadata is surfaced so partial searches and tool
results are never presented as exhaustive.

**Behavior:**
- GIVEN acquisition omits bytes or semantic early-stop ends a producer
- WHEN the tool formats its result
- THEN both model-facing and display output identify the result as limited, and
  early-stop metadata does not claim an exact omitted-byte count.

### REQ-3203-03: Semantic search early stop

**Full text:** grep and ripgrep stop their subprocess once configured result
limits are satisfied where correctness permits.

**Behavior:**
- GIVEN a synthetic search tree contains more usable matches than requested
- WHEN git-grep, system-grep, or ripgrep reaches the applicable aggregate/file
  limit
- THEN it terminates the process tree through the bounded lifecycle helper,
  returns retained matches, and marks the result limited.

### REQ-3203-04: Bounded cancellation

**Full text:** Discovered-tool cancellation terminates the process tree with
bounded escalation rather than waiting indefinitely after SIGTERM.

**Behavior:**
- GIVEN a discovered tool and descendant ignore graceful termination
- WHEN its AbortSignal fires
- THEN POSIX sends SIGTERM and escalates to SIGKILL after a fixed grace period,
  while Windows terminates the process tree with a bounded `taskkill /T /F`
  operation, and execution settles.

### REQ-3203-05: Cross-platform parsing and spawn behavior

**Full text:** Windows process hiding and CRLF parsing remain correct.

**Behavior:**
- GIVEN LF or CRLF records, including multibyte characters split across chunks
- WHEN grep/ripgrep parse subprocess output
- THEN identical matches are produced without replacement-character corruption;
  all Windows child spawns retain `windowsHide: true`.

## Architecture and Integration

### Shared Acquisition

Use one `BoundedCombinedCollector` per subprocess with
`createDefaultByteBudget()`. Feed raw stdout/stderr Buffers directly into it.
The collector is the sole retained-output buffer and supplies bounded per-stream
text plus durable metadata at completion.

### Incremental Search Parsing

Add a small streaming line framer that:

1. incrementally decodes UTF-8 across chunk boundaries;
2. emits complete LF or CRLF records;
3. bounds an unterminated partial line so a single malicious line cannot become
   a new unbounded buffer;
4. forwards complete records immediately to existing line parsers;
5. retains only matches that can affect the configured result contract.

The line framer is semantic parsing, not a second output-retention collector.
It must never reconstruct or retain the full process stream.

For grep, stop when `maxResults` usable retained matches are reached or when a
new file proves that the `maxFiles` set is complete. Respect `maxPerFile` while
counting usable matches. For ripgrep, pass each workspace directory's remaining
aggregate match allowance into the subprocess and stop at the 20,000-match
contract. Any early stop sets limited/partial metadata.

### Process Lifecycle

Add a tools-local, platform-aware process-tree termination helper. It must not
import `packages/core`. POSIX subprocesses that require tree termination are
spawned in their own process groups and receive SIGTERM followed by guarded
SIGKILL. Windows uses an explicitly spawned, bounded `taskkill /PID <pid> /T /F`
operation. The helper observes child exit/close, clears timers/listeners, and is
idempotent across abort, early-stop, and close races.

### Result Integration

- `DiscoveredTool`: include the shared omission notice in successful and error
  results; preserve `(empty)`, error, exit-code, and signal formatting.
- grep: propagate acquisition/early-stop state through `SearchResults.wasLimited`.
  Do not invent an exact total when early stopping means the producer's full
  result count is unknowable.
- ripgrep: carry limited state separately from match count so reaching exactly
  the configured limit is not falsely equated with proof of additional output.
- Existing token limiting remains a final model-facing safeguard and is not a
  substitute for the byte budget.

## Test-First Phases

### Phase 01: Failing lifecycle and streaming-parser tests

Create Bun behavioral tests before production changes:

- LF and CRLF records split at every relevant boundary;
- multibyte UTF-8 characters split across chunks;
- one huge unterminated line and many tiny chunks remain bounded;
- graceful process exit prevents SIGKILL escalation;
- a real POSIX child that ignores SIGTERM is force-killed; Windows-specific
  process-tree assertions execute on Windows and remain skipped elsewhere.

Run the focused tests and confirm they fail for missing behavior, not because of
invalid test setup.

### Phase 02: Implement bounded lifecycle and semantic framing

Implement the smallest tools-local helpers needed to satisfy Phase 01. Keep
process policy out of `packages/tools/src/acquisition/`. Do not add a duplicate
head/tail collector or alter package boundaries.

### Phase 03: Failing discovered-tool behavioral tests

Add real-subprocess tests for:

- aggregate interleaved stdout/stderr far beyond the default budget;
- multibyte content and both one-huge-chunk and many-small-chunk producers;
- truncation notice and bounded model/display output on success and failure;
- cancellation of a process tree that ignores SIGTERM.

### Phase 04: Integrate DiscoveredTool

Replace string accumulation with `BoundedCombinedCollector`, preserve stdin JSON
and existing result/error behavior, enable process-group ownership where needed,
and route AbortSignal cancellation through bounded process-tree termination.

### Phase 05: Failing grep/ripgrep integration tests

Use real temporary git repositories and synthetic trees to prove:

- git-grep/system-grep/ripgrep do not materialize full producer output;
- subprocesses stop when semantic limits are satisfied;
- results are marked limited without claiming a false exhaustive total;
- acquisition-budget truncation is visible;
- LF/CRLF, multibyte, and Windows process-hiding behavior is preserved.

Tests must assert observable results and process settlement, not only mock calls.

### Phase 06: Integrate grep and ripgrep

Replace all affected chunk arrays and completion-time concatenation with the
shared collector and streaming parser. Propagate partial metadata through result
formatting and use the common termination helper for abort and early-stop paths.
Preserve strategy fallback only for genuine strategy failures; intentional early
stop is a successful limited result, not a fallback trigger.

### Phase 07: Regression and deferred-work sweep

- Verify no `Buffer.concat(stdoutChunks|stderrChunks)`, full-stream string
  append, SIGTERM-only cancellation, `os.EOL` subprocess parsing, TODO/HACK/STUB,
  or silent truncation remains in the affected paths.
- Verify no new suppression directives, lint severity downgrades, complexity
  threshold increases, ignored source blocks, or TypeScript suppressions.
- Run package-focused tests before the full repository gate.

## Verification Gate

The implementation must pass:

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

Before push, run detached Open Code Review with `--timeout 20`, address findings,
and repeat the verification gate for substantive changes.
