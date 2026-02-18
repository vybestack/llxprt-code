# Feature Specification: Hook System Refactor

**Plan ID**: PLAN-20250218-HOOKSYSTEM
**Generated**: 2025-02-18
**Author**: Architect
**Status**: Active

---

## Purpose

The llxprt hook subsystem must achieve robustness parity with the upstream Gemini CLI reference implementation. The current implementation has five critical gaps:

1. **No MessageBus integration** — hooks can only be triggered via direct `fire*Event` method calls; asynchronous/decoupled invocation via the message bus is absent.
2. **No event-payload validation** — mediated requests bypass all input validation, allowing malformed payloads to reach the planner/runner.
3. **No model-payload translation** — `BeforeModel`, `AfterModel`, and `BeforeToolSelection` events do not translate their payloads through the hook translator before execution.
4. **No centralized common-output processing** — each caller independently parses `shouldStop`, `systemMessage`, and `suppressOutput`, leading to behavioral inconsistency.
5. **Silent failure masking** — `catch` blocks return `EMPTY_SUCCESS_RESULT` instead of structured failure envelopes, hiding errors from callers.

This refactor closes all five gaps via a phased approach that is additive and backwards-compatible.

---

## Architectural Decisions

- **Pattern**: Event-driven with optional message bus mediation; orchestrator pattern for `HookEventHandler`
- **Technology Stack**: TypeScript strict mode, Vitest for testing, existing `DebugLogger` for observability (NO OpenTelemetry/OTLP)
- **Data Flow**: Caller → HookEventHandler → (validate) → (translate) → Planner → Runner → Aggregator → processCommonHookOutputFields → ProcessedHookResult → Caller
- **Integration Points**: MessageBus (optional), DebugLogger, HookPlanner, HookRunner, HookAggregator, HookTranslator

---

## Project Structure

```
packages/core/src/hooks/
  hookSystem.ts              # MODIFY — wire MessageBus/DebugLogger; add management APIs
  hookEventHandler.ts        # MODIFY — mediated path, validation, translation, common-output, failure envelopes
  hookBusContracts.ts        # CREATE — HookExecutionRequest/HookExecutionResponse interfaces
  hookValidators.ts          # CREATE — type-predicate validators per event type
  hookPlanner.ts             # existing (no changes required)
  hookRunner.ts              # existing (no changes required)
  hookAggregator.ts          # existing (no changes required)
  hookTranslator.ts          # existing (referenced for translation)
  types.ts                   # existing (SessionStartSource, SessionEndReason, HookEventName)
```

---

## Technical Environment

- **Type**: Library (TypeScript package)
- **Runtime**: Node.js 20.x
- **Framework**: None (pure TypeScript)
- **Test Framework**: Vitest
- **Observability**: DebugLogger (local, no remote telemetry)

---

## Integration Points (MANDATORY)

### Existing Code That Will USE This Feature

- `packages/core/src/hooks/hookSystem.ts` — MODIFIED to wire dependencies and expose management APIs
- `packages/core/src/hooks/hookEventHandler.ts` — MODIFIED as the unified orchestrator
- `packages/core/src/core/coreToolHookTriggers.ts` — existing direct callers of `fire*Event`; must remain functional
- `packages/core/src/hooks/hooks-caller-application.test.ts` — existing integration tests
- `packages/core/src/hooks/hooks-caller-integration.test.ts` — existing integration tests
- Any future caller that publishes `HOOK_EXECUTION_REQUEST` to the MessageBus

### Existing Code To Be REPLACED/Extended

- Failure handling in `hookEventHandler.ts` catch blocks (currently return `EMPTY_SUCCESS_RESULT`, must return `buildFailureEnvelope(...)`)
- `fireSessionStartEvent` / `fireSessionEndEvent` parameter types (currently `string`, must use `SessionStartSource` / `SessionEndReason`)
- All internal methods accepting `eventName: string` (must use `HookEventName`)
- No-match short-circuit paths returning the raw `EMPTY_SUCCESS_RESULT` constant (must call `makeEmptySuccessResult()`)

### User Access Points

- **Direct API**: Callers invoke `hookEventHandler.fireBeforeToolEvent(...)` etc. (unchanged, extended)
- **MessageBus**: Callers publish `HOOK_EXECUTION_REQUEST` message; handler subscribes and publishes `HOOK_EXECUTION_RESPONSE`
- **Management API**: `hookSystem.setHookEnabled(...)` and `hookSystem.getAllHooks()` exposed for admin/control surfaces

### Migration Requirements

- All existing direct-path call sites continue to work without changes
- `ProcessedHookResult` replaces ad hoc parsing in any caller that currently extracts `shouldStop` / `systemMessage` / `suppressOutput`
- `buildFailureEnvelope` replaces all `EMPTY_SUCCESS_RESULT` returns in catch blocks
- `makeEmptySuccessResult()` replaces all direct `EMPTY_SUCCESS_RESULT` returns in no-match paths

---

## Formal Requirements

All requirements are prefixed `DELTA-` and come from `requirements.md`.

### A. HookSystem Lifecycle and Architecture

```
[DELTA-HSYS-001] HookSystem SHALL inject MessageBus and DebugLogger into HookEventHandler during composition
[DELTA-HSYS-002] HookSystem SHALL expose setHookEnabled / getAllHooks management methods
```

### B. HookEventHandler Dual-Path Execution

```
[DELTA-HEVT-001] HookEventHandler SHALL subscribe to MessageBus HOOK_EXECUTION_REQUEST and route to fire-event handlers
[DELTA-HEVT-002] When HOOK_EXECUTION_REQUEST received, HookEventHandler SHALL publish HOOK_EXECUTION_RESPONSE with same correlationId and explicit success/failure
[DELTA-HEVT-003] When mediated request references unsupported event name, SHALL publish failed response (no throw)
[DELTA-HEVT-004] HookEventHandler SHALL expose dispose() that unsubscribes from HOOK_EXECUTION_REQUEST; HookSystem teardown SHALL call dispose()
```

### C. Planner/Runner/Aggregator Post-Processing

```
[DELTA-HRUN-001] HookEventHandler SHALL apply centralized post-aggregation processing for common hook output semantics
[DELTA-HRUN-002] If aggregated output contains stop intent, HookEventHandler SHALL normalize and surface canonical stop reason
[DELTA-HRUN-003] If aggregated output contains systemMessage and suppressOutput fields, HookEventHandler SHALL apply consistent display semantics from one centralized location
[DELTA-HRUN-004] processCommonHookOutputFields SHALL return ProcessedHookResult interface with: aggregated, shouldStop, stopReason, systemMessage, suppressOutput
```

### D. Payload Translation and Validation

```
[DELTA-HPAY-001] HookEventHandler SHALL perform runtime validation at mediated boundaries for all 8 event families
[DELTA-HPAY-002] If mediated payload validation fails, SHALL return structured failure and SHALL NOT execute planner/runner
[DELTA-HPAY-003] HookEventHandler SHALL translate model payloads for BeforeModel/AfterModel/BeforeToolSelection for BOTH mediated and direct paths (Phase B, simultaneously)
[DELTA-HPAY-004] If payload translation fails, SHALL return/publish structured failure with error details and correlationId when available
[DELTA-HPAY-005] Each event-specific input validator SHALL be a TypeScript type predicate (input is T), not plain boolean
[DELTA-HPAY-006] fireSessionStartEvent SHALL accept { source: SessionStartSource }; fireSessionEndEvent SHALL accept { reason: SessionEndReason }
```

### E. MessageBus Integration Semantics

```
[DELTA-HBUS-001] SHALL declare and use HookExecutionRequest / HookExecutionResponse interfaces exclusively for bus communication
[DELTA-HBUS-002] If MessageBus unavailable, hook execution SHALL continue via direct fire-event methods without regression
[DELTA-HBUS-003] If HOOK_EXECUTION_REQUEST lacks correlationId, handler SHALL generate one via crypto.randomUUID() and echo in response
```

### F. Local Logging and Observability

```
[DELTA-HTEL-001] For each hook execution result, SHALL emit per-hook log records via DebugLogger (eventName, hookIdentity, duration, success, exitCode, stdout, stderr, errorMessage)
[DELTA-HTEL-002] SHALL log batch-level summaries via DebugLogger (hookCount, successCount, failureCount, totalDuration) per fired event
[DELTA-HTEL-003] If one or more hooks fail, SHALL log explicit error diagnostics per failure via DebugLogger
```

### G. Caller-Side Application Semantics

```
[DELTA-HAPP-001] Hook subsystem SHALL provide single canonical interpretation point for common hook output fields
[DELTA-HAPP-002] If hook output indicates stop, caller-facing results SHALL preserve stop intent and effective reason consumable without ad hoc parsing
```

### H. Failure Semantics

```
[DELTA-HFAIL-001] HookEventHandler SHALL standardize failure envelopes; buildFailureEnvelope SHALL be used in all catch blocks; returning EMPTY_SUCCESS_RESULT from catch is non-conforming
[DELTA-HFAIL-002] When mediated execution fails at any stage, SHALL publish failure response with sufficient error detail for diagnosis
[DELTA-HFAIL-003] If no hooks match valid event, SHALL return success envelope with empty outputs/errors (deterministic no-op)
[DELTA-HFAIL-004] EMPTY_SUCCESS_RESULT SHALL NOT be returned by reference; all no-match paths SHALL call makeEmptySuccessResult() factory
[DELTA-HFAIL-005] All internal routing/helper/private methods accepting event name SHALL use HookEventName enum, not string
```

---

## Data Schemas

```typescript
// --- MessageBus contracts (hookBusContracts.ts) ---

interface HookExecutionRequest {
  /** Discriminated event name — must be HookEventName enum value */
  eventName: HookEventName;
  /** Event-specific input (validated before routing) */
  input: Record<string, unknown>;
  /** Caller-supplied opaque correlation token */
  correlationId: string;
}

interface HookExecutionResponse {
  /** Echoed from the originating request */
  correlationId: string;
  /** True only when all execution stages completed without error */
  success: boolean;
  /** Present on success */
  output?: AggregatedHookResult;
  /** Present on failure */
  error?: {
    code?: string;
    message: string;
    details?: unknown;
  };
}

// --- ProcessedHookResult (hookEventHandler.ts) ---

interface ProcessedHookResult {
  aggregated: AggregatedHookResult;
  shouldStop: boolean;
  stopReason: string | undefined;
  systemMessage: string | undefined;
  suppressOutput: boolean;
}

// --- Failure metadata ---

interface FailureMeta {
  eventName?: HookEventName;
  correlationId?: string;
}

// --- Base execution context (built for every invocation) ---

interface BaseHookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  timestamp: string;       // ISO 8601
  transcript_path: string; // placeholder acceptable
}

// --- Event-specific validators (type predicates) ---

function validateBeforeToolInput(input: unknown): input is BeforeToolInput
function validateAfterToolInput(input: unknown): input is AfterToolInput
function validateBeforeAgentInput(input: unknown): input is BeforeAgentInput
function validateAfterAgentInput(input: unknown): input is AfterAgentInput
function validateBeforeModelInput(input: unknown): input is BeforeModelInput
function validateAfterModelInput(input: unknown): input is AfterModelInput
function validateBeforeToolSelectionInput(input: unknown): input is BeforeToolSelectionInput
function validateNotificationInput(input: unknown): input is NotificationInput
```

---

## Example Data

```json
// Valid HookExecutionRequest
{
  "eventName": "BeforeTool",
  "input": {
    "tool_name": "read_file",
    "tool_input": { "path": "/tmp/test.txt" }
  },
  "correlationId": "req-abc-123"
}

// Successful HookExecutionResponse
{
  "correlationId": "req-abc-123",
  "success": true,
  "output": {
    "hookResults": [],
    "success": true,
    "allOutputs": [],
    "errors": [],
    "totalDuration": 42
  }
}

// Failed HookExecutionResponse (validation failure)
{
  "correlationId": "req-abc-123",
  "success": false,
  "error": {
    "code": "VALIDATION_FAILURE",
    "message": "BeforeTool input missing required field: tool_name",
    "details": { "stage": "validation", "eventName": "BeforeTool" }
  }
}
```

---

## Constraints

- NO external HTTP calls in unit tests
- NO OpenTelemetry or OTLP dependencies
- All observability via existing `DebugLogger` class
- All async operations must have defined error handling paths
- `EMPTY_SUCCESS_RESULT` must never be returned by reference — always via `makeEmptySuccessResult()`
- Validators must use TypeScript type predicates
- `buildFailureEnvelope` must be used in ALL catch blocks (never `EMPTY_SUCCESS_RESULT` in catch)
- Internal routing methods must use `HookEventName` enum not raw `string`
- `cwd` must use `config.getWorkingDir()` not `config.getTargetDir()`

---

## Performance Requirements

- Per-hook logging: lightweight record construction only; no blocking I/O in hot path
- Translation: synchronous or fast-path async; errors must not block the batch
- MessageBus subscription: one subscription per HookEventHandler instance; no polling
- No regression in direct-path latency from the addition of post-processing stage

---

## Implementation Phases Summary

| Phase | Plan Phase IDs | Feature |
|-------|----------------|---------|
| A | P03–P05 | Lifecycle/composition (HookSystem wiring, management APIs, dispose, type fixes) |
| B | P06–P08 | MessageBus integration (subscription, routing, correlated responses, model translation both paths) |
| C | P09–P11 | Validation boundaries (type-predicate validators, mediated validation gate) |
| D | P12–P14 | Common-output semantics (ProcessedHookResult, per-hook logging, batch summaries, failure envelopes) |
| E | P15–P16 | Integration and E2E verification |
