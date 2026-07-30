# Issue 2852 — Bun/Ink memory amplification — FULL-ISSUE plan

## Delivery policy

`dev-docs/workflow/ISSUE-DELIVERY.md` is not present on current `origin/main`. This plan applies the bounded issue-delivery rules supplied with the issue request directly. `dev-docs/RULES.md` governs behavioral TDD.

Branch: `issue2852`

Issue: https://github.com/vybestack/llxprt-code/issues/2852

**Decision: COMPLETE FULL ISSUE SCOPE IN ONE PR.** The user has explicitly approved exceeding the prior 25-file / 1,500-line budget. All acceptance criteria (A1–A12) must be satisfied by evidence on the candidate head. This plan accepts every issue functional surface and closes the issue.

## Budget approval

User has explicitly authorized exceeding file/line count targets. All scope must remain functionally tied to issue 2852. No unrelated work. No stacked PRs. Do not commit, push, create a PR, or alter GitHub issue state.

## Verified baseline facts

- Ordinary content deltas currently update one pending history item outside Ink `Static`; they do not add one static item per token delta.
- The pending path still concatenates, sanitizes, scans Markdown, and republishes the entire cumulative response on every delta. Measured elapsed work grows ~fourfold when delta count doubles.
- `accumulateModelStreamChunk` copies all previously accumulated blocks on each chunk through array spreading (`[...acc.content.blocks, ...chunk.content.blocks]`). O(N²) total block copies for N chunks.
- UI history byte accounting serializes retained items on every committed mutation (`JSON.stringify` per item per mutation).
- Static history remounts on prefix eviction, not on ordinary pending deltas.
- Footer telemetry divides RSS by a JavaScript heap limit and presents a dimensionally invalid percentage.
- `useMemoryMonitor` tracks only RSS.
- `MemoryUsageDisplay` shows only RSS.
- Current OpenAI Responses code does not contain the issue-cited `accumulatedEvents` or `ResponseStateManager` paths. No speculative replacement.
- `CompressionHandler.compressionPromise` is awaited and cleared in finally. Pending compression lifecycle tests needed.
- `SessionRecordingService.queue` and `preContentBuffer` are unbounded arrays with drain-on-error clearing. Queue-depth/byte bound and stalled-operation tests needed.
- `toolResultTruncator` already has truncation stubs. History-level raw tool result retention bound tests needed.
- Bun 1.3.x, `bun:jsc.heapStats()`, `vmmap`, and `footprint` are available on this host. Instruments is unavailable.

## Acceptance matrix — FULL ISSUE (all PR-pass)

| ID | Accepted behavior | Behavioral evidence | Status |
| --- | --- | --- | --- |
| A1 | A deterministic long-text benchmark measures exactly one foreground LLxprt Bun PID. | Generated deterministic provider stream, exact PID validation, and terminal markers for every equivalent turn. | PR-pass |
| A2 | Checkpoints distinguish JSC heap, external/ArrayBuffer memory, RSS, macOS footprint, allocator regions, and IOAccelerator/IOSurface. | Parsed and raw `process.memoryUsage`, `bun:jsc`, `ps`, `vmmap`, and `footprint` evidence; missing required metrics fail the run. | PR-pass |
| A3 | Baseline, pre-GC, and one controlled post-full-GC checkpoint classify growth without using RSS as a heap proxy. | Ordered checkpoint artifact and category deltas. No production forced-GC behavior. | PR-pass |
| A4 | Long streaming does not perform cumulative immutable history publication or one static commit per delta. | Thousands of real deltas preserve exact text, emoji, Markdown, profile, and thought behavior with bounded pending publications and semantic terminal commits. | PR-pass |
| A5 | UI history byte accounting and static work do not scale as deltas multiplied by retained history. | Cached per-item/total byte accounting tests plus a regression proving pending deltas do not remount Static. | PR-pass |
| A6 | Every retained surface has a tested hard bound or release point. | Current-stream completion/cancel/error state released; raw tool history bounded; live output bounded; media bounded; oversized newest UI item retained; compression work released; recording queues bounded. | PR-pass |
| A7 | Equivalent turns reach a stable post-GC JSC heap/object plateau. | Turns 2/4/6 stay within robust absolute-or-relative heap, object, external, and ArrayBuffer ranges. | PR-pass |
| A8 | Physical footprint is bounded and RSS is report-only. | Post-GC footprint range is bounded; raw RSS and footprint remain separate. | PR-pass |
| A9 | IOAccelerator growth is eliminated, concretely attributed, or minimized upstream. | Text benchmark records this category; synthetic upstream reproduction script provided. | PR-pass |
| A10 | Product telemetry accurately labels heap used/limit, external memory, and RSS; platform footprint is separately reported by the macOS benchmark. | Semantic component tests use deliberately distinct values and prohibit an RSS/heap percentage. | PR-pass |
| A11 | Long streams, rolling history, large tools, stalled streams, and oversized media/history are behaviorally covered. | Long text, rolling UI history, interrupted current-stream, large tool output, media-heavy restore, stalled compression, and stalled recording tests. | PR-pass |
| A12 | Exact-head macOS tmux behavior and all normal quality gates pass. | Tmux benchmark/smoke plus full test, lint, typecheck, format, build, and profile smoke evidence. | PR-pass |

## Explicit non-goals

- No periodic production GC, broad history purge, larger heap limit, disabled streaming, reduced context/output defaults, or animation removal as a workaround.
- No dependency, Bun version, lockfile, workflow, settings schema, public API, public abstraction, agent-memory, quality-tool, or lint/complexity change.
- No production Inspector, `vmmap`, `footprint`, benchmark globals, or forced-GC behavior.
- No broad Ink Static/layout, terminal renderer, loading indicator, or text-width refactor.
- No speculative OpenAI Responses or DebugLogger change without a failing retention test.
- No private incident recording/profile in the repository.
- No multi-session orchestration, unrelated refactor/test move, suppression directive, or filtered final verification.
- Do not delete or modify anything under `.llxprt/`.

## Bounded vertical slices and TDD order

### S1 — Deterministic measurement (A1, A2, A3, A7, A8, A9, A12)

1. RED: parser and runner tests for exact PID, required metrics, `vmmap` regions, footprint, checkpoint order, and fail-fast handling.
2. GREEN: concrete issue benchmark, benchmark-only probe/preload, and minimum tmux step.
3. Run the current implementation as the baseline before production optimization.
4. Stop if PID identity, Inspector control, or required macOS metrics cannot be validated.

### S2 — Agents stream accumulation (A4, A6 current stream, A7)

1. RED: large real stream tests prove O(1)-per-chunk accumulation growth, preserving immediate yield order, canonical final history, metadata, usage, hooks, completion, abort, and exception behavior.
2. GREEN: replace repeated prior-block spreading inside `processStreamResponse` with a private immutable chunk-state accumulator that collects chunks without copying all prior blocks per delta, materializing once at terminal.
3. Keep the public `accumulateModelStreamChunk` function and contract unchanged.

### S3 — CLI pending text/thought stream (A4, A5, A6)

1. RED: real stream tests cover long chunks, split emoji, Markdown semantic boundaries, thought/profile metadata, done, cancel, error, idle timeout, and unmount; coalesced publication does not call full sanitization per delta.
2. GREEN: append through an immutable pending accumulator, sanitize only the tail/changed region, coalesce bounded live preview publication, and materialize exact terminal text once per semantic boundary.
3. Preserve the current pending-versus-Static layout and semantic safe-split behavior.

### S4 — Incremental UI history accounting (A5, A6)

1. RED: append, update, load, deduplication, UTF-8 bytes, changing limits, rolling eviction, oversized-newest retention, and O(1)-per-mutation byte accounting.
2. GREEN: immutable internal state caches each item size and total bytes incrementally while preserving the existing public hook shape.

### S5 — Accurate memory labels (A8, A10)

1. RED: semantic tests distinguish heap used, heap limit, external memory, and RSS in compact and detailed forms; prohibit RSS/heap percentage.
2. GREEN: remove RSS/heap percentage; label heap used/limit, external, and RSS explicitly.
3. Keep physical footprint in benchmark artifacts rather than spawning macOS tools in the foreground UI.

### S6 — Raw tool result bounds (A6, A11)

1. RED: behavioral tests with large real tool-response values prove bounded retained history and bounded scheduler live output while preserving terminal status and suffix semantics.
2. GREEN: bound raw tool results retained in UI history via existing truncation conventions and cap append-mode live output without cumulative copying.

### S7 — Aggregate media bounds (A6, A8, A11)

1. RED: synthetic image-heavy restore and oversized media history tests prove bounded retained media bytes/count and lifecycle behavior.
2. GREEN: bound aggregate retained-session media cloning via existing reference mechanisms.

### S8 — Compression queue lifecycle (A6, A11)

1. RED: stalled/incomplete compression tests prove release/failure behavior.
2. GREEN: ensure compression promise release on stall/error if a gap exists.

### S9 — SessionRecordingService queue bounds (A6, A11)

1. RED: queue-depth/byte bound and stalled-operation tests.
2. GREEN: bound queue depth/bytes with explicit backpressure or lifecycle release if a gap exists.

### S10 — DebugLogger/listener lifecycle (A6)

1. RED: lifecycle test proving logger disposal at ownership boundaries.
2. GREEN: ensure disposal at actual boundaries if a real retention path exists.

### S11 — Provider event/state fold/release (A6)

1. RED: behavioral lifecycle test for current-stream state release on completion/cancel/error.
2. GREEN: only behavioral lifecycle tests — no speculative code if no raw-event accumulator exists.

### S12 — Exact-head evidence (A12)

1. Re-run the identical deterministic benchmark and compare baseline/changed artifacts.
2. Require exact semantic output and stable post-GC ranges; RSS remains report-only.
3. Run macOS tmux verification and the full repository verification suite.

## Expected paths

### Measurement
- `scripts/issue-2852-memory-benchmark.ts`
- `scripts/issue-2852-memory-probe.ts`
- `scripts/tests/issue-2852-memory-benchmark.test.ts`

### CLI streaming
- `packages/cli/src/ui/hooks/agentStream/pendingTextAccumulator.ts`
- `packages/cli/src/ui/hooks/agentStream/__tests__/pendingTextAccumulator.test.ts`
- `packages/cli/src/ui/hooks/agentStream/contentEventProcessor.ts`
- `packages/cli/src/ui/hooks/agentStream/__tests__/contentEventProcessor.coalesce.test.ts`

### Agents accumulation
- `packages/agents/src/core/StreamProcessor.ts`
- `packages/agents/src/core/StreamProcessor.accumulation.test.ts`

### UI history
- `packages/cli/src/ui/hooks/useHistoryManager.ts`
- `packages/cli/src/ui/hooks/useHistoryManager.byte-accounting.test.ts`

### Tool result bounds
- `packages/cli/src/ui/hooks/useHistoryManager.tool-result-bounds.test.ts`

### Media bounds
- `packages/cli/src/ui/hooks/useHistoryManager.media-bounds.test.ts`

### Telemetry
- `packages/cli/src/ui/components/Footer.tsx`
- `packages/cli/src/ui/components/Footer.responsive.test.tsx`
- `packages/cli/src/ui/components/MemoryUsageDisplay.tsx`
- `packages/cli/src/ui/components/MemoryUsageDisplay.semantic.test.tsx`
- `packages/cli/src/ui/hooks/useMemoryMonitor.ts`
- `packages/cli/src/ui/hooks/useMemoryMonitor.test.tsx`

### Compression lifecycle
- `packages/agents/src/compression/CompressionHandler.lifecycle.test.ts`

### Recording bounds
- `packages/core/src/recording/SessionRecordingService.bounds.test.ts`

### DebugLogger lifecycle
- `packages/telemetry/src/debug/DebugLogger.lifecycle.test.ts`

### Provider event lifecycle
- `packages/agents/src/core/StreamProcessor.lifecycle.test.ts`

### Scheduler live output
- `packages/core/src/scheduler/liveOutput.ts`
- `packages/core/src/scheduler/liveOutput.test.ts`

### Retained media and history
- `packages/core/src/services/history/HistoryService.ts`
- `packages/core/src/services/history/HistoryService.media-bounds.test.ts`

### Recording implementation
- `packages/core/src/recording/SessionRecordingService.ts`

### Delivery record
- `project-plans/issue-2852-bun-ink-memory.md`

## Scope ledger

| Slice | Files | Status |
| --- | ---: | --- |
| Delivery record | 1 | Updated |
| Measurement | 3 | Pending |
| Agents accumulation | 2 | Pending |
| CLI pending stream | 4 | Pending |
| UI history | 2 | Pending |
| Tool result bounds | 1 | Pending |
| Media bounds | 1 | Pending |
| Telemetry | 6 | Pending |
| Compression lifecycle | 1 | Pending |
| Recording bounds | 1 | Pending |
| DebugLogger lifecycle | 1 | Pending |
| Provider event lifecycle | 1 | Pending |

The budget is approved for the complete issue, but every changed path must appear below. Net line counts are computed against `HEAD` after each completed slice; no path may be added without assigning it to A1–A12.

| Path | Slice | Acceptance | State | Net lines |
| --- | --- | --- | --- | ---: |
| `project-plans/issue-2852-bun-ink-memory.md` | Delivery | A1–A12 | Active | pending reconciliation |
| `packages/agents/src/core/StreamProcessor.ts` | S2/S11 | A4, A6 | Active from RED | pending reconciliation |
| `packages/agents/src/core/StreamProcessor.accumulation.test.ts` | S2 | A4, A7 | RED added | pending reconciliation |

Current exact changed-path count: **3**. Current implementation-path count: **2**. Current test-path count: **1**. Current delivery-record count: **1**. The table, counts, and `git diff --numstat` must reconcile before completion.

## Functional path map

- **Foreground process and measurement path:** benchmark runner starts one Bun CLI child, validates the exact foreground PID and executable identity, drives deterministic provider events, takes ordered baseline/pre-GC/post-one-full-GC checkpoints, and collects JSC/process/macOS metrics. Alternate Bun, output mode, animation, media, timeout, and tmux are explicit benchmark dimensions rather than production settings.
- **Core model-stream path:** provider chunks enter `StreamProcessor.processStreamResponse`, are yielded immediately, and are folded once into terminal content for hooks/history. Completion, cancellation, and exception all release per-stream chunk state.
- **CLI assistant/thought path:** Content and Thought events append to bounded pending state, publish coalesced previews at semantic-safe boundaries, and perform one exact terminal history transition for done/error/cancel/timeout/unmount.
- **UI retention path:** history mutations maintain cached UTF-8 byte sizes and total size incrementally; count and byte limits are hard, including bounded representation of an oversized newest item, without reserializing retained history or remounting Static per delta.
- **Tool path:** raw tool history and scheduler append-mode live output have hard byte bounds while preserving status, prefix/suffix context, and terminal updates.
- **Media path:** restored and newly appended media are bounded in aggregate by retained bytes/count; clone paths do not duplicate backing data unnecessarily, and release occurs when history is evicted/disposed.
- **Ancillary lifecycle path:** compression promises, queued history additions, recording queue/pre-content buffers, measured logger registries/listeners, and provider current-stream state are bounded or released on success, error, abort, timeout, and disposal.
- **Telemetry path:** foreground UI reports heap used/limit, external/ArrayBuffer memory, and RSS with dimensionally accurate labels; macOS footprint/allocator/IOAccelerator remain benchmark-only metrics.
- **Upstream-isolation path:** a synthetic Bun/macOS reproduction is added only when text/media A/B evidence isolates IOAccelerator growth outside retained LLxprt state.

## Review classification

Every finding is classified as one of:

- **Blocker-Fix:** accepted behavior, safety, architecture, or a required gate cannot complete without it.
- **In-scope-Fix:** valid defect within A1–A12 and the expected path ledger.
- **Reject:** incorrect, already satisfied, or outside accepted behavior.
- **Defer:** valid separate issue-level work that would expand this pull request.

Review suggestions never authorize scope expansion.

## TDD evidence ledger

Updated per slice as tests are written and pass.

| Slice | RED command | RED result | GREEN command | GREEN result |
| --- | --- | --- | --- | --- |
| S2 | pending | pending | pending | pending |
| S3 | pending | pending | pending | pending |
| S4 | pending | pending | pending | pending |
| S5 | pending | pending | pending | pending |

## Exact-head completion

This pull request is complete only when every acceptance criterion (A1–A12) has evidence on the candidate head; local verification and CI pass; reviews are complete and triaged; every Blocker-Fix and In-scope-Fix is resolved; `origin/main` is an ancestor; the pull request is conflict-free; and exact scope counts reconcile within the approved ledger.
