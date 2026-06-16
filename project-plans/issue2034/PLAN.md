# Plan: Consolidate the agentic turn loop into the engine (agents package)

Plan ID: PLAN-20260615-ISSUE2034
Generated: 2026-06-15
Issue: #2034 (Parent #1568, Blocks #1594, Pairs with #2033)
Requirements: REQ-LOOP-001 .. REQ-LOOP-008

## Problem Statement

The **agentic turn loop** (send message → stream turn → if model requested tools,
run them subject to policy/approval → feed results back → repeat until the model
stops requesting tools) is currently **hand-rolled in clients**, not owned by the
engine. There are (at least) two independent implementations:

1. CLI: spread across `packages/cli/src/ui/hooks/geminiStream/` hooks
   (`toolCompletionHandler.ts`, `useSubmitQuery.ts`, `useGeminiStreamOrchestration.ts`,
   `../useReactToolScheduler.ts`).
2. a2a-server: hand-rolled again inside `packages/a2a-server/src/agent/task.ts`.

This issue moves the loop into `packages/agents` (which already owns `AgentClient`
single-turn `sendMessageStream`, the `CoreToolScheduler`, and the
`ConfirmationCoordinator`) and exposes **two injection points**:

- **Policy** (automatic ALLOW/DENY/ASK_USER): existing `PolicyEngine` + `ApprovalMode`.
  Pure engine logic, no UI.
- **Approval** (only on ASK_USER): an injected handler resolving a
  `ToolConfirmationOutcome`. This is the one place clients differ.

## Scope Boundary (read first)

This issue is limited to making the loop **exist in the right place as an engine
primitive** with the policy/approval injection points wired. Its internal entry
point may stay internal/unpolished.

It does NOT design the public `createAgent`/`Agent` surface, the `AgentEvent` union,
the `stream()` signature, or re-export policy/outcome enums publicly — those are
**#1594**'s job and must NOT be pre-empted here.

### Out of scope (do NOT do)
- Public `createAgent`/`Agent` API (#1594).
- CLI thin-UI rewrite (#1595).
- Migrating a2a-server onto the loop (later dedicated issue). a2a is evidence of
  duplication and a future beneficiary, NOT a migration target here.
- Re-homing `ApprovalMode`/`PolicyEngine`/`ToolConfirmationOutcome`.
- Any change to tool *behavior*, approval *semantics*, or user-visible CLI flow.

## Constraints (per dev-docs/RULES.md and #1568)

- **No backward-compatibility shims / re-export stubs** to dodge migration. Update
  import sites directly. (#1568 requirement.)
- **CLI behavior is unchanged.** CLI keeps confirmation dialog, ModifyWithEditor,
  keypress handling, spinner, pending-history rendering. It LOSES the hand-rolled
  continuation plumbing (submitQuery continuation / functionResponse assembly /
  markToolsAsSubmitted), which moves into the engine.
- **TDD mandatory.** Integration-first behavioral tests drive a multi-turn tool
  loop through the new engine entry point. No mock theater — assert event sequences,
  history contents, and outcomes, NOT "method was called". No new `any`.
- Behavior-preserving: existing CLI streaming/tool tests must pass; move/realign
  tests with the code.

## Key Facts From Research (Preflight)

| Fact | Evidence |
|------|----------|
| Single-turn primitive lives in engine | `AgentClient.sendMessageStream` returns `AsyncGenerator<ServerGeminiStreamEvent, unknown>` (`packages/agents/src/core/client.ts:687`) |
| Scheduler completion callback | `onAllToolCallsComplete(completedCalls: CompletedToolCall[])` (`coreToolScheduler.ts:719`) |
| Scheduler update callback | `onToolCallsUpdate(toolCalls: ToolCall[])` (`coreToolScheduler.ts:733`) |
| Scheduler output callback | `outputUpdateHandler(id, chunk)` (`coreToolScheduler.ts:602`) |
| Promise-wrapper pattern for completion | `nonInteractiveToolExecutor.ts` uses `completionResolver` + `getOrCreateScheduler` |
| Confirmation routed over bus | `ConfirmationCoordinator` publishes `TOOL_CONFIRMATION_REQUEST`, awaits `TOOL_CONFIRMATION_RESPONSE` by correlationId |
| Approval via bus | `messageBus.respondToConfirmation(correlationId, outcome, payload?)` (`confirmation-bus`) |
| Continuation helpers to extract | `buildToolResponses`, `classifyCompletedTools`, `recordCancelledToolHistory` in `toolCompletionHandler.ts`; `splitPartsByRole` in `streamUtils.ts` |
| Tool request accumulation | CLI accumulates `GeminiEventType.ToolCallRequest` events (`turn.ts` enum) |
| Test infra | `TestRuntimeProviderManager` (`packages/agents/src/test-utils/`), `getTestRuntimeMessageBus`, `getOrCreateScheduler`/`disposeScheduler`/`clearAllSchedulers` from core scheduler singleton |
| Event types | `ServerGeminiStreamEvent` union in `packages/core/src/core/turn.ts:289`; `GeminiEventType` enum at line 48 |

## Requirements

### REQ-LOOP-001: Engine-owned multi-turn loop
**Full Text**: A single loop implementation lives in `packages/agents` and runs
send → stream → policy → (ASK_USER → approval) → execute → feed-back → repeat, to
turn completion, yielding a flat event stream including tool-execution events.
**Behavior**:
- GIVEN: a model that requests a tool then produces final text
- WHEN: the loop runs with the input message
- THEN: it yields the model's stream events, executes the tool, feeds the
  functionResponse back, runs another turn, and stops when no tools are requested.

### REQ-LOOP-002: Two injection points
**Full Text**: The loop takes a policy (PolicyEngine/ApprovalMode via config) and
an approval handler as injection points; the approval handler is invoked only on
ASK_USER and resolves a `ToolConfirmationOutcome`.

### REQ-LOOP-003: CLI-style ASK_USER flow (headless)
**Full Text**: With a policy that returns ASK_USER, an injected approval handler
returning `ProceedOnce` continues and the tool executes; `Cancel` aborts the tool
and the loop continues; `ModifyWithEditor`-style modification updates args.

### REQ-LOOP-004: a2a-style auto flow (headless)
**Full Text**: With a policy that never asks (auto/YOLO), tools execute WITHOUT
invoking the approval handler, and a multi-tool batch feeds results back to the model.

### REQ-LOOP-005: Cancellation via AbortSignal
**Full Text**: Cancellation via AbortSignal cleanly stops the loop and tears down,
both during stream and during tool execution.

### REQ-LOOP-006: CLI consumes the single loop
**Full Text**: The CLI consumes this single loop. The CLI no longer contains its own
continuation state machine. CLI user-visible behavior is identical. Existing CLI
streaming/tool tests pass.

### REQ-LOOP-007: No second loop / no shims
**Full Text**: No client contains a second loop implementation (a2a excepted as
documented future beneficiary). No backward-compat re-export shims remain in CLI for
the moved helpers — import sites updated directly.

### REQ-LOOP-008: Build & verification
**Full Text**: No dependency cycles introduced (agents → core/tools/policy only).
Full verification passes: test, lint, typecheck, format, build, and profile smoke.

---

## Phase 1: Engine Loop (TDD)

### Files to Create
- `packages/agents/src/core/agenticLoop/types.ts`
  - `AgenticLoopEvent` discriminated union: wraps model stream events
    (`{ kind: 'stream'; event: ServerGeminiStreamEvent }`), tool scheduling/status
    updates (`{ kind: 'tool_update'; toolCalls }`), tool output
    (`{ kind: 'tool_output'; callId; chunk }`), tool completion
    (`{ kind: 'tools_complete'; completed }`), and approval-awaiting
    (`{ kind: 'awaiting_approval'; toolCalls }`).
  - `AgenticLoopOptions`: `{ agentClient; config; messageBus; approvalHandler?; }`.
  - `ApprovalHandler` type: `(request: ToolConfirmationRequest) => Promise<ToolConfirmationOutcome>`.
  - Markers: `@plan PLAN-20260615-ISSUE2034.P01 @requirement REQ-LOOP-002`.
- `packages/agents/src/core/agenticLoop/loopHelpers.ts`
  - Move (cut) `buildToolResponses`, `classifyCompletedTools`,
    `recordCancelledToolHistory` from CLI `toolCompletionHandler.ts`.
  - Move (cut) `splitPartsByRole` from CLI `streamUtils.ts`.
  - These are pure functions operating on `CompletedToolCall[]` (engine type) — adapt
    signatures away from CLI `TrackedToolCall` to engine `CompletedToolCall`.
  - Markers: `@requirement REQ-LOOP-001`.
- `packages/agents/src/core/agenticLoop/AgenticLoop.ts`
  - `class AgenticLoop` with `async *run(message, signal): AsyncGenerator<AgenticLoopEvent>`.
  - Loop body per research facts: sendMessageStream → yield+accumulate ToolCallRequest
    → schedule via `config.getOrCreateScheduler` with callbacks that push events to an
    internal queue → await completion (Promise-wrapper) → build functionResponse via
    loopHelpers → record history via `agentClient.addHistory` for cancelled tools →
    loop with functionResponse parts; stop when no Gemini-bound tools completed.
  - Approval sugar: if `approvalHandler` provided, subscribe to
    `TOOL_CONFIRMATION_REQUEST`, call handler, `respondToConfirmation`. Cleanup on teardown.
  - Markers: `@requirement REQ-LOOP-001,002,003,004,005`.
- `packages/agents/src/core/agenticLoop/index.ts` — barrel.
- `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.integration.test.ts`
  - Suite 1 "CLI-style with ASK_USER policy": ProceedOnce / Cancel / inline-modify.
  - Suite 2 "a2a-style with auto policy": no approval handler invoked; multi-tool batch.
  - Suite 3 "Cancellation via AbortSignal": abort during stream; abort during tools.
  - Use `vi.fn()` async-generator mock provider via `TestRuntimeProviderManager`; real
    `AgentClient`, real `CoreToolScheduler`, real `ConfirmationCoordinator`, real tools
    (`MockTool` infra only as the *tool implementation*, not as the loop under test).
  - Assert event sequences + final history + tool execution effects.

### Files to Modify
- `packages/agents/src/index.ts` — export `AgenticLoop`, types, `ApprovalHandler`, helpers.
- `packages/cli/src/ui/hooks/geminiStream/toolCompletionHandler.ts` — remove the moved
  pure helpers; import them from `@vybestack/llxprt-code-agents`. (No shim — Phase 2
  rewires; here we keep CLI compiling by importing from the new home.)
- `packages/cli/src/ui/hooks/geminiStream/streamUtils.ts` — remove `splitPartsByRole`;
  import from agents where still used.

### Verification (Phase 1)
- `npm run test -- packages/agents` green incl. new integration test.
- `npm run typecheck`, `npm run lint`, `npm run build` green.
- No `any`; no TODO/STUB in new files.

---

## Phase 2: CLI Integration (TDD, behavior-preserving)

### Files to Create
- `packages/cli/src/ui/hooks/geminiStream/useAgenticLoop.ts`
  - Obtains/creates the `AgenticLoop` (NO approvalHandler — bus-based UI path stays).
  - `runLoop(message)` starts the loop, translates `AgenticLoopEvent` into the existing
    React state updates (reusing `useStreamEventHandlers` / scheduler bridge display).
  - Manages AbortController for cancellation.

### Files to Modify
- `useSubmitQuery.ts` — remove `isContinuation` branching + continuation re-submit;
  call `runLoop()`; keep queuing + slash/shell interception; keep public `submitQuery()`.
- `toolCompletionHandler.ts` — remove `_executeCompletedTools` continuation path,
  `buildToolResponses` usage, pre-resubmit `markToolsAsSubmitted`. Keep display-side:
  `onTodoPause`, `processMemoryToolResults`.
- `useGeminiStreamOrchestration.ts` — remove `handleCompletedToolsRef` continuation wiring.
- `useReactToolScheduler.ts` — keep `onToolCallsUpdate` + `outputUpdateHandler` for
  display; remove `onAllToolCallsComplete` continuation wiring + `responseSubmittedToGemini`
  flag (engine owns submission).

### Verification (Phase 2)
- `packages/cli/src/ui/hooks/useGeminiStream.test.tsx` + all
  `geminiStream/__tests__/` tests green.
- Confirmation dialog, ModifyWithEditor, Escape/Ctrl+C cancel, loop-detection,
  multi-tool batches all behave identically.
- No CLI file imports loop helpers from old locations; no shims.

---

## Phase 3: Final Verification & Docs

- `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`.
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`.
- JSDoc on `AgenticLoop` documenting the two injection points and bus-native approval.
- Inline comments in CLI hooks noting delegation to engine loop.

## Success Criteria
- All REQ-LOOP-001..008 satisfied with passing behavioral tests.
- One loop implementation in `packages/agents`; CLI consumes it; behavior identical.
- Full verification green.
