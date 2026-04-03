# Issue #1872: Stabilize streaming, tool-call continuation, and timeout enforcement

**Issue:** #1872
**Branch:** `issue1872`
**Related issue:** #1873 (continue mode can hang indefinitely after context corruption)

## Problem Statement

Issue #1872 reports intermittent hangs with several user-visible variants:

1. Fireworks Kimi sometimes shows thinking and sometimes partial text, then appears to stop around a tool-call boundary.
2. Subagents sometimes hang indefinitely.
3. Foreground agent turns can hang, especially in longer contexts.
4. The issue is easier to reproduce on underpowered hardware and when the machine is under load.
5. Subagent timeout appears ineffective in at least one hang pattern.

Current read-only analysis indicates this is **multi-cause**, not a single bug.

The strongest current explanation is:
- there are at least **two real indefinite-wait bugs** in subagent/turn orchestration,
- several foreground/core/UI flows still depend on stream progression without a strong idle watchdog,
- and Kimi/provider-specific buffering makes the symptom more visible around tool-call boundaries, especially under load.

## Code Evidence Summary

### 1. Subagent timeout enforcement is passive, not active

**File:** `packages/core/src/core/subagentExecution.ts`
- `checkTerminationConditions()` only compares elapsed time when execution returns to the outer loop.
- Relevant lines: `70-95`

**Why it matters:**
If execution is blocked inside a long `await`, the timeout is not actively enforced and may never get another chance to fire.

### 2. Interactive subagents have a concrete forever-wait path on tool completion

**Files:**
- `packages/core/src/core/subagentExecution.ts`
- `packages/core/src/core/subagent.ts`

**Evidence:**
- `createCompletionChannel()` returns `awaitCompletedCalls()` which resolves only when `handleCompletion()` is invoked.
- Relevant lines: `subagentExecution.ts:381-420`
- `handleInteractiveToolCalls()` waits directly on the completion promise after scheduling.
- Relevant lines: `subagent.ts:460-464`

**Why it matters:**
If the completion callback is delayed, missed, or never fired, the wait can persist indefinitely.

### 3. Stream-consuming loops depend on eventual next-event or clean close, without a hard idle watchdog

**Files:**
- `packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts`
- `packages/core/src/core/MessageStreamOrchestrator.ts`
- `packages/core/src/core/StreamProcessor.ts`
- `packages/cli/src/nonInteractiveCli.ts`
- `packages/core/src/core/subagent.ts`

**Evidence:**
- UI loop: `useStreamEventHandlers.ts:490-620`
- Orchestrator loop: `MessageStreamOrchestrator.ts:385-430`
- Stream processor loop: `StreamProcessor.ts:496-582`
- Non-interactive CLI loop: `nonInteractiveCli.ts:318-458`
- Subagent loops: `subagent.ts:399-417,619-635`

**Why it matters:**
A stalled provider stream or downstream event path can leave these consumers waiting indefinitely.

### 4. UI tool scheduling is deferred until after stream completion

**File:** `packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts`

**Evidence:**
- Tool requests are buffered during the stream: `513-518`
- `scheduleToolCalls()` runs only after the `for await` loop completes: `604-618`

**Why it matters:**
If stream completion or post-loop finalization stalls, the UI appears stuck at the tool-call boundary even if the tool request was already observed.

### 5. Kimi/provider-specific buffering likely amplifies the symptom

**File:** `packages/core/src/providers/openai/OpenAIStreamProcessor.ts`

**Evidence:**
- Buffered text mode for qwen/kimi: `255-257`
- Kimi section buffering and flush suppression: `387-448`
- Final flush and terminal assembly: `544-555,577-723`

**Why it matters:**
If buffered content or tool-call structure is only finalized at terminal processing, a stalled or incomplete terminal phase makes the user-visible symptom look like thinking/text stopped right at a tool-call boundary.

### 6. CodeRabbit findings to keep in scope

CodeRabbit identified several points that still matter in the current codebase:
- passive timeout enforcement,
- non-abortable completion wait in subagents,
- overlapping provider-side thinking/buffering paths.

The strongest CodeRabbit claim that remains **plausible but not yet proven** is that `tee()` backpressure in `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` is the primary runtime cause under load. That path is real and should be instrumented, but it should not be treated as settled root cause without runtime traces.

## Goals

1. Eliminate indefinite waits in subagent tool completion and turn execution.
2. Make configured timeout limits actively enforceable even while execution is inside inner awaits.
3. Add bounded idle-detection for stream-consuming loops so stalled streams fail deterministically instead of hanging forever.
4. Reduce dependence on post-stream-only transitions for tool execution where safe.
5. Preserve progressive output behavior and avoid regressions like buffered-all-at-once output.
6. Add targeted regression coverage for the observed hang classes.

## Non-Goals

1. Re-architecting the provider stack beyond what is needed to fix #1872.
2. Solving the persisted context corruption / `--continue` indefinite hang reported separately in #1873.
3. Broad refactors unrelated to timeout, stream progression, tool-call continuation, or provider buffering correctness.
4. Changing user-facing formatting except where required for correctness.

## Design Principles

- **TDD first**: every production change should be preceded by a failing behavioral test where practical.
- **Bound waits explicitly**: any wait on stream progress or tool completion must have a deterministic escape hatch.
- **Preserve inline streaming**: do not reintroduce collect-all-then-emit behavior.
- **Instrument before overfitting**: gather enough runtime evidence to separate proven causes from plausible ones.
- **Fix core bugs first**: start with the indefinite-wait paths that affect all models, then harden provider-specific behavior.

## Workstreams

### Workstream 1: Instrumentation and hang attribution

**Goal:** Identify where real reproductions spend time before changing behavior broadly.

**Files:**
- `packages/core/src/core/subagent.ts`
- `packages/core/src/core/subagentExecution.ts`
- `packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts`
- `packages/core/src/core/MessageStreamOrchestrator.ts`
- `packages/core/src/core/StreamProcessor.ts`
- `packages/core/src/providers/openai/OpenAIStreamProcessor.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- `packages/cli/src/nonInteractiveCli.ts`

**Add logs/telemetry around:**
- stream start, first event, last event, iterator completion,
- tool-call request observed,
- tool scheduling start/finish,
- `awaitCompletedCalls()` start and resolution,
- stream idle gaps,
- recursive continuation entries and exits,
- Kimi/openai-vercel buffering flush decisions.

**Deliverable:**
Deterministic logs identifying whether a failure is dominated by:
- stalled stream consumption,
- missing completion callback,
- post-loop tool scheduling never reached,
- provider buffering/finalization not completed.

### Workstream 2: Bound the subagent forever-waits

**Goal:** Remove the clearest indefinite-wait path first.

**Files:**
- `packages/core/src/core/subagentExecution.ts`
- `packages/core/src/core/subagent.ts`

**Planned changes:**
1. Add failing tests for interactive subagent hangs where tool completion callback never arrives.
2. Wrap `awaitCompletedCalls()` use in a bounded wait with timeout + abort integration.
3. Ensure the timeout path produces a deterministic terminate reason / error rather than silently waiting.
4. Audit completion-channel state so stale pending state cannot leak across turns.

**Expected impact:**
Directly addresses the strongest subagent hang path and the “timeout seems not to work” symptom.

### Workstream 3: Make timeouts active inside inner waits

**Goal:** Convert timeout enforcement from passive checkpoint logic to active deadline enforcement.

**Files:**
- `packages/core/src/core/subagentExecution.ts`
- `packages/core/src/core/subagent.ts`
- any helper functions involved in subagent controller ownership

**Planned changes:**
1. Add a real deadline timer tied to configured subagent max time.
2. Abort the active controller when deadline is reached.
3. Ensure inner waits and stream consumers observe the aborted signal and terminate cleanly.
4. Add tests proving timeout fires even when blocked inside inner awaits.

**Expected impact:**
Makes timeout enforcement meaningful even when execution is stuck inside a stream loop or completion wait.

### Workstream 4: Add stream idle watchdogs to core and CLI consumers

**Goal:** Prevent indefinite waits when a stream stops progressing without closing.

**Files:**
- `packages/core/src/core/MessageStreamOrchestrator.ts`
- `packages/core/src/core/StreamProcessor.ts`
- `packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts`
- `packages/cli/src/nonInteractiveCli.ts`
- `packages/core/src/core/subagent.ts`

**Planned changes:**
1. Add failing tests for “partial stream then no more events” scenarios.
2. Implement idle watchdog behavior that resets on each event/chunk.
3. Emit a deterministic timeout/error path when idle threshold is exceeded.
4. Preserve existing cancel/error semantics and avoid double-emission.

**Expected impact:**
Covers the cross-model foreground and subagent hangs that are more likely under load.

### Workstream 5: Reduce dependence on post-stream-only tool scheduling

**Goal:** Make tool execution less fragile when terminal stream completion is delayed.

**Files:**
- `packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts`
- possibly adjacent orchestration code if tests show equivalent gating elsewhere

**Planned changes:**
1. Add tests that capture tool-call requests followed by stalled completion.
2. Evaluate safe earlier scheduling boundaries or bounded scheduling triggers.
3. Preserve deduplication behavior.
4. Ensure pending history flush and tool scheduling order remains deterministic.

**Expected impact:**
Reduces the “it stopped right as it was about to use a tool” class of UI hangs.

### Workstream 6: Provider-side buffering hardening

**Goal:** Harden the provider-specific paths that worsen visible stuck behavior.

**Files:**
- `packages/core/src/providers/openai/OpenAIStreamProcessor.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`

**Planned changes:**
1. Add targeted tests for Kimi/qwen buffered output that stalls before clean terminal completion.
2. Add instrumentation around open section buffering and final flush behavior.
3. Evaluate whether unclosed Kimi/think sections need bounded fallback handling.
4. Investigate the `tee()` reasoning-capture path with instrumentation before deciding on behavior changes.

**Expected impact:**
Improves Kimi/high-throughput resilience without prematurely blaming provider-specific code for all hang variants.

## Implementation Sequence

### Phase 0: Baseline and reproduction safety net

Run and record baseline verification before changes:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

Also capture any existing targeted tests for:
- subagent timeout,
- stalled stream behavior,
- Kimi/openai-vercel streaming behavior,
- UI tool scheduling.

### Phase 1: Instrumentation first

1. Add targeted instrumentation tests if needed.
2. Add runtime diagnostics in subagent, core stream, UI stream, CLI stream, and provider buffering paths.
3. Validate that logs identify whether real reproductions are dominated by:
   - stalled stream,
   - missing completion callback,
   - post-loop-only scheduling,
   - provider-side finalization/buffering.

### Phase 2: Fix the clearest indefinite wait

1. Add failing tests for the interactive subagent completion wait.
2. Bound `awaitCompletedCalls()` usage.
3. Verify deterministic timeout/termination behavior.

### Phase 3: Make timeout active

1. Add failing tests proving passive timeout is insufficient.
2. Add active deadline abort behavior.
3. Verify both interactive and non-interactive subagent paths respect the deadline.

### Phase 4: Add stream idle watchdogs

1. Add failing tests for partial stream then silent stall.
2. Implement idle watchdogs in core/CLI/subagent stream loops.
3. Verify cancellation and retry behavior remain correct.

### Phase 5: Relax post-stream-only tool gating where safe

1. Add failing tests for tool-call request seen but no clean stream termination.
2. Improve scheduling boundaries in the interactive UI path.
3. Verify no duplicate scheduling or ordering regressions.

### Phase 6: Provider buffering hardening

1. Add failing tests around Kimi/qwen buffering and terminal assembly.
2. Use instrumentation evidence to decide whether `OpenAIVercelProvider` needs behavioral fixes or only better observability.
3. Keep changes narrowly scoped and evidence-based.

### Phase 7: Final regression pass

1. Re-run targeted tests for all fixed hang classes.
2. Run full verification suite.
3. Capture results for the eventual PR.

## Verification Strategy

### Targeted behavioral tests to add or expand

#### Subagent tests
- missing completion callback does not hang forever,
- timeout fires while blocked inside completion wait,
- timeout fires while blocked inside stream consumption,
- terminate reason is deterministic and observable.

#### Core stream/orchestrator tests
- partial content then no more events triggers idle failure instead of hanging,
- retry paths (`InvalidStream`, related terminal errors) preserve event ordering,
- no double-finalization after watchdog-triggered failure.

#### Interactive UI tests
- tool requests observed but stalled stream does not leave tool execution waiting forever,
- cancellation suppresses tool scheduling correctly,
- pending history flush + tool scheduling ordering stays deterministic.

#### Non-interactive CLI tests
- partial stream then stall terminates deterministically,
- tool-call continuation still works after watchdog addition,
- JSON / stream-json output still receives explicit terminal failure information.

#### Provider tests
- buffered Kimi/qwen content still emits progressively,
- final flush behavior remains correct,
- think/tool section handling does not silently suppress later visible output,
- openai-vercel reasoning capture path is covered enough to detect regressions if modified.

### Full verification suite

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Risks and Open Questions

1. **Idle timeout thresholds** need to be chosen carefully to avoid false positives on legitimately slow turns.
2. **Provider-specific behavior** may differ enough that one watchdog strategy does not fit every stream path.
3. **Earlier tool scheduling** in the UI path could introduce duplicate scheduling if ordering invariants are not preserved.
4. **OpenAI Vercel tee/backpressure theory** remains plausible but unproven; it should be instrumented before being treated as primary root cause.
5. **#1873 context corruption / continue hang** may reveal additional orchestration issues, but it should stay out of scope for this fix unless shared root causes emerge clearly.

## Recommended Task Breakdown

1. **Task A:** Add instrumentation for waits, stream gaps, buffering, and completion callbacks.
2. **Task B:** Fix subagent completion-channel indefinite wait.
3. **Task C:** Add active timeout enforcement for subagent inner waits.
4. **Task D:** Add stream idle watchdogs to core, CLI, and subagent loops.
5. **Task E:** Reduce dependence on post-stream-only tool scheduling in the interactive UI path.
6. **Task F:** Harden provider-specific buffering paths using evidence from instrumentation.
7. **Task G:** Run full verification and record results.

## Success Criteria

This issue is complete when all of the following are true:

- subagents no longer hang indefinitely waiting for tool completion,
- configured timeout limits are actively enforced even inside inner awaits,
- stalled streams terminate deterministically instead of hanging forever,
- interactive UI tool execution no longer depends solely on perfect stream finalization where safe to improve,
- Kimi/high-throughput buffering no longer makes the symptom easy to trigger without explicit bounded failure behavior,
- targeted regression tests exist for the identified hang classes,
- full project verification passes.
