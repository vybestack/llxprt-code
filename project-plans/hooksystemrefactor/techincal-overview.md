# Hook System Refactor - Technical Overview (Implementation-Ready)

## 1) Purpose and implementation target
This document is the implementation-ready technical specification for hook-system robustness parity, grounded in repository evidence:

- Current behavior: `project-plans/hooksystemrefactor/current-detail.md`
- Upstream reference behavior snapshot: `project-plans/hooksystemrefactor/geminicli-detail.md`
- Gap analysis: `project-plans/hooksystemrefactor/comparison.md`
- Required DELTA outcomes: `project-plans/hooksystemrefactor/requirements.md`

Primary objective: implement the minimum architecture and behavior changes required to satisfy all DELTA requirements without unnecessary scope expansion.

---

## 2) Architectural design

### 2.1 Components

1. HookSystem (`packages/core/src/hooks/hookSystem.ts`)
- Owns lifecycle and dependency composition.
- Injects optional MessageBus and DebugLogger dependencies into HookEventHandler.
- Exposes management facade methods equivalent in capability to upstream `setHookEnabled` and `getAllHooks` (DELTA-HSYS-002).

2. HookEventHandler (`packages/core/src/hooks/hookEventHandler.ts`)
- Unified execution orchestrator for direct and mediated paths.
- Defines boundary methods:
  - direct fire methods (`fireBeforeToolEvent`, etc.)
  - mediated request handler (`handleHookExecutionRequest` equivalent)
- Encapsulates:
  - event-specific runtime validation
  - model payload translation (Phase B for both paths — see §5.2 and §9)
  - planner/runner/aggregator orchestration
  - centralized common-output post-processing
  - local debug logging and summary logging (via DebugLogger)
  - standardized failure envelope generation
- Exposes a `dispose()` method that unsubscribes from MessageBus (see §2.3).

3. Planner/Runner/Aggregator (existing)
- Keep current abstractions and call order.
- Extend only integration seams in HookEventHandler for post-processing and local logging.

4. Translator (`packages/core/src/hooks/hookTranslator.ts`)
- Use existing translator for model payload normalization at execution boundary.

5. MessageBus integration points
- Subscribe to `HOOK_EXECUTION_REQUEST` when MessageBus exists.
- Publish `HOOK_EXECUTION_RESPONSE` with correlation and explicit success/failure.

### 2.2 HookEventName usage
All internal routing methods and helper signatures that accept an event name SHALL use the `HookEventName` enum type (from `packages/core/src/hooks/types.ts`) rather than the primitive `string` type. The raw `string` type is acceptable only at public external API entry points where callers may not yet have enum values, and must be narrowed to `HookEventName` before passing to internal logic.

### 2.3 HookEventHandler disposal
HookEventHandler MUST expose a `dispose()` method. When MessageBus is injected, `dispose()` SHALL unsubscribe the handler from `HOOK_EXECUTION_REQUEST` to prevent memory leaks and ghost subscriptions after the handler is decommissioned. If no MessageBus was injected, `dispose()` is a no-op. HookSystem's own teardown path (if present) MUST call `eventHandler.dispose()`.

---

## 3) Data contracts

### 3.1 Base execution context contract
For every event execution request (direct or mediated), merge/create base fields:
- `session_id: string`
- `cwd: string`
- `hook_event_name: string`
- `timestamp: string` (ISO)
- `transcript_path: string` (placeholder allowed until separately implemented)

**`cwd` source decision:** Use `config.getWorkingDir()` (upstream semantics), not `config.getTargetDir()`. This resolves the current divergence documented in the comparison evidence. If `getWorkingDir()` does not exist on the Config interface, add it (or alias it) before implementing; do not silently fall back to `getTargetDir()` without an explicit tracked decision.

### 3.2 MessageBusType enum extension
Before declaring the hook bus interfaces, two new values MUST be added to the `MessageBusType` enum in `packages/core/src/confirmation-bus/types.ts`:

```typescript
// In MessageBusType enum — add:
HOOK_EXECUTION_REQUEST = 'hook-execution-request',
HOOK_EXECUTION_RESPONSE = 'hook-execution-response',
```

Both values must also be registered in the `MessageBusMessage` union type in the same file so the MessageBus type system accepts them as valid message shapes.

### 3.3 Mediated request contract
Full TypeScript interface (to be declared in `hookBusContracts.ts` or alongside the `MessageBusType` extension). The `type` field carries the discriminant used by the MessageBus dispatch logic:

```typescript
interface HookExecutionRequest {
  /** MessageBus discriminator */
  type: MessageBusType.HOOK_EXECUTION_REQUEST;
  /** Discriminated event name — must be a value of HookEventName enum */
  eventName: HookEventName;
  /** Event-specific input object (validated before routing) */
  input: Record<string, unknown>;
  /** Caller-supplied opaque correlation token echoed in response */
  correlationId: string;
}
```

Invalid/missing required fields produce structured failure response and no execution.

**Correlation ID generation:** When the mediated caller does not supply a `correlationId`, the handler itself MUST generate one using `crypto.randomUUID()` (Node.js built-in, no external dependency). Generated IDs are used only as fallback; callers are expected to supply their own stable IDs.

### 3.4 Mediated response contract
Full TypeScript interface (to be declared alongside the request type). The `type` field discriminates response messages from request messages on the same bus:

```typescript
interface HookExecutionResponse {
  /** MessageBus discriminator */
  type: MessageBusType.HOOK_EXECUTION_RESPONSE;
  /** Echoed from the originating request */
  correlationId: string;
  /** True only when all execution stages completed without error */
  success: boolean;
  /** Present on success; AggregatedHookResult-compatible payload */
  output?: AggregatedHookResult;
  /** Present on failure; structured error detail */
  error?: {
    code?: string;
    message: string;
    details?: unknown;
  };
}
```

Exactly one response per request.

### 3.5 Standardized internal failure envelope
Internal helper `buildFailureEnvelope(error: unknown, stage: string, meta?: FailureMeta): AggregatedHookResult` normalizes all failures into one shape:

```typescript
interface FailureMeta {
  eventName?: HookEventName;
  correlationId?: string;
}
```

Envelope shape:
- `success: false`
- `allOutputs: []`
- `errors: [normalizedError]`
- `totalDuration` (measured or 0)
- optional metadata (`stage`, `eventName`, `correlationId` for mediated path)

**Critical:** All `fire*Event` catch blocks MUST call `buildFailureEnvelope(error, stage)` and return the resulting failure envelope. They MUST NOT return `EMPTY_SUCCESS_RESULT`, which would silently mask failures as successes. The `EMPTY_SUCCESS_RESULT` constant is reserved for the no-hooks-matched short-circuit path only (DELTA-HFAIL-003).

**Immutability of EMPTY_SUCCESS_RESULT:** `EMPTY_SUCCESS_RESULT` is a module-level constant. Because it is shared and returned by reference, callers that mutate the returned object would corrupt subsequent calls. All code paths that return a "no-op success" shape MUST call the `makeEmptySuccessResult()` factory function rather than referencing the constant directly. Define and use:

```typescript
/** Returns a fresh no-op success envelope — never return the shared constant directly. */
function makeEmptySuccessResult(): AggregatedHookResult {
  return { ...EMPTY_SUCCESS_RESULT };
}

// In executeEventWithFullResult, no-match short-circuit:
return makeEmptySuccessResult(); // always a fresh copy
```

This ensures callers cannot accidentally mutate the shared sentinel. All new no-match short-circuit paths MUST call `makeEmptySuccessResult()`. Spreading the constant inline (`{ ...EMPTY_SUCCESS_RESULT }`) is also acceptable in existing code, but the factory function is the canonical, searchable call site.

### 3.6 ProcessedHookResult interface
`processCommonHookOutputFields` SHALL have an explicit return type rather than returning the raw `AggregatedHookResult`. Define:

```typescript
interface ProcessedHookResult {
  /** Base aggregated result (pass-through fields) */
  aggregated: AggregatedHookResult;
  /** True if any hook output signaled shouldStopExecution() */
  shouldStop: boolean;
  /** Effective stop reason when shouldStop is true; undefined otherwise */
  stopReason: string | undefined;
  /** System message text to display (after suppressOutput check) */
  systemMessage: string | undefined;
  /** True if output display should be suppressed */
  suppressOutput: boolean;
}
```

Callers receive `ProcessedHookResult` and MUST NOT re-implement stop/system-message parsing locally.

---

## 4) Execution paths

### 4.1 Direct execution path
1. Public `fire*Event` builds event-specific payload with strongly-typed parameters (see §4.4).
2. Apply translation for model events before execution (Phase B — both mediated and direct paths; see §5.2 and DELTA-HPAY-003).
3. Execute through shared `executeHooks` core routine.
4. Core routine:
   - create execution plan
   - execute sequential/parallel via runner
   - aggregate
   - post-process common output fields via `processCommonHookOutputFields`
   - emit telemetry/log summaries
   - return success/failure envelope

No-match short-circuit returns `makeEmptySuccessResult()` (never the mutable singleton reference).

### 4.2 Mediated execution path
1. HookEventHandler subscribes to `HOOK_EXECUTION_REQUEST` at construction/initialization time (only when MessageBus exists).
2. For each request:
   - validate request envelope
   - route by supported event name (HookEventName enum switch)
   - run event-specific input validation
   - translate model payloads when needed
   - invoke shared execution routine
   - publish `HOOK_EXECUTION_RESPONSE` with matching correlation ID
3. Errors at any stage produce failed response with structured error and no throw beyond boundary.

### 4.3 Routing matrix (event names)
Implement an explicit routing table/switch typed on `HookEventName` for:
- BeforeTool
- AfterTool
- BeforeAgent
- AfterAgent
- SessionStart
- SessionEnd
- BeforeModel
- AfterModel
- BeforeToolSelection
- Notification

Unsupported event names (values not in the enum) map to structured failure (`unsupported_event`).

### 4.4 Fire method signature types
The fire methods MUST use the domain-typed enums from `types.ts` rather than raw `string` for discriminated parameters:

```typescript
// Correct — use enum values, not bare strings:
async fireSessionStartEvent(context: { source: SessionStartSource }): Promise<AggregatedHookResult>
async fireSessionEndEvent(context: { reason: SessionEndReason }): Promise<AggregatedHookResult>
```

The current signatures `{ source: string }` and `{ reason: string }` are type mismatches against `SessionStartInput.source: SessionStartSource` and `SessionEndInput.reason: SessionEndReason` defined in `types.ts`. These MUST be corrected before Phase A lands.

---

## 5) Validation and translation boundaries

### 5.1 Validation boundary specification
Add runtime validation helpers in HookEventHandler (or closely scoped validation module) for:
- BeforeTool input
- AfterTool input
- BeforeAgent input
- AfterAgent input
- BeforeModel input
- AfterModel input
- BeforeToolSelection input
- Notification input

Validation rules are behavioral and minimal:
- required object shape exists
- required key fields exist and have acceptable primitive/object types
- unknown fields tolerated unless actively unsafe

**Type predicate requirement:** Each validator MUST be implemented as a TypeScript type predicate so the type system narrows the input type after validation:

```typescript
function validateBeforeToolInput(input: unknown): input is BeforeToolInput {
  return (
    isObject(input) &&
    typeof (input as BeforeToolInput).tool_name === 'string' &&
    isObject((input as BeforeToolInput).tool_input)
  );
}
```

Validators that return plain `boolean` (without `is T`) prevent the narrowing benefit and force downstream casts, which defeats their purpose.

Behavior on failure:
- direct path returns explicit failure envelope (via `buildFailureEnvelope`)
- mediated path publishes explicit failure response
- planner/runner not invoked

### 5.2 Translation boundary specification
Before execution for model-oriented events:
- BeforeModel: translate model request payload to hook-LLM request
- AfterModel: translate model request + response payloads
- BeforeToolSelection: translate relevant request payload

Translation errors are treated as boundary failures (not runner failures) and reported accordingly.

**Phase placement:** Model payload translation for **both the direct path and the mediated path** is a Phase B concern (DELTA-HPAY-003). Wiring both in the same phase ensures parity is established together and avoids a transient state where one path has translation active and the other does not. Phase C retains event-specific runtime validation (DELTA-HPAY-001/002/005) but does NOT defer translation.

---

## 6) Common-output post-processing

### 6.1 Central processing stage
After aggregation, call a single `processCommonHookOutputFields`-equivalent routine that returns `ProcessedHookResult` (§3.6).

Responsibilities:
- derive stop intent from canonical output semantics (`shouldStopExecution()`)
- compute effective stop reason (`getEffectiveReason()`)
- process `systemMessage` with `suppressOutput`
- normalize fields for caller consumption

### 6.2 Contract with callers
Callers receive `ProcessedHookResult` and should not need ad hoc parsing logic for stop/system-message semantics.

---

## 7) Local logging and observability design

**Important:** llxprt-code does NOT use OpenTelemetry, OTLP, or any remote telemetry collection. All observability uses the existing local `DebugLogger` infrastructure. References to "telemetry" in upstream Gemini CLI documents map to "local debug logging" in llxprt-code.

### 7.1 Per-hook log emission
For each runner result emit a structured log record (via DebugLogger) containing:
- eventName
- hookName/hookType
- duration
- success
- exitCode
- stdout/stderr
- errorMessage when present

Use the existing `DebugLogger` class in the hooks module. Do NOT introduce OpenTelemetry or OTLP dependencies.

### 7.2 Batch summary logging
Emit one summary per execution batch:
- event name
- hook count
- success/failure counts
- total duration

### 7.3 Failure diagnostics
If any hook fails, log normalized diagnostics per failure while preserving aggregate return path.

---

## 8) Failure handling model

Failure stages:
1. request envelope validation (mediated only)
2. event payload validation
3. translation
4. planning
5. runner execution
6. aggregation
7. response publication formatting (mediated)

Handling rules:
- never throw across public hook execution boundaries
- always return/publish structured failure (via `buildFailureEnvelope` — never fall back to `EMPTY_SUCCESS_RESULT` in catch blocks)
- preserve non-fatal runtime guarantees
  - retain deterministic success-no-op for valid events with no matched hooks (via `makeEmptySuccessResult()` factory)

---

## 9) Migration phases (implementation plan)

Phase A - HookSystem composition parity
- Wire MessageBus and DebugLogger dependencies into HookEventHandler.
- Add HookSystem management APIs (`setHookEnabled`, `getAllHooks` equivalents).
- Add `dispose()` to HookEventHandler with MessageBus unsubscription.
- Fix `fireSessionStartEvent`/`fireSessionEndEvent` parameter types to use `SessionStartSource`/`SessionEndReason`.
- Change `eventName: string` parameters in internal routing methods to `HookEventName`.
- Fix `EMPTY_SUCCESS_RESULT` usage: return fresh copies in no-match paths; use `buildFailureEnvelope` in catch blocks.

Phase B - Mediated boundary implementation + translation parity
- Extend `MessageBusType` enum with `HOOK_EXECUTION_REQUEST` and `HOOK_EXECUTION_RESPONSE` values (§3.2).
- Add `HookExecutionRequest` and `HookExecutionResponse` interfaces with `type` discriminator fields (§3.3–§3.4); register both in `MessageBusMessage` union.
- Add bus subscription/publish logic.
- Implement request envelope validation + event routing (typed on `HookEventName`) + correlation-preserving responses.
- Wire model payload translation for **both** mediated and direct paths (DELTA-HPAY-003 — both paths land together in Phase B).

Phase C - Boundary hardening
- Add event-specific runtime validators with type predicates (DELTA-HPAY-001/002/005).
- (Translation already active from Phase B — no translation work remains in Phase C.)

Phase D - Semantics and observability
- Implement `processCommonHookOutputFields` returning `ProcessedHookResult`.
- Add per-hook log emission and batch summary logging (via DebugLogger — no OpenTelemetry/OTLP).
- Standardize explicit failure envelopes everywhere using `buildFailureEnvelope`.

Phase E - Cleanup and compatibility
- Ensure direct-path call sites preserve existing behavior except DELTA-required improvements.
- Ensure MessageBus absence preserves direct operation (DELTA-HBUS-002).
- Verify all tests pass and DELTA requirement traceability is complete.

---

## 10) Verification and test strategy (implementation-ready)

All verification should be behavior-focused and mapped to DELTA requirements.

### 10.1 Direct-path tests
- No hooks matched => fresh success-no-op envelope returned (not the shared singleton).
- Model events invoke translation before runner execution (Phase B and after — both direct and mediated paths).
- Aggregated output receives centralized common-field processing via `ProcessedHookResult`.
- Internal execution exceptions surface as explicit failure envelopes (not EMPTY_SUCCESS_RESULT).
- `fireSessionStartEvent` accepts only `SessionStartSource` values; `fireSessionEndEvent` accepts only `SessionEndReason` values.

### 10.2 Mediated-path tests
- Valid request => exactly one correlated success response.
- Unsupported eventName => correlated failed response.
- Invalid payload => correlated failed response and no planner/runner execution.
- Translation failure => correlated failed response with error details.
- Missing `correlationId` in request => handler generates one via `crypto.randomUUID()` and echoes it in response.

### 10.3 Observability tests (local logging)
- Per-hook log record emitted once per hook result (via DebugLogger).
- Batch summary contains hook counts/success/failure/duration.
- Failure diagnostics emitted when any hook fails.

### 10.4 Compatibility tests
- MessageBus unavailable => direct `fire*Event` behavior remains functional.
- Existing direct callers remain operational with normalized result semantics.
- `dispose()` called after MessageBus injection => subsequent `HOOK_EXECUTION_REQUEST` messages are not handled.

### 10.5 Requirement traceability checks
Maintain a test-to-requirement map covering:
- DELTA-HSYS-001/002
- DELTA-HEVT-001/002/003/004
- DELTA-HRUN-001/002/003/004
- DELTA-HPAY-001/002/003/004/005/006
- DELTA-HBUS-001/002/003
- DELTA-HTEL-001/002/003
- DELTA-HAPP-001/002
- DELTA-HFAIL-001/002/003/004/005

---

## 11) Risks and mitigations

1. Risk: Behavior drift between direct and mediated paths
- Mitigation: enforce shared core execution routine and parity tests with equivalent inputs; model translation lands in Phase B for both paths simultaneously (DELTA-HPAY-003).

2. Risk: Over-strict validation blocks existing callers
- Mitigation: minimal required-field validation; tolerate non-breaking extra fields; validators use type predicates so narrowing is compositional.

3. Risk: Logging overhead in hot paths
- Mitigation: lightweight record construction; use existing DebugLogger infrastructure (no OpenTelemetry/OTLP).

4. Risk: Legacy call sites depend on silent-empty-success behavior
- Mitigation: scope explicit failure envelopes to DELTA-required boundaries and validate against existing tests; `EMPTY_SUCCESS_RESULT` shape is preserved for no-match paths.

5. Risk: `EMPTY_SUCCESS_RESULT` mutation by callers
- Mitigation: call `makeEmptySuccessResult()` on all no-match paths; consider `Object.freeze(EMPTY_SUCCESS_RESULT)` at declaration to make accidental mutation throw in strict mode. The factory function is the canonical, grep-able call site for auditing compliance.

6. Risk: `getWorkingDir()` absent from Config interface
- Mitigation: audit Config before Phase A; add method or alias before implementing `buildBaseInput`.

7. Risk: `dispose()` not called, causing ghost MessageBus subscriptions
- Mitigation: enforce `dispose()` call in HookSystem teardown; add integration test that verifies no further messages are handled post-dispose.

8. Risk: `MessageBusType` enum extension breaks existing switch exhaustiveness checks
- Mitigation: search for `switch (message.type)` and `switch (type)` on `MessageBusMessage` before adding new enum values; update any exhaustive switches that would fail to compile once the hook values are added. The TypeScript compiler surfaces these as errors at build time.

---

## 12) Definition of done (technical)
Implementation is done when:
1. HookSystem wires optional MessageBus/DebugLogger and exposes required management methods.
2. HookEventHandler supports direct + mediated execution with correlated request/response handling.
3. `MessageBusType` enum extended with `HOOK_EXECUTION_REQUEST` and `HOOK_EXECUTION_RESPONSE` values; both registered in the `MessageBusMessage` union type.
4. `HookExecutionRequest` and `HookExecutionResponse` interfaces are fully declared with `type` discriminator fields and used exclusively for bus communication.
5. `dispose()` on HookEventHandler unsubscribes from MessageBus.
6. Event-specific validation (type predicates) and model translation boundaries are active.
7. Central common-output processing returns `ProcessedHookResult`; callers use it without ad hoc parsing.
8. Per-hook log records and batch summaries are emitted (via DebugLogger — no OpenTelemetry/OTLP).
9. Explicit structured failure envelopes (`buildFailureEnvelope`) are used in all catch blocks; `makeEmptySuccessResult()` is used (never the raw constant) for all no-match short-circuit paths.
10. `fireSessionStartEvent` and `fireSessionEndEvent` use `SessionStartSource` / `SessionEndReason` enum types.
11. Internal routing methods use `HookEventName` not `string`.
12. `cwd` uses `config.getWorkingDir()` (not `getTargetDir()`).
13. Verification evidence demonstrates DELTA requirement coverage end-to-end.
