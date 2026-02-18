# Plan: Hook System Refactor

Plan ID: PLAN-20250218-HOOKSYSTEM
Generated: 2025-02-18
Total Phases: 16 (P03–P16) + preflight
Requirements: DELTA-HSYS-001, DELTA-HSYS-002, DELTA-HEVT-001–004, DELTA-HRUN-001–004, DELTA-HPAY-001–006, DELTA-HBUS-001–003, DELTA-HTEL-001–003, DELTA-HAPP-001–002, DELTA-HFAIL-001–005

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 00a)
2. Verified all existing hook types, interfaces, and call patterns exist as assumed
3. Written tests that target REAL behavior — no stubs, no mock theater
4. Verified all dependencies and types exist as assumed in the codebase

## Purpose

Close five critical gaps in the llxprt hook subsystem to achieve robustness parity with
the upstream Gemini CLI reference implementation:

1. No MessageBus integration (hooks only callable via direct `fire*Event` methods)
2. No event-payload validation (mediated requests bypass all input validation)
3. No model-payload translation for `BeforeModel`, `AfterModel`, `BeforeToolSelection`
4. No centralized common-output processing (`shouldStop`, `systemMessage`, `suppressOutput`)
5. Silent failure masking (`catch` blocks return `EMPTY_SUCCESS_RESULT` instead of structured failure envelopes)

## Target Files

| File | Change |
|------|--------|
| `packages/core/src/hooks/hookSystem.ts` | MODIFY — wire MessageBus/DebugLogger; expose management APIs; call dispose() |
| `packages/core/src/hooks/hookEventHandler.ts` | MODIFY — add mediated path, validation, translation, common-output, failure envelopes |
| `packages/core/src/hooks/hookBusContracts.ts` | CREATE — HookExecutionRequest/HookExecutionResponse interfaces |
| `packages/core/src/hooks/hookValidators.ts` | CREATE — type-predicate validators per event type |

## Implementation Phases

| Phase | Files | Feature |
|-------|-------|---------|
| A: P03–P05 | hookSystem.ts, hookEventHandler.ts | Lifecycle/composition: wiring, management APIs, dispose, type fixes |
| B: P06–P08 | hookEventHandler.ts, hookBusContracts.ts | MessageBus: subscription, routing, correlated responses, model translation |
| C: P09–P11 | hookValidators.ts, hookEventHandler.ts | Validation: type-predicate validators, mediated validation gate |
| D: P12–P14 | hookEventHandler.ts | Common-output semantics, per-hook logging, batch summaries, failure envelopes |
| E: P15–P16 | All | Integration and E2E verification |

## Execution Order (MANDATORY — No Skipping)

```
P03 → P03a → P04 → P04a → P05 → P05a →
P06 → P06a → P07 → P07a → P08 → P08a →
P09 → P09a → P10 → P10a → P11 → P11a →
P12 → P12a → P13 → P13a → P14 → P14a →
P15 → P15a → P16 → P16a
```

## Integration Analysis

### Existing Code That Will Use This Feature
- `packages/core/src/hooks/hookSystem.ts` — MODIFIED to wire dependencies and expose management APIs
- `packages/core/src/hooks/hookEventHandler.ts` — MODIFIED as the unified orchestrator
- `packages/core/src/core/coreToolHookTriggers.ts` — existing direct callers of `fire*Event`; must remain functional
- `packages/core/src/hooks/hooks-caller-application.test.ts` — existing integration tests (must remain passing)
- `packages/core/src/hooks/hooks-caller-integration.test.ts` — existing integration tests (must remain passing)

### Existing Code To Be Replaced/Extended
- Failure handling in `hookEventHandler.ts` catch blocks (return `buildFailureEnvelope(...)` instead of `EMPTY_SUCCESS_RESULT`)
- `fireSessionStartEvent` / `fireSessionEndEvent` parameter types (from `string` to enum types)
- All internal methods accepting `eventName: string` (to use `HookEventName` enum)
- No-match short-circuit paths returning `EMPTY_SUCCESS_RESULT` constant (to call `makeEmptySuccessResult()`)

### User Access Points
- **Direct API**: Existing `fire*Event(...)` methods (unchanged interface, extended behavior)
- **MessageBus**: Callers publish `HOOK_EXECUTION_REQUEST`; handler publishes `HOOK_EXECUTION_RESPONSE`
- **Management API**: `hookSystem.setHookEnabled(...)` and `hookSystem.getAllHooks()`

## Pseudocode References

| Pseudocode File | Referenced By Phases |
|-----------------|----------------------|
| `analysis/pseudocode/hook-event-handler.md` | P05, P08, P11, P14 |
| `analysis/pseudocode/message-bus-integration.md` | P08 |
| `analysis/pseudocode/validation-boundary.md` | P11 |
| `analysis/pseudocode/common-output-processing.md` | P14 |

## Execution Tracker

| Phase | ID | Status | Semantic? | Notes |
|-------|-----|--------|-----------|-------|
| 00a | P00a | ⬜ | N/A | Preflight verification |
| 03 | P03 | ⬜ | ⬜ | Lifecycle stub |
| 03a | P03a | ⬜ | ⬜ | Lifecycle stub verification |
| 04 | P04 | ⬜ | ⬜ | Lifecycle TDD |
| 04a | P04a | ⬜ | ⬜ | Lifecycle TDD verification |
| 05 | P05 | ⬜ | ⬜ | Lifecycle impl |
| 05a | P05a | ⬜ | ⬜ | Lifecycle impl verification |
| 06 | P06 | ⬜ | ⬜ | MessageBus stub |
| 06a | P06a | ⬜ | ⬜ | MessageBus stub verification |
| 07 | P07 | ⬜ | ⬜ | MessageBus TDD |
| 07a | P07a | ⬜ | ⬜ | MessageBus TDD verification |
| 08 | P08 | ⬜ | ⬜ | MessageBus impl |
| 08a | P08a | ⬜ | ⬜ | MessageBus impl verification |
| 09 | P09 | ⬜ | ⬜ | Validation stub |
| 09a | P09a | ⬜ | ⬜ | Validation stub verification |
| 10 | P10 | ⬜ | ⬜ | Validation TDD |
| 10a | P10a | ⬜ | ⬜ | Validation TDD verification |
| 11 | P11 | ⬜ | ⬜ | Validation impl |
| 11a | P11a | ⬜ | ⬜ | Validation impl verification |
| 12 | P12 | ⬜ | ⬜ | Semantics stub |
| 12a | P12a | ⬜ | ⬜ | Semantics stub verification |
| 13 | P13 | ⬜ | ⬜ | Semantics TDD |
| 13a | P13a | ⬜ | ⬜ | Semantics TDD verification |
| 14 | P14 | ⬜ | ⬜ | Semantics impl |
| 14a | P14a | ⬜ | ⬜ | Semantics impl verification |
| 15 | P15 | ⬜ | ⬜ | Integration |
| 15a | P15a | ⬜ | ⬜ | Integration verification |
| 16 | P16 | ⬜ | ⬜ | E2E |
| 16a | P16a | ⬜ | ⬜ | E2E verification |
