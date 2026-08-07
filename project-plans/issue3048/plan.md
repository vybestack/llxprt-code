# Plan: Safe retry after partial model output (discard-and-restart)

Plan ID: `PLAN-20260806-ISSUE3048`
Generated: 2026-08-06
Issue: #3048 (follow-up to #3034 / PR #3047; related: #3049, #3094)
Branch: `issue3048`
Total phases: 16 — `P01, P02, P03, P04, P05, P06, P07, P08, P09, P10, P11, P12, P13, P14, P15, P16`
Requirements: `REQ-3048-001` … `REQ-3048-011`
Specification: [`specification.md`](./specification.md)
Preflight: [`analysis/preflight.md`](./analysis/preflight.md)
Pseudocode: [`analysis/pseudocode/`](./analysis/pseudocode/)

---

## 0. Critical reminders

1. **Execute phases in strict numerical order.** `P01 → P02 → … → P16`. Never
   skip, never batch (`dev-docs/COORDINATING.md`).
2. **RED before GREEN, always.** Every odd-numbered implementation phase is
   preceded by a phase that adds failing behavioural tests. A GREEN phase that
   also writes tests is a plan violation.
3. **A RED phase must be *observed* red.** Run the new tests and paste the
   failure output into the completion marker. A "RED" phase whose tests pass on
   unmodified source is either a fence test (explicitly labelled as such in
   P03/P05) or a bug in the test.
4. **Do not modify tests during a GREEN phase.** If a test looks wrong, stop and
   return to the preceding RED phase.
5. **Bun only.** New and changed tests use `bun:test` — directly in `cli`,
   `providers` and `a2a-server`; through `packages/agents/src/testApi.js` in
   `agents`. Do not create or convert Vitest/Node suites. The one permitted
   touch of a Vitest-importing file is the mechanical argument threading in P12
   (pseudocode 005 lines 663-667).
6. **No suppression, ever.** No `eslint-disable`, no `@ts-expect-error`, no
   threshold/exclusion edits. `TurnProcessor.ts` has 3 effective lines of
   `max-lines` headroom — P04 fixes that by relocation (preflight F3).
7. **No mock theater.** Fake the transport / `fetch` / React host state only.
   Assert on emitted events, history contents, scheduler input and rendered
   items — never on "was this mock called".
8. **No stub phases.** Every change here modifies established, already-integrated
   code; there is nothing to stub. Tests fail with real assertion mismatches, not
   with `NotYetImplemented`.

---

## 1. Execution tracker

| Phase | ID | Kind | Status | Semantic verified? | Summary |
|-------|----|------|--------|--------------------|---------|
| 01 | P01 | gate | [ ] | n/a | Preflight re-verification |
| 02 | P02 | RED | [ ] | [ ] | Integrated agents contract (content→failure→success) |
| 03 | P03 | RED + fence | [ ] | [ ] | Provider boundary fence; turn policy unit; rewrite obsolete assertions |
| 04 | P04 | GREEN | [ ] | [ ] | `turnAbortHelpers` + `TurnProcessor` |
| 05 | P05 | RED | [ ] | [ ] | Abandoned tool calls (AgenticLoop, a2a) |
| 06 | P06 | GREEN | [ ] | [ ] | `AgenticLoop.streamAndCollect` + a2a executor |
| 07 | P07 | RED | [ ] | [ ] | Message-stream per-attempt accumulators |
| 08 | P08 | GREEN | [ ] | [ ] | `MessageStreamOrchestrator` |
| 09 | P09 | RED | [ ] | [ ] | CLI pending-render discard + ledger unit |
| 10 | P10 | GREEN | [ ] | [ ] | Ledger, `contentEventProcessor`, discard handler, dispatcher |
| 11 | P11 | RED | [ ] | [ ] | CLI static-segment retraction |
| 12 | P12 | GREEN | [ ] | [ ] | `removeItems` + plumbing + retraction |
| 13 | P13 | RED | [ ] | [ ] | Non-interactive discard |
| 14 | P14 | GREEN | [ ] | [ ] | `nonInteractiveCliSupport` |
| 15 | P15 | gate | [ ] | [ ] | Full verification cycle + semantic gates |
| 16 | P16 | docs | [ ] | n/a | Docs + follow-up issues |

Update this table after every phase.

---

## 2. Complete test inventory

New files (all Bun):

| File | Workspace | Phase | Requirements |
|------|-----------|-------|--------------|
| `packages/agents/src/core/chatSession.issue3048.discardRestart.test.ts` | agents | P02 | 002, 003, 004, 005, 011 |
| `packages/providers/src/__tests__/RetryOrchestrator.partialOutputBoundary.bun.ts` | providers | P03 | 001 |
| `packages/agents/src/core/turnRetryPolicy.discardRestart.test.ts` | agents | P03 | 002, 003, 004 |
| `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.retryDiscard.test.ts` | agents | P05 | 006 |
| `packages/a2a-server/src/agent/executor.retryDiscard.bun.ts` | a2a-server | P05 | 006 |
| `packages/agents/src/core/messageStreamOrchestrator.retryDiscard.test.ts` | agents | P07 | 007 |
| `packages/cli/src/ui/hooks/agentStream/__tests__/committedSegmentLedger.test.ts` | cli | P09 | 009 |
| `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.retryDiscard.bun.tsx` | cli | P09, P11 | 008, 009 |
| `packages/cli/src/ui/hooks/__tests__/useHistoryManager.removeItems.test.ts` | cli | P11 | 009 |
| `packages/cli/src/nonInteractiveCliSupport.retryDiscard.bun.ts` | cli | P13 | 010 |

Placement follows each workspace's existing convention, verified on this branch:
`packages/a2a-server/src/agent/` holds its suites beside the source
(`task-support.test.ts`), `packages/cli/src/` holds the non-interactive suites
beside `nonInteractiveCliSupport.ts` (`nonInteractiveCli.quiet.test.ts`), and
`packages/cli/src/ui/hooks/__tests__/` is the hooks suite directory. Test-utils
imports: `packages/cli/src/test-utils/render.js` (`../../../test-utils/render.js`
from `ui/hooks/__tests__/`, `../../../../test-utils/render.js` from
`ui/hooks/agentStream/__tests__/`).

Existing files whose assertions change (P03 only, with justification in
preflight F7):

| File | Change |
|------|--------|
| `packages/agents/src/core/chatSession.issue2150.test.ts` | Rewrite the three "does not retry after output" cases and the history-safety case to the post-#3048 contract. **Preserve unchanged**: non-transient mid-stream, `AbortError`, `ABORT_ERR`, aborted-signal, `InvalidStreamError`-after-chunk, `EmptyStreamError`-after-chunk, shared-transport-budget cases. |
| `packages/agents/src/core/turnProcessorIdleTimeoutContract.test.ts` | Update the `shouldRetryStreamAttempt(error, params, 0)` call to the 4-argument signature with `{ hasYieldedOutput: false }`. Assertion unchanged. |

Existing files touched mechanically (no assertion change):

| File | Change | Phase |
|------|--------|-------|
| `packages/cli/src/ui/hooks/useAgentStream.subagent.spec.tsx` | 4 `useAgentStream(...)` call sites gain the `removeItems` argument | P12 |
| `packages/cli/src/ui/hooks/agentStream/__tests__/submitQueryTestFixtures.ts` and any deps builder used by the existing agentStream suites | add `removeItems` / `committedSegments` to the fixture deps | P10, P12 |

Nothing is registered anywhere: discovery is structural (preflight C1).

---

## 3. Phases

---

### Phase 01 — Preflight re-verification

**Phase ID:** `PLAN-20260806-ISSUE3048.P01`
**Kind:** gate (no source or test changes)

#### Prerequisites
- Branch `issue3048` checked out, `git status` clean.

#### Tasks
Re-run every check in `analysis/preflight.md` against the current working tree
and record any drift.

```bash
# A5 — the single blocker
grep -n "hasYieldedChunk" packages/agents/src/core/TurnProcessor.ts

# A11/A12/A13 — consumers that ignore the discard signal
grep -n "AgentEventType.Retry" packages/agents/src/core/agenticLoop/AgenticLoop.ts   # expect: no match
grep -n "case 'retry'" packages/cli/src/ui/hooks/agentStream/agentEventDispatcher.ts
grep -n "AgentEventType.ToolCallRequest" packages/a2a-server/src/agent/executor.ts

# F3 — size budget
npx eslint packages/agents/src/core/TurnProcessor.ts   # expect exit 0 today

# F5 — the CLI already commits stable prefixes mid-attempt
grep -n "addItem(" packages/cli/src/ui/hooks/agentStream/contentEventProcessor.ts

# B5 — no removal API yet
grep -n "removeItems\|clearItems" packages/cli/src/ui/hooks/useHistoryManager.ts

# Baseline: the whole suite is green before we start
npm run test
```

#### Success criteria
- Every preflight row still holds, or the deviation is written into
  `analysis/preflight.md` **and** the affected phase is updated before P02.
- Baseline `npm run test` is green.

#### Failure recovery
Stop. Update the specification/plan first. Do not start P02 on a red baseline.

#### Completion marker
`project-plans/issue3048/.completed/P01.md` — paste the command outputs.

---

### Phase 02 — RED: integrated agents contract (vertical slice first)

**Phase ID:** `PLAN-20260806-ISSUE3048.P02`
**Kind:** RED

#### Prerequisites
- P01 complete.

#### Requirements implemented (expanded)

**REQ-3048-002 — Transient transport failure after output restarts the turn.**
GIVEN a provider that yields `text:'partial'` then throws `Error('Connection error.')`
on attempt 1 and yields `text:'recovered response'` on attempt 2; WHEN the caller
consumes `chat.sendMessageStream(...)`; THEN the provider is invoked exactly twice,
the stream completes without throwing, and exactly one `StreamEventType.RETRY` is
emitted strictly before any attempt-2 chunk.
*Why it matters:* a dropped connection mid-answer currently kills the agentic loop.

**REQ-3048-003 — Bounded; non-transient and exhausted still fail.**
GIVEN the same provider failing on every attempt; THEN exactly two invocations and
the stream rejects with `Connection error.`. GIVEN a `status: 400` failure after
output; THEN exactly one invocation and the stream rejects with `Bad request`.
*Why it matters:* an unbounded restart burns quota silently.

**REQ-3048-004 — Abort wins.** As specified in `specification.md` §7.
*Why it matters:* transient phrasing overlaps abort phrasing.

**REQ-3048-005 — Durable history is the successful attempt alone.**
GIVEN the restart scenario; WHEN `chat.waitForIdle()` resolves; THEN exactly one
`speaker === 'ai'` entry whose text is `'recovered response'` and does not contain
`'partial'`, and exactly one `speaker === 'human'` entry.
*Why it matters:* a concatenated entry poisons every later request.

**REQ-3048-011 — Audited no-change decisions are pinned** (eager tool-response ids).

#### Files to create

`packages/agents/src/core/chatSession.issue3048.discardRestart.test.ts`

- Header: `Copyright 2026 Vybestack LLC`, `SPDX-License-Identifier: Apache-2.0`
- Imports: `import { describe, it, expect, beforeEach, vi } from '../testApi.js';`
- Harness: copy the *real-stack* setup from
  `packages/agents/src/core/chatSession.issue2150.test.ts` — real `ChatSession`
  → `TurnProcessor` → `StreamProcessor`, `TestRuntimeProviderManager`, real
  `retry.ts` (never mocked). The only double is the provider's
  `generateChatCompletion` async generator.
- Every test carries:

```ts
/**
 * @plan PLAN-20260806-ISSUE3048.P02
 * @requirement REQ-3048-002
 * @scenario Transient transport failure after partial output
 * @given attempt 1 yields 'partial' then throws Error('Connection error.')
 * @when the caller drains chat.sendMessageStream(...)
 * @then the provider is invoked twice and the stream completes
 * @and exactly one RETRY event precedes every attempt-2 chunk
 */
```

Scenarios (each an `it`):

1. **`restarts the turn after a transient transport failure that followed partial output`** — REQ-3048-002.
   Assert `attempt === 2`; the collected `StreamEvent[]` contains exactly one
   `StreamEventType.RETRY`; the index of that RETRY is lower than the index of
   every CHUNK carrying `'recovered response'`; no CHUNK after the RETRY carries
   `'partial'`.
2. **`restarts after an abandoned tool_call block`** — REQ-3048-002. Attempt 1
   yields a `tool_call` block then fails; attempt 2 yields text. Assert
   `attempt === 2` and the stream completes.
3. **`restarts after abandoned hidden thinking metadata`** — REQ-3048-002.
4. **`records only the successful attempt in history`** — REQ-3048-005. Build the
   session with an explicit `HistoryService`; after `waitForIdle()`, assert one
   `ai` entry equal to `'recovered response'`, `expect(text).not.toContain('partial')`,
   and one `human` entry.
5. **`fails after the restart budget is spent`** — REQ-3048-003. Provider always
   yields `'partial'` then throws. Assert `attempt === 2` and rejection with
   `Connection error.`.
6. **`does not restart a non-transient failure after output`** — REQ-3048-003.
   `status: 400`; assert `attempt === 1` and rejection with `Bad request`.
7. **`does not restart an InvalidStreamError raised after output`** — REQ-3048-003 /
   AD-3. Assert `attempt === 1`.
8. **`does not restart when the failure is an abort after output`** — REQ-3048-004.
   Three sub-cases: `name:'AbortError'` + `code:'ABORT_ERR'`; `code:'ABORT_ERR'`
   only; `Error('terminated')` with the request's own signal aborted mid-stream.
   Each asserts `attempt === 1` **and** that no `StreamEventType.RETRY` was emitted.
9. **`keeps eagerly recorded tool-response ids across a discard`** — REQ-3048-011.
   Drive the real eager-recording path: call
   `chat.recordCompletedToolCalls(model, [completedToolCall])`
   (`packages/agents/src/core/chatSession.ts:657-698`, which persists the
   `tool` turn and then calls `markToolResponsesRecorded` on both processors),
   then run the restart scenario with that same `tool_response` as the next
   turn's message. Assert the final history contains **exactly one**
   `tool_response` block for that `callId`, not two. This pins specification §6
   row 7: the eager ids must survive the discard, or the successful attempt
   re-records a duplicate.

#### Expected RED output
Cases 1-5 and 9 fail. Typical first failure: `expect(attempt).toBe(2)` receives
`1`, and case 1's stream rejects instead of completing. Cases 6-8 pass already —
they are the fence for AC5/AC6 and must stay green through every later phase.

#### Verification
```bash
cd packages/agents && bun test ./src/core/chatSession.issue3048.discardRestart.test.ts
npm run lint && npm run typecheck
```

#### Semantic verification checklist
- [ ] Would each failing test still fail if the production change were reverted?
      (Re-run after P04 with the change stashed.)
- [ ] Is the provider double limited to `generateChatCompletion`? No mocking of
      `retry.ts`, `TurnProcessor`, or `StreamProcessor`.
- [ ] Are all assertions on observable output (events, history, invocation count)?
      No `toHaveBeenCalledWith` on internal collaborators.

#### Failure recovery
`git checkout -- packages/agents/src/core/chatSession.issue3048.discardRestart.test.ts`

#### Completion marker
`.completed/P02.md` — paste the red output and the pass/fail split.

---

### Phase 03 — RED + fence: provider boundary, turn policy, obsolete assertions

**Phase ID:** `PLAN-20260806-ISSUE3048.P03`
**Kind:** RED (turn policy) + fence (provider)

#### Prerequisites
- P02 complete; `grep -rn "PLAN-20260806-ISSUE3048.P02" packages/` finds the P02 file.

#### Requirements implemented (expanded)

**REQ-3048-001 — Provider boundary stays terminal after output.**
GIVEN a provider stream that yields one `IContent` then throws a transient
transport error; WHEN consumed through `RetryOrchestrator`; THEN the wrapped
provider is invoked exactly once, the consumer sees that one `IContent` then a
rejection, the rejected value is the *same object* the transport threw, and
`isTerminalRetryError` is `true` in providers and `false` in agents.
*Why it matters:* the anti-mixing rule is what makes the turn-level restart safe.

**REQ-3048-002/003/004 at the policy level** — the full behaviour table in
`analysis/pseudocode/001-turn-retry-policy.md`.

#### Files to create

**`packages/providers/src/__tests__/RetryOrchestrator.partialOutputBoundary.bun.ts`** (fence)
- `import { describe, it, expect } from 'bun:test';`
- Real `RetryOrchestrator` over a hand-written provider double whose
  `generateChatCompletion` yields one `IContent` then throws.
- Assertions:
  - transport invocation count is exactly `1` even with `maxAttempts: 6`;
  - the consumer collected exactly the one yielded `IContent`;
  - `await expect(...).rejects.toBe(thrownError)` — object identity, proving no
    wrapper was introduced;
  - `expect('isRetryable' in thrownError).toBe(false)` — the agents-side
    predicate must not see it as terminal;
  - `expect(isTerminalRetryError(thrownError)).toBe(true)` using the **providers**
    `retryErrorClassification.js` export.
- Label in the file header: *fence test — passes on unmodified source; it exists
  so a future "just let the orchestrator retry" edit fails loudly.*

**`packages/agents/src/core/turnRetryPolicy.discardRestart.test.ts`** (RED)
- `import { describe, it, expect } from '../testApi.js';`
- Drives `shouldRetryStreamAttempt` directly with the 4-argument signature.
- One `it` per row of the behaviour table in pseudocode 001 (13 rows). Use
  `it.each` over an explicit table so a missing row is visible.
- Additionally asserts `applyRetryTemperature` is exported from
  `turnAbortHelpers.js` and returns `params` unchanged for `attempt === 0` and a
  bumped temperature for `attempt === 1`.

#### Files to modify (assertions only — justified by preflight F7)

`packages/agents/src/core/chatSession.issue2150.test.ts`

| Test | Before | After |
|------|--------|-------|
| `does not retry a connection error after visible content was emitted` | `attempt === 1`, rejects | rename to `restarts the turn after a connection error that followed visible content`; `attempt === 2`, stream completes with `'recovered response'` |
| `does not retry a connection error after a tool call was emitted` | `attempt === 1` | rename to `restarts …after a tool call was emitted`; `attempt === 2` |
| `does not retry after hidden thinking metadata was emitted` | `attempt === 1` | rename to `restarts …after hidden thinking metadata`; `attempt === 2` |
| `does not commit a failed response after visible content was emitted` | zero `ai` entries after rejection | one `ai` entry equal to the successful attempt's text |

Add to the file's header comment: *"Issue #3048 replaced the post-output
no-retry contract with discard-and-restart. The abort, non-transient,
InvalidStreamError and EmptyStreamError cases below are unchanged and are the
regression fence for that boundary."*

`packages/agents/src/core/turnProcessorIdleTimeoutContract.test.ts`
- `shouldRetryStreamAttempt(error, params, 0)` →
  `shouldRetryStreamAttempt(error, params, 0, { hasYieldedOutput: false })`.
  The `.toBe(false)` assertion is unchanged.

#### Expected output
- Provider fence: **green immediately.**
- `turnRetryPolicy.discardRestart.test.ts`: fails to compile / run — the 4th
  argument does not exist and `applyRetryTemperature` is not exported. That is
  the RED signal.
- `chatSession.issue2150.test.ts`: the four rewritten cases fail.

#### Verification
```bash
cd packages/providers && bun test ./src/__tests__/RetryOrchestrator.partialOutputBoundary.bun.ts
cd packages/agents && bun test ./src/core/turnRetryPolicy.discardRestart.test.ts
cd packages/agents && bun test ./src/core/chatSession.issue2150.test.ts
```

#### Semantic verification checklist
- [ ] The provider fence asserts error **identity** (`rejects.toBe`), not just message.
- [ ] The rewritten 2150 cases changed only the four listed tests; `git diff` shows
      no edits to the abort / non-transient / Invalid / Empty cases.
- [ ] The policy table has a row for every branch in pseudocode 001 lines 010-025.

#### Failure recovery
`git checkout -- packages/agents/src/core/chatSession.issue2150.test.ts` and re-apply.

#### Completion marker
`.completed/P03.md`.

---

### Phase 04 — GREEN: turn retry policy and TurnProcessor

**Phase ID:** `PLAN-20260806-ISSUE3048.P04`
**Kind:** GREEN
**Pseudocode:** `analysis/pseudocode/001-turn-retry-policy.md` lines **010-039**;
`analysis/pseudocode/002-turn-processor-attempt-loop.md` lines **100-156**

#### Prerequisites
- P03 complete; the P02 and P03 suites are red for the expected reasons.

#### Files to modify

**`packages/agents/src/core/turnAbortHelpers.ts`**
- Add `export interface StreamAttemptContext { readonly hasYieldedOutput: boolean }`
  (pseudocode 001, contracts block).
- Extend `shouldRetryStreamAttempt` to the 4-argument signature and implement
  pseudocode 001 **lines 010-025** exactly, in order:
  - line 011-013 budget check first;
  - line 014-015 `isTerminalRetryError` second;
  - line 016-020 the post-output branch — `isNetworkTransientError && !isAbortError`;
  - line 021-024 the pre-output branch, byte-for-byte the previous behaviour.
- Add `export function applyRetryTemperature(...)` implementing pseudocode 001
  **lines 030-039** (body moved verbatim from `TurnProcessor._applyRetryTemperature`).
- Extend the file-header JSDoc with one sentence naming the post-output rule and
  `@plan PLAN-20260806-ISSUE3048.P04`, `@requirement REQ-3048-002 REQ-3048-003 REQ-3048-004`.

**`packages/agents/src/core/TurnProcessor.ts`**
- Pseudocode 002 **lines 130-132**: replace the `!hasYieldedChunk && …` conjunct
  with `shouldRetryStreamAttempt(error, params, attempt, { hasYieldedOutput: hasYieldedChunk })`.
- Pseudocode 002 **lines 151-156** (mandatory, preflight F3): delete
  `_applyRetryTemperature`, import `applyRetryTemperature` from
  `turnAbortHelpers.js` alongside `shouldRetryStreamAttempt`, and update the single
  call site at what is currently line 263.
- Leave the `RETRY` emission position (line 258) unchanged — see specification §4.
- Do **not** touch `_createStreamGenerator`, the accumulator, or history recording.

#### Explicit code shape

```ts
// turnAbortHelpers.ts
export function shouldRetryStreamAttempt(
  error: unknown,
  params: SendMessageParams,
  attempt: number,
  context: StreamAttemptContext,
): boolean {
  const withinBudget = attempt < INVALID_CONTENT_RETRY_OPTIONS.maxAttempts - 1;
  if (!withinBudget || isTerminalRetryError(error)) return false;
  if (context.hasYieldedOutput) {
    return isNetworkTransientError(error) && !isAbortError(error, params);
  }
  if (error instanceof InvalidStreamError || error instanceof EmptyStreamError) {
    return true;
  }
  return isNetworkTransientError(error) && !isAbortError(error, params);
}
```

```ts
// TurnProcessor._runStreamAttempt (catch tail)
      if (
        shouldRetryStreamAttempt(error, params, attempt, {
          hasYieldedOutput: hasYieldedChunk,
        })
      ) {
        return { error, action: 'retry' };
      }
      return { error, action: 'stop' };
```

#### Expected outcome
Every P02 and P03 test passes, including the six that were already green.

#### Verification
```bash
cd packages/agents && bun test ./src/core/turnRetryPolicy.discardRestart.test.ts
cd packages/agents && bun test ./src/core/chatSession.issue3048.discardRestart.test.ts
cd packages/agents && bun test ./src/core/chatSession.issue2150.test.ts
cd packages/agents && bun test ./src/core/turnProcessorIdleTimeoutContract.test.ts
cd packages/agents && bun test ./src/core/processorRetryBoundary.test.ts
cd packages/providers && bun test ./src/__tests__/RetryOrchestrator.partialOutputBoundary.bun.ts

# Size budget — the reason the relocation is mandatory
npx eslint packages/agents/src/core/TurnProcessor.ts
npx eslint packages/agents/src/core/turnAbortHelpers.ts
npm run typecheck
```

#### Deferred-implementation detection (mandatory)
```bash
git diff --name-only | grep -E '^packages/(agents)/' | xargs grep -nE \
  "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|in a real|for now|placeholder)" || echo OK
git diff | grep -nE "eslint-disable|@ts-(expect-error|ignore|nocheck)" && exit 1 || echo OK
grep -n "_applyRetryTemperature" packages/agents/src/core/TurnProcessor.ts || echo "relocation complete"
```

#### Semantic verification checklist
- [ ] Read `shouldRetryStreamAttempt` and state, in your own words, why an abort
      after output returns `false` on both mechanisms (`name`/`code`) *and* on the
      aborted-signal mechanism.
- [ ] Trace one full path: provider throws → `RetryOrchestrator` marks and rethrows
      → `StreamProcessor` propagates without finalizing → `_runStreamAttempt` catch
      → policy `true` → `delay` → `RETRY` yielded → new `makeApiCallAndProcessStream`.
      Name the file and function at each hop.
- [ ] Confirm `markErrorAfterStreamOutput` is untouched: `git diff packages/providers` is empty.
- [ ] Confirm exactly one restart is possible: `INVALID_CONTENT_RETRY_OPTIONS.maxAttempts`
      is still `2` and no new budget constant was added.
- [ ] Would the P02 tests fail if this change were reverted? Verify by
      `git stash` → run → `git stash pop`, and paste both outputs.

#### Failure recovery
`git checkout -- packages/agents/src/core/TurnProcessor.ts packages/agents/src/core/turnAbortHelpers.ts`

#### Completion marker
`.completed/P04.md` including the holistic assessment (what was implemented, how
it satisfies each requirement, the traced data flow, what could go wrong, verdict).

---

### Phase 05 — RED: abandoned tool calls are never scheduled

**Phase ID:** `PLAN-20260806-ISSUE3048.P05`
**Kind:** RED

#### Prerequisites
- P04 complete and green.

#### Requirements implemented (expanded)

**REQ-3048-006 — Abandoned tool calls are never scheduled.**
GIVEN a model stream emitting `ToolCallRequest('abandoned')`, `Retry`,
`ToolCallRequest('kept')`, end; WHEN the loop runs one turn; THEN the scheduler
receives exactly one request, `callId === 'kept'`. GIVEN the same stream without
the second tool call; THEN the scheduler is never invoked and the loop terminates
normally. Both properties hold for `AgenticLoop` **and** the a2a executor.
*Why it matters:* scheduling a tool call from a discarded generation executes side
effects the model never committed to.

#### Files to create

**`packages/agents/src/core/agenticLoop/__tests__/agenticLoop.retryDiscard.test.ts`**
- `import { describe, it, expect } from '../../../testApi.js';`
- Reuse `agenticLoop-test-helpers.ts` builders; the double is the
  `agentClient.sendMessageStream` event source and a recording
  `ToolSchedulerContract` obtained through `config.getOrCreateScheduler`.
- Scenarios:
  1. `schedules only the successful attempt's tool calls` — assert the recorded
     `schedule()` argument array is exactly `[{ callId: 'kept', … }]`.
  2. `never schedules when the only tool calls belonged to an abandoned attempt` —
     assert `schedule()` was never reached (no scheduler was created) and the loop
     returned without a `tools_complete` event.
  3. `forwards the Retry event to consumers before discarding` — assert the
     yielded `AgenticLoopEvent[]` contains `{ kind: 'stream', event: { type: Retry } }`
     and that its index precedes the `kept` `ToolCallRequest` stream event.
  4. `keeps the turn alive across a Retry` — assert `shouldScheduleTools` remained
     true by observing that scenario 1 actually scheduled.
  5. **Fence:** `still drops tool calls and stops on a terminal Error event` —
     unchanged existing behaviour.

**`packages/a2a-server/src/agent/executor.retryDiscard.bun.ts`**
- `import { describe, it, expect, vi } from 'bun:test';` (matching
  `packages/a2a-server/src/agent/task-support.test.ts`)
- Drive `#processAgentTurnLoop` through its public entry with a fake agent-event
  generator and a `Task` double that records `scheduleToolCalls` arguments.
- Scenarios 1 and 2 above, plus: `still logs the Retry event through
  acceptAgentMessage` (the informational classification is unchanged).

#### Expected RED output
Scenario 1 fails with two scheduled requests (`abandoned` + `kept`); scenario 2
fails because the scheduler was invoked. Scenarios 3-5 pass.

#### Verification
```bash
cd packages/agents && bun test ./src/core/agenticLoop/__tests__/agenticLoop.retryDiscard.test.ts
cd packages/a2a-server && bun test ./src/agent/executor.retryDiscard.bun.ts
```

> Bun treats a bare argument as a *name filter* and only as a path when it is
> explicitly relative, and a `.bun.ts` file contains neither `.test` nor `.spec`.
> Always pass `./`-prefixed paths for `.bun.*` suites
> (`packages/cli/run-bun-tests.ts` documents the same trap).

#### Semantic verification checklist
- [ ] Is the scheduler a *recording* double asserting on its **input**, not a mock
      asserting it was called?
- [ ] Does scenario 2 assert an observable outcome (no tools ran, loop ended) rather
      than an internal flag?

#### Completion marker
`.completed/P05.md`.

---

### Phase 06 — GREEN: AgenticLoop and a2a executor

**Phase ID:** `PLAN-20260806-ISSUE3048.P06`
**Kind:** GREEN
**Pseudocode:** `analysis/pseudocode/003-agentic-loop-and-a2a-discard.md`
lines **200-220** (AgenticLoop) and **300-315** (a2a)

#### Files to modify
- `packages/agents/src/core/agenticLoop/AgenticLoop.ts` —
  `streamAndCollect`, pseudocode lines **208-214**. Insert the `Retry` branch
  **after** the `yield { kind: 'stream', event }` (line 204) and **before** the
  `isTerminalStreamOutcome` check (line 216). Use in-place truncation
  (`toolCallRequests.length = 0`) and `continue`. Do **not** touch
  `isTerminalStreamOutcome`.
- `packages/a2a-server/src/agent/executor.ts` — `#processAgentTurnLoop`,
  pseudocode lines **307-312**. Clear then fall through to `acceptAgentMessage`.
- Add `@plan PLAN-20260806-ISSUE3048.P06` / `@requirement REQ-3048-006` markers.

#### Verification
```bash
cd packages/agents && bun test ./src/core/agenticLoop/
cd packages/a2a-server && bun test ./src/agent/
npm run lint && npm run typecheck
```

#### Semantic verification checklist
- [ ] Confirm `isTerminalStreamOutcome` is unchanged (`git diff` shows no edit to it).
- [ ] Confirm the discard uses `length = 0`, not reassignment — the array is owned
      by `runTurn` (AgenticLoop.ts:435) and reassignment would leave the caller
      holding the abandoned list. State this from the code, not from the plan.
- [ ] Trace: `Retry` event → `streamAndCollect` branch → `runTurn` sees an empty
      `toolCallRequests` → `continueLoop: false, allowSteerContinuation: true` when
      the replacement attempt also had no tools.

#### Completion marker
`.completed/P06.md` with the holistic assessment.

---

### Phase 07 — RED: message-stream per-attempt accumulators

**Phase ID:** `PLAN-20260806-ISSUE3048.P07`
**Kind:** RED

#### Requirements implemented (expanded)

**REQ-3048-007 — Message-stream per-attempt accumulators are discarded.**
GIVEN a stream emitting `Content('abandoned ')`, a deferred `Citation`, `Retry`,
`Content('kept')`, `Finished`; WHEN the AfterAgent hook fires; THEN its
`responseText` argument is exactly `'kept'` and the abandoned citation is not
emitted. GIVEN `Content('abandoned')`, `Retry`, then only a `ToolCallRequest`;
THEN the iteration result reports `hadContent === false`.
*Why it matters:* `responseChunks` is what user-authored AfterAgent hooks see, and
the flags gate post-turn recovery.

#### Files to create

**`packages/agents/src/core/messageStreamOrchestrator.retryDiscard.test.ts`**
- `import { describe, it, expect, vi } from '../testApi.js';` (the path used by
  every sibling suite in `packages/agents/src/core/`)
- Real `MessageStreamOrchestrator` with a `Turn` double whose `run()` yields the
  scripted `ServerAgentStreamEvent` sequence; a recording `agentHookManager` whose
  `fireAfterAgentHookSafe` captures its `responseText` argument (recording the
  **argument**, then returning a real-shaped output — not asserting the call).
- Scenarios:
  1. `passes only the successful attempt's text to the AfterAgent hook`
  2. `drops deferred citations from the abandoned attempt`
  3. `reports hadContent false when the only content belonged to the abandoned attempt`
  4. `keeps hadToolCallsThisTurn from earlier loop iterations across a Retry`
     (pass `hadToolCallsPrior: true`; assert it is still `true` after the discard)
  5. `still yields the Retry event to consumers`
  6. **Fence:** `does not reset finishedOutcome` — a `Finished` before the stream
     ends still surfaces its outcome.

#### Expected RED output
Scenarios 1-4 fail (`responseText` is `'abandoned kept'`, the citation is emitted,
`hadContent` is `true`, `hadToolCallsThisTurn` is `false` after the reset attempt).

#### Verification
```bash
cd packages/agents && bun test ./src/core/messageStreamOrchestrator.retryDiscard.test.ts
```

#### Semantic verification checklist
- [ ] The hook double **records** the argument and returns a realistic output; it
      does not assert "was called".
- [ ] Scenario 4 proves the reset target is `hadToolCallsPrior`, not `false`.

#### Completion marker
`.completed/P07.md`.

---

### Phase 08 — GREEN: MessageStreamOrchestrator

**Phase ID:** `PLAN-20260806-ISSUE3048.P08`
**Kind:** GREEN
**Pseudocode:** `analysis/pseudocode/004-message-stream-orchestrator-discard.md`
lines **400-444**

#### Files to modify
`packages/agents/src/core/MessageStreamOrchestrator.ts`
- Add the module-level `discardAbandonedAttempt` helper (pseudocode lines 400-409).
- Restructure the three per-iteration booleans into one mutable `state` record
  (pseudocode lines 413, 427-429, 440-443) — mechanical, value-preserving.
- Add the `Retry` branch (pseudocode lines 420-425): discard, yield the event,
  update telemetry, `continue`.
- Do **not** reset `finishedOutcome`; do **not** call `loopDetector.reset`.
- Markers: `@plan PLAN-20260806-ISSUE3048.P08`, `@requirement REQ-3048-007`,
  `@pseudocode 004 lines 400-444`.

#### Verification
```bash
cd packages/agents && bun test ./src/core/messageStreamOrchestrator.retryDiscard.test.ts
cd packages/agents && bun test ./src/core/MessageStreamOrchestrator.modelinfo.test.ts \
                              ./src/core/MessageStreamOrchestrator.todoPause.test.ts
npx eslint packages/agents/src/core/MessageStreamOrchestrator.ts   # max-lines-per-function: 80
npm run typecheck
```

#### Semantic verification checklist
- [ ] `_processStreamIteration` is still under 80 effective lines (eslint exit 0).
- [ ] `ctx.responseChunks` is truncated in place — `ctx` is shared with
      `MessageStreamTerminalHandler`; reassignment would silently leave the old array.
- [ ] Every read site of the three flags was migrated to the `state` record and
      none changed meaning.

#### Completion marker
`.completed/P08.md` with the holistic assessment.

---

### Phase 09 — RED: interactive CLI pending-render discard

**Phase ID:** `PLAN-20260806-ISSUE3048.P09`
**Kind:** RED

#### Requirements implemented (expanded)

**REQ-3048-008 — The interactive CLI discards the abandoned attempt's pending
render state.** GIVEN an active turn that rendered `'abandoned partial'`; WHEN
`processAgentEvent({type:'retry'}, ts, signal)` is routed; THEN the next
`{type:'text', text:'kept'}` renders a pending item whose text is exactly `'kept'`,
no history item containing `'abandoned partial'` was added,
`pendingResponse.stableText` is `''`, `thinkingBlocksRef.current` is `[]` and the
thought was cleared. GIVEN the pending item is a `tool_group`; THEN it is unchanged.
*Why it matters:* otherwise the retry appends to the abandoned text and the user
reads a spliced answer.

#### Files to create

**`packages/cli/src/ui/hooks/agentStream/__tests__/committedSegmentLedger.test.ts`**
- `import { describe, it, expect } from 'bun:test';`
- Pure unit tests of the new value object: `begin` clears, `record` appends,
  `drain` returns and clears, `drain` twice returns empty the second time,
  `begin` after `record` drops the previous message's ids.

**`packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.retryDiscard.bun.tsx`**
- Model it on `useSubmitQuery.terminalError.bun.tsx`: real `useSubmitQuery`, real
  `useStreamEventHandlers`, real `dispatchAgentEvent`, real
  `PendingResponseBuffer`, real `CommittedSegmentLedger`; only `turnPreparation`
  and `SessionContext` are stubbed. React host state (`addItem`,
  `setPendingHistoryItem`, `pendingHistoryItemRef`) is captured by simple
  recorders whose contents are asserted.
- Scenarios (P09 subset — REQ-3048-008):
  1. `renders only the successful attempt's text after a retry` — route
     `text('abandoned partial')`, `retry`, `text('kept')`; assert the final pending
     item text is exactly `'kept'`.
  2. `does not commit the abandoned pending item to history` — assert no recorded
     `addItem` payload contains `'abandoned partial'`.
  3. `resets the pending response buffer` — assert `pendingResponse.stableText === ''`
     and `pendingResponse.displayText === ''` immediately after the retry.
  4. `clears thinking state` — route a `thinking` event before the retry; assert
     `thinkingBlocksRef.current` is `[]` afterwards.
  5. `leaves a pending tool_group item untouched` — set
     `pendingHistoryItemRef.current` to a `tool_group`; assert it is unchanged and
     `setPendingHistoryItem(null)` was not applied to it.
  6. `does not clear the submission queue or release the turn` — assert queued
     submissions and `setIsResponding` calls are unchanged across the retry
     (a retry is not a terminal event).

#### Expected RED output
Scenarios 1-4 fail: the pending item reads `'abandoned partialkept'`,
`stableText` still holds the abandoned text, thinking blocks persist. Scenario 5
and 6 pass (fence).

#### Verification
```bash
cd packages/cli && bun test ./src/ui/hooks/agentStream/__tests__/committedSegmentLedger.test.ts
cd packages/cli && bun test ./src/ui/hooks/agentStream/__tests__/useSubmitQuery.retryDiscard.bun.tsx
```

#### Semantic verification checklist
- [ ] Is the dispatcher real (`dispatchAgentEvent` not mocked)?
- [ ] Is `PendingResponseBuffer` a real instance?
- [ ] Do the assertions read rendered/recorded values, not handler invocation counts?

#### Completion marker
`.completed/P09.md`.

---

### Phase 10 — GREEN: CLI ledger, discard handler, dispatcher

**Phase ID:** `PLAN-20260806-ISSUE3048.P10`
**Kind:** GREEN
**Pseudocode:** `analysis/pseudocode/005-cli-interactive-discard.md` lines
**500-512** (ledger), **520-549** (recording), **600-615** (handler),
**630-638** (dispatcher)

#### Files to create
`packages/cli/src/ui/hooks/agentStream/committedSegmentLedger.ts`
- `Copyright 2026 Vybestack LLC`; implements pseudocode lines 500-512.

#### Files to modify
- `packages/cli/src/ui/hooks/agentStream/contentEventProcessor.ts` — add
  `committedSegments: CommittedSegmentLedger` to `ContentEventDeps` (required);
  call `begin()` in `ensureAiPendingItem` (pseudocode line 524) and `record(id)`
  in `applySplitResult` (pseudocode line 545).
- `packages/cli/src/ui/hooks/agentStream/useStreamState.ts` — construct the ledger
  in the same `useMemo` lifetime as `pendingResponse` and expose it (pseudocode
  lines 657-659).
- `packages/cli/src/ui/hooks/agentStream/useStreamEventHandlers.ts` — add
  `committedSegments` to `StreamEventHandlerDeps` and `ContentEventDeps` wiring;
  add `handleStreamAttemptDiscarded` (pseudocode lines 600-615) **without** the
  retraction step (line 609-610 lands in P12) and export it from
  `StreamEventHandlersResult`.
- `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` — add
  `committedSegments` to `UseSubmitQueryDeps`; add
  `'handleStreamAttemptDiscarded'` to the `Pick<…>` handler list in
  `useProcessAgentEvent`.
- `packages/cli/src/ui/hooks/agentStream/agentEventDispatcher.ts` — add
  `handleStreamAttemptDiscarded` to `AgentEventDeps`; move `'retry'` out of the
  no-op group into its own case (pseudocode lines 630-638).
- `packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` — pass
  `st.committedSegments` through.
- Existing agentStream test fixtures — add `committedSegments` to the deps
  builders so the suites still compile.

#### Verification
```bash
cd packages/cli && bun test ./src/ui/hooks/agentStream/
npm run lint && npm run typecheck
```

#### Deferred-implementation detection
```bash
git diff packages/cli | grep -nE "eslint-disable|@ts-(expect-error|ignore)" && exit 1 || echo OK
grep -n "committedSegments?" packages/cli/src/ui/hooks/agentStream/*.ts && \
  echo "FAIL: optional dep — must be required (spec AD-8)" || echo OK
```

#### Semantic verification checklist
- [ ] `handleStreamAttemptDiscarded` never calls `flushPendingHistoryItem`. Read
      the code and explain why flushing would be wrong.
- [ ] It only nulls `'gemini'` / `'gemini_content'` pending items.
- [ ] `'retry'` no longer shares the no-op `case` group.
- [ ] The dispatcher returns `{ agentMessageBuffer: '' }` for `'retry'`.
- [ ] `begin()` fires exactly once per assistant message — trace
      `ensureAiPendingItem`'s guard and state why a `gemini → gemini_content`
      transition does not re-fire it.

#### Completion marker
`.completed/P10.md` with the holistic assessment.

---

### Phase 11 — RED: retraction of committed stable segments

**Phase ID:** `PLAN-20260806-ISSUE3048.P11`
**Kind:** RED

#### Requirements implemented (expanded)

**REQ-3048-009 — The interactive CLI retracts stable segments committed by the
abandoned attempt.** GIVEN an active turn whose streamed text contained a
markdown-safe paragraph break, so `contentEventProcessor` committed one or more
`gemini`/`gemini_content` items; WHEN the retry event is routed; THEN those items
are gone from `history` and everything added before this assistant message is
untouched. GIVEN a *completed* assistant message followed by a new, discarded
turn; THEN the completed message's items are untouched.
*Why it matters:* preflight F5 — a single `\n\n` in the partial response is enough
to make part of it unretractable today, which fails AC3.

#### Files to create

**`packages/cli/src/ui/hooks/__tests__/useHistoryManager.removeItems.test.ts`**
- `import { describe, it, expect } from 'bun:test';` + the CLI `renderHook` helper.
- Scenarios: removes exactly the given ids and preserves order; ignores unknown
  ids without mutating state identity; recomputes the byte budget so a later
  `addItem` is not trimmed against stale bytes; an empty id list is a no-op.

#### Files to modify
`packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.retryDiscard.bun.tsx`
— add REQ-3048-009 scenarios:
7. `retracts stable segments committed by the abandoned attempt` — stream text
   containing `"para one\n\npara two"` (forcing at least one `applySplitResult`
   commit), then `retry`, then `'kept'`; assert the recorded history no longer
   contains any item whose text includes `'para one'`.
8. `leaves items from before the assistant message untouched` — add a `user` item
   and a `tool_group` item first; assert both survive.
9. `does not retract a previous, completed assistant message` — complete one
   assistant message (route `done`), start a second turn, commit a segment, then
   retry; assert the first message's items survive.
10. `retracts nothing on a second retry` — assert `removeItems` is not asked to
    remove already-retracted ids (drain semantics).

#### Expected RED output
Scenario 7-9 fail (`removeItems` does not exist / abandoned static items remain);
the `useHistoryManager` suite fails to compile.

#### Verification
```bash
cd packages/cli && bun test ./src/ui/hooks/__tests__/useHistoryManager.removeItems.test.ts
cd packages/cli && bun test ./src/ui/hooks/agentStream/__tests__/useSubmitQuery.retryDiscard.bun.tsx
```

#### Completion marker
`.completed/P11.md`.

---

### Phase 12 — GREEN: history retraction and plumbing

**Phase ID:** `PLAN-20260806-ISSUE3048.P12`
**Kind:** GREEN
**Pseudocode:** `analysis/pseudocode/005-cli-interactive-discard.md` lines
**560-575** (history manager), **608-610** (handler step), **650-667** (plumbing)

#### Files to modify
- `packages/cli/src/ui/hooks/useHistoryManager.ts` — `removeHistoryItems` +
  `removeItems` (pseudocode lines 560-575); add `removeItems` to
  `UseHistoryManagerReturn` and to the return `useMemo` dependency list.
- `packages/cli/src/ui/hooks/agentStream/useStreamEventHandlers.ts` — add the
  retraction step (pseudocode lines 608-610) to `handleStreamAttemptDiscarded`;
  add `removeItems` to `StreamEventHandlerDeps`.
- Plumbing (pseudocode lines 650-662), each a single required field/parameter:
  `useAppBootstrap.ts` → `AppContainerRuntime.tsx` (`buildInputParams`) →
  `useAppInput.ts` (`AppInputParams` + the `useAgentStream` call) →
  `useAgentStream.ts` (new required parameter immediately after `addItem`) →
  `useAgentStreamOrchestration.ts` (`AgentStreamOrchestrationDeps`) →
  `useSubmitQuery.ts` (`UseSubmitQueryDeps`).
- `packages/cli/src/ui/hooks/useAgentStream.subagent.spec.tsx` — 4 mechanical call
  sites (pseudocode lines 663-667). **Argument threading only**; no assertion,
  framework or semantics change.
- Existing agentStream deps fixtures — add `removeItems`.

#### Verification
```bash
cd packages/cli && bun test ./src/ui/hooks/
npm run lint && npm run typecheck
npm run lint:cli-test-discovery
```

#### Semantic verification checklist
- [ ] `removeItems` is a **required** member everywhere — no `?`, no default no-op
      (spec AD-8). Grep the diff for `removeItems?`.
- [ ] `removeHistoryItems` returns the previous state object unchanged when nothing
      matched, so React does not re-render needlessly.
- [ ] `totalBytes` is recomputed from the surviving entries, not decremented
      approximately.
- [ ] The discard drains before removing, so a second retry cannot re-remove.
- [ ] The 4 spec call sites changed by exactly one argument each — paste the diff.

#### Completion marker
`.completed/P12.md` with the holistic assessment, including a manual-run note for
the AC3 scenario.

---

### Phase 13 — RED: non-interactive discard

**Phase ID:** `PLAN-20260806-ISSUE3048.P13`
**Kind:** RED

#### Requirements implemented (expanded)

**REQ-3048-010 — The non-interactive CLI discards abandoned buffered output.**
GIVEN `--output-format json` and a stream emitting `text:'abandoned'`, `retry`,
`text:'kept'`, `done`; THEN the emitted JSON result's response text is exactly
`'kept'`. GIVEN `--quiet` and the same stream; THEN the emitted text is exactly
`'kept'`.
*Why it matters:* the JSON result is machine-consumed; a spliced answer is
silently wrong.

#### Files to create
`packages/cli/src/nonInteractiveCliSupport.retryDiscard.bun.ts`
- `import { describe, it, expect } from 'bun:test';`
- Drive the real `processAgentStream` with a scripted `AgentEvent` async iterable
  and a `StreamConsumerContext` whose emitters are recorders.
- Scenarios:
  1. `json mode emits only the successful attempt's text`
  2. `quiet mode emits only the successful attempt's text`
  3. `drops thoughts from the abandoned attempt`
  4. `drops the emoji filter's held partial chunk from the abandoned attempt` —
     supply a real `EmojiFilter` and a partial chunk that would otherwise be
     flushed at finalize
  5. **Fence:** `does not disturb pendingDone` — a `done` after the retry still
     drives the final result

#### Expected RED output
Scenarios 1-4 fail with `'abandonedkept'` (or the partial fragment appended).

#### Verification
```bash
cd packages/cli && bun test ./src/nonInteractiveCliSupport.retryDiscard.bun.ts
```

#### Completion marker
`.completed/P13.md`.

---

### Phase 14 — GREEN: non-interactive dispatcher

**Phase ID:** `PLAN-20260806-ISSUE3048.P14`
**Kind:** GREEN
**Pseudocode:** `analysis/pseudocode/006-cli-noninteractive-discard.md` lines
**700-712**

#### Files to modify
`packages/cli/src/nonInteractiveCliSupport.ts` — add the `case 'retry':` branch
(pseudocode lines 705-710): drain and discard `context.emojiFilter?.flushBuffer()`,
reset `responseText`, `quietTextBuffer` and `thoughtBuffer`. Do not touch
`pendingDone`. Marker: `@plan PLAN-20260806-ISSUE3048.P14`,
`@requirement REQ-3048-010`.

#### Verification
```bash
cd packages/cli && bun test ./src/nonInteractiveCliSupport.retryDiscard.bun.ts
cd packages/cli && bun test ./src/nonInteractiveCli.test.ts ./src/nonInteractiveCli.quiet.test.ts
npm run lint && npm run typecheck
```

#### Semantic verification checklist
- [ ] `flushBuffer()`'s return value is deliberately discarded, with a comment
      saying why (it belongs to the abandoned attempt).
- [ ] The quiet path is reached: `handleQuietEvent` returns `false` for `'retry'`,
      so the single case covers both modes. Verify by reading `handleQuietEvent`.
- [ ] Already-written stdout is untouched — the documented limitation is not
      papered over with a compensating write.

#### Completion marker
`.completed/P14.md` with the holistic assessment.

---

### Phase 15 — Full verification and semantic gates

**Phase ID:** `PLAN-20260806-ISSUE3048.P15`
**Kind:** gate

#### Prerequisites
- P01-P14 complete, every completion marker present.

#### Repository verification cycle
```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

#### Guard checks
```bash
npm run lint:eslint-guard        # no policy weakening
npm run lint:copyright-year      # new files say 2026
npm run lint:no-new-js           # no new .js
npm run lint:doc-placement       # plans stay in project-plans/
npm run lint:test-file-coverage  # every new test is discovered exactly once
npm run lint:cli-test-discovery
```

#### Plan-integrity checks
```bash
# every phase left a trace
for p in 04 06 08 10 12 14; do
  echo -n "P$p: "; grep -rl "PLAN-20260806-ISSUE3048.P$p" packages/ | wc -l
done

# no suppression or deferred work was introduced
git diff origin/main...HEAD | grep -nE "eslint-disable|@ts-(expect-error|ignore|nocheck)" && exit 1 || echo OK
git diff origin/main...HEAD --name-only | grep -E '^packages/.*\.(ts|tsx)$' | grep -v -E '\.(test|spec|bun)\.' \
  | xargs grep -nE "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|in a real|for now|placeholder)" || echo OK

# the provider anti-mixing rule is intact
grep -n "markErrorAfterStreamOutput" packages/providers/src/RetryOrchestrator.ts
git diff origin/main...HEAD -- packages/providers/src/RetryOrchestrator.ts \
  packages/providers/src/retryErrorClassification.ts   # expect: empty

# no Vitest/Node test was added, and the only modified vitest-importing file is
# the mechanical call-site update
git diff origin/main...HEAD --name-only | grep -E '\.(test|spec|bun)\.(ts|tsx)$' \
  | xargs grep -l "from 'vitest'" || echo "no vitest suites touched"
```

#### Acceptance-criteria walkthrough (semantic gate)

For each row, run the named test and paste its output:

| Issue AC | Test |
|----------|------|
| AC1 | `chatSession.issue3048.discardRestart.test.ts` → "restarts the turn after a transient transport failure that followed partial output" |
| AC2 | same file → "records only the successful attempt in history" |
| AC3 | `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.retryDiscard.bun.tsx` → "renders only the successful attempt's text after a retry" + "retracts stable segments committed by the abandoned attempt"; `packages/cli/src/nonInteractiveCliSupport.retryDiscard.bun.ts` → json/quiet cases |
| AC4 | `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.retryDiscard.test.ts` + `packages/a2a-server/src/agent/executor.retryDiscard.bun.ts` |
| AC5 | `turnRetryPolicy.discardRestart.test.ts` abort rows + the preserved abort cases in `chatSession.issue2150.test.ts` |
| AC6 | `chatSession.issue3048.discardRestart.test.ts` → budget-exhaustion + 400 + InvalidStreamError cases |
| AC7 | `RetryOrchestrator.partialOutputBoundary.bun.ts` (provider), the agents suites, the CLI suites |

#### Holistic functionality assessment (mandatory, written out)
Answer in `.completed/P15.md`:
1. **What was implemented?** In your own words, from reading the code.
2. **Does it satisfy each requirement?** Cite file:function for each of
   REQ-3048-001 … REQ-3048-011.
3. **What is the data flow?** Trace one complete discard-and-restart from the
   transport error to the rendered replacement, naming every hop.
4. **What could go wrong?** Edge cases and integration risks you observed.
5. **Verdict** with justification.

#### Mutation-resistance spot check
Temporarily invert each of the following, confirm at least one test fails, then
revert. Paste the failing test names.

| Mutation | Expected failure |
|----------|------------------|
| `hasYieldedOutput` branch returns `false` unconditionally | P02 scenario 1 |
| Post-output branch drops the `!isAbortError` conjunct | P03 abort rows, P02 scenario 8 |
| `AgenticLoop` Retry branch removed | P05 scenario 1 |
| `MessageStreamOrchestrator` `responseChunks` truncation removed | P07 scenario 1 |
| CLI discard skips `pendingResponse.reset()` | P09 scenario 3 |
| CLI discard skips the retraction | P11 scenario 7 |
| Non-interactive `responseText` reset removed | P13 scenario 1 |

#### Completion marker
`.completed/P15.md`.

---

### Phase 16 — Documentation and follow-ups

**Phase ID:** `PLAN-20260806-ISSUE3048.P16`
**Kind:** docs

#### Tasks
1. Document the discard-and-restart contract where retry behaviour is already
   described for users. Check first, then extend the file that actually covers it:
   ```bash
   grep -rln "retries\|retry" docs/ | head -20
   ```
   Add: one restart per turn after partial output, transport failures only,
   abort wins, and the two documented limitations (ACP/Zed, already-written
   stdout).
2. File follow-up issues with `gh` (never web fetch), each referencing #3048:
   - **ACP/Zed retraction:** already-sent `agent_message_chunk` updates cannot be
     retracted; propose an ACP-level retraction or an explicit user-visible notice
     (specification §8, preflight F9).
   - **AfterModel per-chunk hooks on an abandoned attempt:** no compensating
     event exists; propose an "attempt abandoned" hook event
     (specification §6 row 8, preflight F10).
   - **Retry temperature conflation:** `applyRetryTemperature` bumps temperature
     for transport retries as well as content retries (specification §8).
3. Do **not** modify unrelated project-plan files.

#### Verification
```bash
npm run lint:doc-links
npm run lint:doc-placement
npm run format
```

#### Completion marker
`.completed/P16.md` listing the created issue numbers.

---

## 4. Integration checklist (verify before P02 starts)

- [x] Identified all touch points with the existing system (specification §5.1)
- [x] Listed the exact code being replaced/corrected (specification §5.2)
- [x] Identified how users reach the behaviour (specification §5.3)
- [x] No migration needed, and that is justified (specification §5.4)
- [x] Integration tests are written FIRST (P02, before every unit-level phase)
- [x] The feature cannot be built in isolation — every phase modifies established,
      already-wired code; **no new module is reachable only from tests** (the one
      new file, `CommittedSegmentLedger`, is constructed in `useStreamState` and
      consumed by `contentEventProcessor` and the discard handler in the same phase)

## 5. Red flags that would invalidate this plan

1. Any change to `markErrorAfterStreamOutput` or
   `RetryOrchestrator.yieldStreamUnprotected` — the anti-mixing rule is the
   foundation, not an obstacle (AD-1).
2. Adding `StreamOutputAccumulator.reset()` — dead code (AD-7, preflight F1).
3. A retry budget other than `INVALID_CONTENT_RETRY_OPTIONS` (AD-5).
4. `AgentEventType.Retry` added to `isTerminalStreamOutcome` — that ends the turn.
5. Any `eslint-disable`, TS suppression, or threshold/exclusion edit.
6. An optional or defaulted discard dependency (AD-8).
7. A test asserting `toHaveBeenCalled` on a collaborator instead of on output.
8. A new Vitest/Node suite.
9. A GREEN phase that adds or edits tests.
10. A phase executed out of numerical order.
