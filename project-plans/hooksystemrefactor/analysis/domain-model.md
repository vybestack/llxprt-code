# Domain Model — Hook System Refactor

**Plan ID**: PLAN-20250218-HOOKSYSTEM
**Phase**: Analysis

---

## 1. Entity Relationships

```
HookSystem
  |-- 1:1 --> HookEventHandler  (composes; injects MessageBus? and DebugLogger?)
  |-- 1:1 --> HookRegistry      (manages hook definitions)
  |-- manages lifecycle of HookEventHandler

HookEventHandler
  |-- uses --> HookPlanner      (resolves matching hooks)
  |-- uses --> HookRunner       (executes hooks)
  |-- uses --> HookAggregator   (merges per-hook results)
  |-- uses --> HookTranslator   (model payload normalization)
  |-- uses? --> MessageBus      (optional; subscribe/publish)
  |-- uses? --> DebugLogger     (optional; per-hook and batch logging)
  |-- exposes --> dispose()     (unsubscribes from MessageBus)

MessageBus
  |-- carries --> HookExecutionRequest   (inbound to HookEventHandler)
  |-- carries --> HookExecutionResponse  (outbound from HookEventHandler)

HookExecutionRequest
  |-- contains --> eventName: HookEventName
  |-- contains --> input: Record<string, unknown>
  |-- contains --> correlationId: string

HookExecutionResponse
  |-- contains --> correlationId: string
  |-- contains --> success: boolean
  |-- optionally contains --> output: AggregatedHookResult
  |-- optionally contains --> error: { code?, message, details? }

AggregatedHookResult
  |-- produced by --> HookAggregator
  |-- consumed by --> processCommonHookOutputFields => ProcessedHookResult

ProcessedHookResult
  |-- contains --> aggregated: AggregatedHookResult
  |-- contains --> shouldStop: boolean
  |-- contains --> stopReason: string | undefined
  |-- contains --> systemMessage: string | undefined
  |-- contains --> suppressOutput: boolean
```

---

## 2. Event Taxonomy

### 2.1 Supported HookEventName values

| Event Name | Model-Payload Translation Required? | Validator Required? |
|------------|--------------------------------------|---------------------|
| BeforeTool | No | Yes |
| AfterTool | No | Yes |
| BeforeAgent | No | Yes |
| AfterAgent | No | Yes |
| SessionStart | No | No (uses enum parameter) |
| SessionEnd | No | No (uses enum parameter) |
| BeforeModel | Yes | Yes |
| AfterModel | Yes | Yes |
| BeforeToolSelection | Yes | Yes |
| Notification | No | Yes |

### 2.2 Event input shapes

```typescript
// BeforeTool
interface BeforeToolInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  // + base fields (session_id, cwd, hook_event_name, timestamp, transcript_path)
}

// AfterTool
interface AfterToolInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  // + base fields
}

// BeforeAgent
interface BeforeAgentInput {
  // event context fields
  // + base fields
}

// AfterAgent
interface AfterAgentInput {
  // event context fields
  // + base fields
}

// BeforeModel
interface BeforeModelInput {
  model_request: Record<string, unknown>;
  // + base fields
}

// AfterModel
interface AfterModelInput {
  model_request: Record<string, unknown>;
  model_response: Record<string, unknown>;
  // + base fields
}

// BeforeToolSelection
interface BeforeToolSelectionInput {
  model_request: Record<string, unknown>;
  available_tools: unknown[];
  // + base fields
}

// Notification
interface NotificationInput {
  message: string;
  level?: string;
  // + base fields
}
```

---

## 3. State Transitions

### 3.1 HookEventHandler lifecycle states

```
UNINITIALIZED
    |
    v (constructor called with optional MessageBus)
ACTIVE
    |-- subscribes to HOOK_EXECUTION_REQUEST if MessageBus present
    |-- handles direct fire*Event() calls
    |-- handles mediated HOOK_EXECUTION_REQUEST messages
    |
    v (dispose() called)
DISPOSED
    |-- unsubscribed from MessageBus
    |-- no longer handles new HOOK_EXECUTION_REQUEST messages
    |-- existing in-flight direct calls complete normally
```

### 3.2 Execution state machine (per request)

```
REQUEST_RECEIVED
    |
    v [mediated only] validate request envelope
    |-- invalid envelope --> PUBLISH FAILURE RESPONSE (stop)
    |
    v route by eventName
    |-- unsupported event --> PUBLISH FAILURE RESPONSE (stop)
    |
    v [mediated only] validate event-specific payload
    |-- validation failure --> PUBLISH FAILURE RESPONSE (stop)
    |
    v [model events only] translate model payload
    |-- translation failure --> RETURN/PUBLISH FAILURE RESPONSE (stop)
    |
    v check no-hooks-match
    |-- no hooks matched --> RETURN makeEmptySuccessResult() (stop, success)
    |
    v HookPlanner resolves hooks
    |-- planning failure --> RETURN buildFailureEnvelope() (stop, failure)
    |
    v HookRunner executes hooks (sequential or parallel)
    |-- runner failure --> RETURN buildFailureEnvelope() (stop, failure)
    |
    v HookAggregator merges results
    |-- aggregation failure --> RETURN buildFailureEnvelope() (stop, failure)
    |
    v processCommonHookOutputFields => ProcessedHookResult
    |
    v emit per-hook log records (DebugLogger)
    |
    v emit batch summary (DebugLogger)
    |
    v [mediated] publish HOOK_EXECUTION_RESPONSE
    |
    COMPLETE (return ProcessedHookResult to direct callers)
```

---

## 4. Business Rules

### 4.1 Failure envelope rules
- **Rule F1**: Every `catch` block MUST call `buildFailureEnvelope(error, stage, meta)` — never return `EMPTY_SUCCESS_RESULT` from a catch block.
- **Rule F2**: `EMPTY_SUCCESS_RESULT` constant must never be returned by reference. Use `makeEmptySuccessResult()` factory for no-match short-circuit paths.
- **Rule F3**: No-match paths (zero hooks matched) are SUCCESS outcomes, not failures.
- **Rule F4**: Hook execution failures are non-fatal — they return explicit failure envelopes but do not crash the runtime.

### 4.2 Correlation rules
- **Rule C1**: `correlationId` from request is echoed exactly in response.
- **Rule C2**: If request omits `correlationId`, handler generates one via `crypto.randomUUID()`.
- **Rule C3**: Exactly one `HOOK_EXECUTION_RESPONSE` is published per `HOOK_EXECUTION_REQUEST`.

### 4.3 Validation rules
- **Rule V1**: Validation runs ONLY at mediated ingress (not on direct path).
- **Rule V2**: Validation failure PREVENTS planner/runner execution.
- **Rule V3**: Validators MUST be TypeScript type predicates (return `input is T`).
- **Rule V4**: Unknown/extra fields in input are tolerated (minimal validation).

### 4.4 Translation rules
- **Rule T1**: Model payload translation applies to BeforeModel, AfterModel, BeforeToolSelection.
- **Rule T2**: Translation applies to BOTH direct and mediated paths (Phase B, simultaneously).
- **Rule T3**: Translation failure is treated as a boundary failure, not a runner failure.

### 4.5 Type rules
- **Rule TY1**: Internal routing methods use `HookEventName` enum, not raw `string`.
- **Rule TY2**: `fireSessionStartEvent` accepts `{ source: SessionStartSource }`.
- **Rule TY3**: `fireSessionEndEvent` accepts `{ reason: SessionEndReason }`.
- **Rule TY4**: `cwd` is obtained from `config.getWorkingDir()`, not `config.getTargetDir()`.

### 4.6 Observability rules
- **Rule O1**: Per-hook log records emitted for every hook result (success or failure) via DebugLogger.
- **Rule O2**: Batch summary emitted once per fired event via DebugLogger.
- **Rule O3**: Failure diagnostics emitted per failure when any hooks fail.
- **Rule O4**: NO OpenTelemetry or OTLP dependencies introduced.

### 4.7 Lifecycle rules
- **Rule L1**: `dispose()` on HookEventHandler unsubscribes from MessageBus.
- **Rule L2**: HookSystem teardown MUST call `eventHandler.dispose()`.
- **Rule L3**: MessageBus absence does not prevent direct-path operation.

---

## 5. Edge Cases

### 5.1 No hooks matched
- Valid event, validated payload, but planner returns empty hook set
- MUST return `makeEmptySuccessResult()` — deterministic success no-op
- MUST NOT return `buildFailureEnvelope()`
- Logging: batch summary with hookCount=0

### 5.2 Partial batch failure
- Some hooks succeed, some fail within a batch
- Aggregator still produces result
- Per-failure log records emitted
- Batch summary reflects both success and failure counts
- Aggregate result reflects failures but call does not throw

### 5.3 MessageBus absent
- Direct-path (`fire*Event`) calls continue unaffected
- No subscription, no subscription cleanup needed in `dispose()`
- `dispose()` is a no-op

### 5.4 Unsupported eventName in mediated request
- Produces structured `{ code: 'unsupported_event', ... }` failure response
- Published via MessageBus (not thrown)
- `correlationId` preserved in failure response

### 5.5 Missing correlationId in mediated request
- Handler generates `crypto.randomUUID()` as fallback
- Generated ID echoed in response
- Not treated as a validation failure

### 5.6 Translation failure for model events
- `buildFailureEnvelope` called with stage `'translation'`
- Direct path: failure envelope returned to caller
- Mediated path: failure response published with `correlationId`

### 5.7 Config missing `getWorkingDir()`
- MUST audit before Phase A
- If absent, add method or alias before implementing `buildBaseInput`
- Do NOT silently fall back to `getTargetDir()`

---

## 6. Error Scenarios

| Error Type | Stage | Direct Path Response | Mediated Path Response |
|------------|-------|----------------------|------------------------|
| Invalid request envelope | Pre-routing (mediated only) | N/A | Failed response published |
| Unsupported eventName | Routing | buildFailureEnvelope returned | Failed response published |
| Validation failure | Pre-planning | buildFailureEnvelope returned | Failed response published |
| Translation failure | Pre-planning | buildFailureEnvelope returned | Failed response published |
| Planning failure | Planning | buildFailureEnvelope returned | Failed response published |
| Runner failure | Execution | buildFailureEnvelope returned | Failed response published |
| Aggregation failure | Post-execution | buildFailureEnvelope returned | Failed response published |
| Internal exception | Any stage | buildFailureEnvelope returned | Failed response published |

**In ALL cases**: Never throw across public hook execution boundaries.

---

## 7. Integration Analysis

### 7.1 Existing callers that will be affected (backward-compatible changes)

| File | Current Usage | Post-Refactor |
|------|--------------|---------------|
| `packages/core/src/core/coreToolHookTriggers.ts` | Calls `fire*Event` directly | Continues working; receives `ProcessedHookResult` |
| `packages/core/src/hooks/hooks-caller-application.test.ts` | Integration tests for hook application | Must remain passing |
| `packages/core/src/hooks/hooks-caller-integration.test.ts` | Integration tests | Must remain passing |

### 7.2 New touchpoints

| File | Change Type | Reason |
|------|-------------|--------|
| `packages/core/src/hooks/hookSystem.ts` | MODIFY | Wire MessageBus/DebugLogger; add management APIs; call dispose() |
| `packages/core/src/hooks/hookEventHandler.ts` | MODIFY | Add mediated path, validation, translation, common-output, failure envelopes |
| `packages/core/src/hooks/hookBusContracts.ts` | CREATE | HookExecutionRequest/HookExecutionResponse interfaces |
| `packages/core/src/hooks/hookValidators.ts` | CREATE | Type-predicate validators per event type |
