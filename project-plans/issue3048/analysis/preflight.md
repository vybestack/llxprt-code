# Phase 0.5 — Preflight Verification (issue #3048)

Plan ID: `PLAN-20260806-ISSUE3048`
Generated: 2026-08-06
Branch: `issue3048`
Base commit: `05d50c1e8` ("Run every test by discovery, not by an allowlist")

Every claim below was verified by reading the working tree on this branch. No
assumption in `specification.md` or `plan.md` is carried without an entry here.

---

## A. Call-path verification

| # | Claim under test | Verdict | Evidence |
|---|------------------|---------|----------|
| A1 | `RetryOrchestrator.yieldStreamUnprotected` marks any post-output error terminal | CONFIRMED | `packages/providers/src/RetryOrchestrator.ts` — `chunksYielded` set before each `yield`; on `catch` with `chunksYielded === true` it throws `markErrorAfterStreamOutput(streamError)` |
| A2 | The provider-side terminal mark is a provider-private `WeakSet`, not a field on the error | CONFIRMED | `packages/providers/src/retryErrorClassification.ts` — `const errorsAfterStreamOutput = new WeakSet<object>()`; `markErrorAfterStreamOutput` returns the *same object* for object-like errors; `isTerminalRetryError` = `AbortError name` OR WeakSet membership |
| A3 | The agents-layer `isTerminalRetryError` is a **different predicate** and does NOT see the provider WeakSet | CONFIRMED | `packages/agents/src/core/turnAbortHelpers.ts` — `'isRetryable' in error && error.isRetryable === false` |
| A4 | Therefore a post-output transient transport error arrives at the agents layer **unwrapped and not classified terminal** | CONFIRMED | `RetryOrchestrator.handleRetryError` returns `{ type: 'throw', error }` for `isTerminalRetryError(error)` — the raw error, NOT a `RetriesExhaustedError`. `createRetriesExhaustedError` (which sets `isRetryable: false`) is only reached on budget exhaustion (`packages/providers/src/retryExhaustion.ts` via `decideRetryOrThrow` / `runRetryRequest`) |
| A5 | The **only** blocker to a turn-level restart after output is the `!hasYieldedChunk` conjunct | CONFIRMED | `packages/agents/src/core/TurnProcessor.ts:306-311` — `if (!hasYieldedChunk && shouldRetryStreamAttempt(error, params, attempt))`. With `hasYieldedChunk === false` the same error already retries today (`chatSession.issue2150.test.ts` proves the pre-output path) |
| A6 | `shouldRetryStreamAttempt` already accepts transient transport errors and already rejects aborts | CONFIRMED | `turnAbortHelpers.ts:78-92` — `isNetworkTransientError(error) && !isAbortError(error, params)`; `isAbortError` covers `name === 'AbortError'`, `code === 'ABORT_ERR'`, and `params.config?.abortSignal?.aborted === true` |
| A7 | Each turn attempt gets a **fresh** `StreamProcessor` accumulator | CONFIRMED | `TurnProcessor._runStreamAttempt` calls `streamProcessor.makeApiCallAndProcessStream(...)` per attempt → `_createCancellableStream` → `processStreamResponse`, whose first statement is `const accumulator = new StreamOutputAccumulator()` (`packages/agents/src/core/StreamProcessor.ts`) |
| A8 | A failed attempt writes **nothing** to `HistoryService` | CONFIRMED | `processStreamResponse` calls `_finalizeStreamProcessing` only **after** the `for await` completes; there is no `finally`. `_finalizeStreamProcessing` → `recordHistoryWithUsage` (`streamValidationHelpers.ts:159`) is the only site that records both the user turn and the AI turn |
| A9 | `StreamEventType.RETRY` already propagates to `AgentEventType.Retry` and to the public `{type:'retry'}` event | CONFIRMED | `TurnProcessor.ts:258` → `packages/agents/src/core/turn.ts:474-478` → `packages/agents/src/api/eventAdapter.ts:402-404` (`yield { type: 'retry' }`); schema at `packages/agents/src/api/event-schema.ts:139`, type at `event-types.ts:150` |
| A10 | `turn.ts` already resets the cumulative response outcome on RETRY | CONFIRMED | `packages/agents/src/core/turn.ts:474-478` — `const outcome = this.createEmptyResponseOutcome();` returned as the new cumulative outcome |
| A11 | `AgenticLoop` collects `ToolCallRequest` values and never clears them on RETRY | CONFIRMED | `packages/agents/src/core/agenticLoop/AgenticLoop.ts:524-547` — `toolCallRequests.push(event.value)`; cleared only by `isTerminalStreamOutcome` (Error / StreamIdleTimeout / UserCancelled / LoopDetected) |
| A12 | The CLI dispatcher treats `'retry'` as a no-op | CONFIRMED | `packages/cli/src/ui/hooks/agentStream/agentEventDispatcher.ts:354-361` — `case 'retry':` shares the "No state change" fallthrough group |
| A13 | The a2a-server executor collects `ToolCallRequest` in the same pattern and treats `Retry` as informational log-only | CONFIRMED | `packages/a2a-server/src/agent/executor.ts:476-497`; `packages/a2a-server/src/agent/task-support.ts:128,161,223` classify `AgentEventType.Retry` as `LOG_INFO_TYPES` |
| A14 | `MessageStreamOrchestrator` accumulates per-attempt state that survives a RETRY | CONFIRMED | `packages/agents/src/core/MessageStreamOrchestrator.ts:412-462` — `hadThinking`, `hadContent`, `hadToolCallsThisTurn`, `deferredEvents`, and `ctx.responseChunks.push(event.value)` on `AgentEventType.Content` |
| A15 | `ctx.responseChunks` is the AfterAgent hook's `responseText` | CONFIRMED | `MessageStreamOrchestrator._fireAfterHook` (`ctx.responseChunks.join('')`) and `MessageStreamTerminalHandler.fireAfterHook` (same) |
| A16 | The non-interactive CLI accumulates `responseText` / `quietTextBuffer` that feed the final JSON result | CONFIRMED | `packages/cli/src/nonInteractiveCliSupport.ts` — `handleText` returns `responseText + outputValue` in `jsonOutput` mode; `handleQuietText` appends to `quietTextBuffer`; `finalizeStream` emits one of them |
| A17 | Zed/ACP maps `'retry'` to `null` (ignored) | CONFIRMED | `packages/cli/src/zed-integration/zed-agent-event-handler.ts:104-106` |

## B. Type/interface verification

| # | Symbol | Expected | Actual | Match |
|---|--------|----------|--------|-------|
| B1 | `shouldRetryStreamAttempt` | `(error, params, attempt) => boolean` | `(error: unknown, params: SendMessageParams, attempt: number): boolean` | YES |
| B2 | `INVALID_CONTENT_RETRY_OPTIONS` | bounded turn budget | `{ maxAttempts: 2, initialDelayMs: 500 }` (`packages/core/src/core/chatSessionTypes.ts:47`) → `withinBudget = attempt < 1` → **exactly one restart per turn** | YES |
| B3 | `StreamOutputAccumulator` | has `add` / `materialize`, **no** `reset` | `packages/agents/src/core/streamOutputAccumulator.ts` — `add`, `materialize` only | YES |
| B4 | `PendingResponseBuffer` | has a `reset()` | `packages/cli/src/ui/hooks/agentStream/pendingResponseBuffer.ts` — `reset()` resets sanitizer, scanner and provisional tail | YES |
| B5 | `UseHistoryManagerReturn` | has a removal API | `{ history, addItem, updateItem, clearItems, loadHistory }` — **no removal API** | **NO — see finding F5** |
| B6 | `AgentEventDeps` (CLI dispatcher) | has access to `pendingResponse` | It does **not**; `pendingResponse` lives only in `ContentEventDeps` / `StreamEventHandlerDeps` | **NO — see finding F6** |
| B7 | `AgentEvent` `'retry'` variant | payload-free | `{ type: 'retry' }` — no fields | YES |

## C. Test-infrastructure verification

| # | Check | Result |
|---|-------|--------|
| C1 | Test discovery is structural (no manifest/allowlist) | CONFIRMED — `scripts/bun-test-roots.ts` (`DEFAULT_TEST_FILE_PATTERN = /\.(test\|spec\|bun)\.(ts\|tsx\|js)$/`, "deliberately **no** `files`, `include`, or `exclude` member"); `packages/cli/run-bun-tests.ts` and `packages/agents/run-bun-tests.ts` walk the filesystem. **No registration step is required for a new test file.** |
| C2 | `packages/agents` test API | `packages/agents/src/testApi.ts` re-exports `bun:test` — agents suites import `'../testApi.js'` |
| C3 | `packages/providers` already has direct `bun:test` suites | CONFIRMED — 39 files import `from 'bun:test'` (e.g. `src/auth/proxy/__tests__/github-broker-unknown-param.bun.test.ts`). Older `RetryOrchestrator.*.test.ts` files import `'vitest'`, which the `test-setup/augment-bun-vi.ts` preload shims onto Bun. **New files use `bun:test` directly.** |
| C4 | CLI React-hook harness for stream events | CONFIRMED — `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.terminalError.bun.tsx` drives the REAL `useSubmitQuery` + real `dispatchAgentEvent` + real `PendingResponseBuffer`, stubbing only `turnPreparation` and `SessionContext`. This is the harness the CLI phases reuse. |
| C5 | Integrated agents harness with a fake provider | CONFIRMED — `packages/agents/src/core/chatSession.issue2150.test.ts` builds a real `ChatSession` → `TurnProcessor` → `StreamProcessor` over a `TestRuntimeProviderManager`, with `retry.ts` deliberately NOT mocked. This is the harness the integrated phase reuses. |
| C6 | AgenticLoop harness | CONFIRMED — `packages/agents/src/core/agenticLoop/__tests__/agenticLoop-test-helpers.ts` exposes `AgentEventType.ToolCallRequest` builders; sibling suites (`agenticLoop.terminal-outcomes.test.ts`) already assert scheduling behaviour |
| C7 | Copyright year guard | `scripts/check-copyright-year.ts` requires the **current** calendar year in headers of **added** files → new `.ts`/`.tsx` files must say `Copyright 2026 Vybestack LLC` |
| C8 | New-JS guard | `scripts/check-no-new-js-files.ts` — new files must be TypeScript |
| C9 | Doc-placement guard | `scripts/check-doc-placement.ts` — plans live in `project-plans/`, never `dev-docs/plans/` |

## D. Size / lint-budget verification (blocking)

ESLint config (`eslint.config.js:248-255`): `complexity: 25`, `max-lines: 800`
(`skipBlankLines`, `skipComments`), `max-lines-per-function: 80` (same skips).
`sonarjs/cognitive-complexity: 30`.

Effective (non-blank, non-comment) line counts measured on this branch:

| File | raw | effective | headroom to 800 |
|------|-----|-----------|-----------------|
| `packages/agents/src/core/TurnProcessor.ts` | 937 | **797** | **3** |
| `packages/agents/src/core/MessageStreamOrchestrator.ts` | 821 | 702 | 98 |
| `packages/agents/src/core/agenticLoop/AgenticLoop.ts` | 780 | 573 | 227 |
| `packages/agents/src/core/turnAbortHelpers.ts` | 92 | 52 | 748 |
| `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` | 816 | 686 | 114 |
| `packages/cli/src/ui/hooks/agentStream/useStreamEventHandlers.ts` | 575 | 516 | 284 |
| `packages/cli/src/ui/hooks/agentStream/agentEventDispatcher.ts` | 435 | 376 | 424 |
| `packages/cli/src/ui/hooks/agentStream/contentEventProcessor.ts` | 245 | 215 | 585 |
| `packages/cli/src/ui/hooks/useHistoryManager.ts` | 390 | 334 | 466 |
| `packages/cli/src/nonInteractiveCliSupport.ts` | 701 (a2a executor 701/623 measured separately) | see note | — |
| `packages/a2a-server/src/agent/executor.ts` | 701 | 623 | 177 |

`MessageStreamOrchestrator._processStreamIteration` (lines 394-472) measures **68**
effective lines against the 80-line function budget → 12 lines of headroom.

`npx eslint packages/agents/src/core/TurnProcessor.ts` exits 0 today.

## E. Findings that change the plan

### F1 — `StreamOutputAccumulator.reset()` is unnecessary (issue item 2 is obsolete)

Issue #3048 asks for `StreamOutputAccumulator` to be "resettable" and for
`StreamProcessor` to reset it on the retry signal. **That is no longer needed.**
Evidence A7 + A8: `processStreamResponse` constructs a brand-new accumulator on
every call, `TurnProcessor` calls `makeApiCallAndProcessStream` once per attempt,
and the accumulator is never observed across attempts because
`_finalizeStreamProcessing` is only reached on normal completion. Adding a
`reset()` would be dead code and a new, untested state transition on a class whose
own doc comment already states the invariant ("State is per-instance and
per-stream, so a cancelled, errored, or stalled stream releases everything it had
collected rather than carrying it into the next turn").

**Decision: do not add `StreamOutputAccumulator.reset`.** A behavioural test pins
the *observable* property instead (one AI history entry after a discard+restart).

### F2 — The provider layer needs no change; it must be fenced instead

Evidence A1-A4. `markErrorAfterStreamOutput` is exactly right: it stops the
orchestrator from splicing two attempts into one iterator. The restart must
happen at the **fresh-attempt boundary** owned by `TurnProcessor`. The plan
therefore adds provider-layer *invariant fence* tests rather than provider-layer
behaviour changes.

### F3 — `TurnProcessor.ts` has 3 effective lines of `max-lines` headroom

Evidence D. Any net addition to `TurnProcessor.ts` risks tripping
`max-lines: 800`. Because suppression directives and threshold changes are
forbidden, the GREEN phase that touches `_runStreamAttempt` **must** relocate the
pure helper `_applyRetryTemperature` (TurnProcessor.ts:316-330, referenced only
from TurnProcessor.ts:263 — verified by repo-wide grep) into
`turnAbortHelpers.ts`, whose file header already describes itself as
"Retry-decision helpers extracted from TurnProcessor". That relocation frees
~12 effective lines and puts the temperature policy next to the retry policy.

### F4 — The turn budget and the provider budget are separate, and that is correct

`attachTransportAttemptBudget` (`packages/providers/src/transportAttemptBudget.ts`)
stores the budget on a **copy** of the options metadata, not on the caller's
`providerRequestContext` object, so each turn attempt starts a fresh provider
budget. Total worst-case transports for one turn become
`INVALID_CONTENT_RETRY_OPTIONS.maxAttempts (2) × retries`. This is bounded and
deterministic, and the second turn attempt legitimately needs its own transport
budget because it is a new request. No change; documented in the specification so
reviewers do not read it as unbounded.

### F5 — NEW: the CLI already commits part of an in-flight attempt to static history

`packages/cli/src/ui/hooks/agentStream/contentEventProcessor.ts:166-243`:
when `getSplitPoint() !== stableText.length` — i.e. as soon as the streamed text
contains a markdown-safe `\n\n` outside a code fence — `applySplitResult`
(line 86) calls `deps.addItem(...)`, committing the stable prefix to the CLI's
**static** history list, and `pendingResponse.consume(splitPoint)` drops it from
the retractable buffer.

Consequence: resetting the agent message buffer, the `PendingResponseBuffer`, the
pending history item and the thinking state — the rollback set named in issue
#3048 item 3 — is **not sufficient** for acceptance criterion 3. Any multi-
paragraph partial response leaves committed static blocks that the retry then
duplicates.

`UseHistoryManagerReturn` has no removal API (B5), so closing this gap requires
one. **Decision: in scope** (see `REQ-3048-009`); rejected alternatives are
recorded in `specification.md` §7.

### F6 — The CLI dispatcher cannot reach the discard surface directly

`AgentEventDeps` (agentEventDispatcher.ts:43) has `addItem`,
`flushPendingHistoryItem`, `pendingHistoryItemRef`, `thinkingBlocksRef`,
`setPendingHistoryItem`, `setThought` … but **not** `pendingResponse`. The
existing pattern for this is a named handler produced by
`useStreamEventHandlers` and spread into the dispatcher deps
(`useSubmitQuery.ts:296-316` spreads `...latestHandlers.current`). The discard
must follow that pattern (`handleStreamAttemptDiscarded`) rather than widening
`AgentEventDeps` with raw state.

### F7 — Three existing agents assertions encode the pre-#3048 contract and must be rewritten

`packages/agents/src/core/chatSession.issue2150.test.ts` currently asserts
`attempt === 1` (no restart) for:

1. `'does not retry a connection error after visible content was emitted'`
2. `'does not retry a connection error after a tool call was emitted'`
3. `'does not retry after hidden thinking metadata was emitted'`

and asserts zero AI history entries in
`'does not commit a failed response after visible content was emitted'`.

These are not bugs being enshrined — they were the deliberate contract before
#3048. Issue #3048 replaces that contract, so the assertions are rewritten to the
new expected behaviour (restart occurs; exactly one AI entry from the successful
attempt). The file's *other* assertions — non-transient mid-stream error,
`AbortError`, `ABORT_ERR`, aborted-signal, `InvalidStreamError` after a chunk,
`EmptyStreamError` after a chunk — stay **exactly as they are** and become the
regression fence for AC4/AC5/AC6.

### F8 — Post-output retry is narrowed to transport failures only

`shouldRetryStreamAttempt` currently returns `true` for `InvalidStreamError` /
`EmptyStreamError` regardless of transient-ness. If `!hasYieldedChunk` were simply
deleted, those two would also restart after partial output, changing two more
existing tests and widening the contract beyond the issue ("transient transport
failure"). **Decision: after output, only `isNetworkTransientError` qualifies.**
Content-validity verdicts on output that is being discarded are not a transport
condition and stay out of scope. Before output, behaviour is bit-for-bit
unchanged.

### F9 — Zed/ACP cannot retract already-sent chunks

`zed-agent-event-handler.ts` streams `agent_message_chunk` updates through
`StreamBatcher`, and ACP `SessionUpdate` has no retraction primitive. Partial
mitigation (dropping only the not-yet-flushed batch) would be timing-dependent
and therefore non-deterministic. **Decision: out of scope, documented limitation
plus a follow-up issue** (see specification §8). The interactive CLI (AC3) and
the non-interactive JSON result are fixed in this issue.

### F10 — Per-chunk AfterModel hooks cannot be un-fired

`StreamProcessor._processAfterModelHook` fires the AfterModel hook per streamed
chunk. Hooks are user-authored side-effecting processes; there is no
compensating "attempt abandoned" event in `packages/core/src/hooks/types.ts`.
**Decision: no change.** This matches today's contract for any stream that fails
mid-way (the hooks already fired and the turn ended in error). Documented in the
audit table with a follow-up suggestion, not implemented.

## F. Blocking issues

None. Every dependency, type and call path required by `plan.md` exists on this
branch. The two constraints that alter the implementation shape (F3 file-size
budget, F5 CLI static commits) are folded into the phase instructions.

## Verification gate

- [x] All dependencies verified (no new third-party dependency is introduced)
- [x] All types match the plan's assumptions, or the mismatch is recorded (B5, B6)
- [x] All call paths are possible
- [x] Test infrastructure exists and requires no registration step
- [x] Lint/size budgets measured; the one tight budget has a concrete remedy (F3)
