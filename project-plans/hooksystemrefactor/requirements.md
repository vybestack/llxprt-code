# Hook System Upstream Robustness Parity - DELTA Requirements (EARS)

## Scope
These requirements describe only DELTA behavior needed to close robustness-parity gaps relative to upstream snapshot behavior. Existing behavior already implemented in current codebase is intentionally excluded.

## Evidence anchors
Primary evidence:
- Current: `packages/core/src/hooks/hookSystem.ts`, `packages/core/src/hooks/hookEventHandler.ts`
- Upstream: `tmp/gemini-cli-upstream/packages/core/src/hooks/hookSystem.ts`, `tmp/gemini-cli-upstream/packages/core/src/hooks/hookEventHandler.ts`

---

## A. HookSystem lifecycle and architecture deltas

### DELTA-HSYS-001 (Ubiquitous)
**The HookSystem SHALL inject MessageBus and DebugLogger dependencies into HookEventHandler during HookSystem composition, using concrete wiring points equivalent in capability to upstream HookSystem constructor wiring.**

**Note:** llxprt-code does NOT use OpenTelemetry or OTLP. All "telemetry" in this document refers to local structured logging via the existing `DebugLogger` infrastructure. There is no remote telemetry collection.

### DELTA-HSYS-002 (Ubiquitous)
**The HookSystem SHALL expose management methods for hook enablement and listing (functional parity with `setHookEnabled` and `getAllHooks`) so caller/admin surfaces can operate without bypassing HookSystem encapsulation.**

---

## B. HookEventHandler dual-path execution deltas

### DELTA-HEVT-001 (Ubiquitous)
**The HookEventHandler SHALL support a mediated execution path that subscribes to MessageBus hook-execution requests and routes them to corresponding fire-event handlers.**

### DELTA-HEVT-002 (Event-driven)
**When a `HOOK_EXECUTION_REQUEST` message is received, the HookEventHandler SHALL publish a `HOOK_EXECUTION_RESPONSE` message carrying the same correlation ID and explicit success/failure status.**

### DELTA-HEVT-003 (Event-driven)
**When a mediated request references an unsupported hook event name, the HookEventHandler SHALL publish a failed response with structured error detail rather than throwing to caller context.**

### DELTA-HEVT-004 (Ubiquitous)
**The HookEventHandler SHALL expose a `dispose()` method that unsubscribes from the MessageBus `HOOK_EXECUTION_REQUEST` channel. When MessageBus is not injected, `dispose()` SHALL be a no-op. HookSystem's teardown path SHALL call `eventHandler.dispose()` to prevent ghost subscriptions.**

---

## C. Planner/runner/aggregator post-processing deltas

### DELTA-HRUN-001 (Ubiquitous)
**The HookEventHandler SHALL apply a centralized post-aggregation processing stage for common hook output semantics before returning execution results to callers.**

### DELTA-HRUN-002 (Conditional)
**If aggregated hook output contains execution-stop intent fields, then the HookEventHandler SHALL normalize and surface a canonical stop reason for integration points to consume.**

### DELTA-HRUN-003 (Conditional)
**If aggregated hook output contains system-message and output-suppression fields, then the HookEventHandler SHALL apply consistent display/logging semantics from one centralized location.**

### DELTA-HRUN-004 (Ubiquitous)
**The `processCommonHookOutputFields` function SHALL return an explicit `ProcessedHookResult` interface containing: the base aggregated result, a `shouldStop: boolean`, a `stopReason: string | undefined`, a `systemMessage: string | undefined`, and a `suppressOutput: boolean`. Callers SHALL consume this typed interface rather than re-implementing ad hoc parsing of stop or message semantics.**

---

## D. Payload translation and validation deltas

### DELTA-HPAY-001 (Ubiquitous)
**The HookEventHandler SHALL perform explicit runtime validation of event-specific input payloads at mediated boundaries for BeforeTool, AfterTool, BeforeAgent, AfterAgent, BeforeModel, AfterModel, BeforeToolSelection, and Notification events.**

### DELTA-HPAY-002 (Conditional)
**If mediated payload validation fails, then the HookEventHandler SHALL return/publish a structured failure result and SHALL NOT execute planner/runner for that request.**

### DELTA-HPAY-003 (Ubiquitous)
**The HookEventHandler SHALL translate model request/response payloads through hook translator functions before hook execution for BeforeModel, AfterModel, and BeforeToolSelection paths. This translation SHALL be wired for both the mediated path AND the direct path in Phase B so both paths achieve translation parity simultaneously. Deferring direct-path translation to Phase C is non-conforming.**

### DELTA-HPAY-004 (Conditional)
**If payload translation fails, then the HookEventHandler SHALL return/publish a structured failure response containing error details and correlation context when available.**

### DELTA-HPAY-005 (Ubiquitous)
**Each event-specific input validator SHALL be implemented as a TypeScript type predicate (e.g., `function validateBeforeToolInput(input: unknown): input is BeforeToolInput`) so that the TypeScript compiler narrows the type after the validation check. Validators that return plain `boolean` without a type predicate are non-conforming.**

### DELTA-HPAY-006 (Ubiquitous)
**The `fireSessionStartEvent` method SHALL accept `context: { source: SessionStartSource }` (using the `SessionStartSource` enum from `types.ts`) rather than `{ source: string }`. The `fireSessionEndEvent` method SHALL accept `context: { reason: SessionEndReason }` (using the `SessionEndReason` enum from `types.ts`) rather than `{ reason: string }`. These type mismatches against the declared `SessionStartInput` and `SessionEndInput` interfaces SHALL be corrected.**

---

## E. MessageBus integration semantics deltas

### DELTA-HBUS-001 (Ubiquitous)
**The hook subsystem SHALL define and honor a stable mediated contract for hook execution requests/responses.**

**Step 1 — MessageBusType enum extension:** The two hook message types SHALL be added as named values to the `MessageBusType` enum in `packages/core/src/confirmation-bus/types.ts`:

```typescript
// Add to MessageBusType enum:
HOOK_EXECUTION_REQUEST = 'hook-execution-request',
HOOK_EXECUTION_RESPONSE = 'hook-execution-response',
```

**Step 2 — Interface declarations:** The following TypeScript interfaces SHALL be declared (in `hookBusContracts.ts` or alongside the enum) and used exclusively for bus communication. Each interface carries a discriminated `type` field using the corresponding `MessageBusType` enum value:

```typescript
interface HookExecutionRequest {
  type: MessageBusType.HOOK_EXECUTION_REQUEST;
  eventName: HookEventName;
  input: Record<string, unknown>;
  correlationId: string;
}

interface HookExecutionResponse {
  type: MessageBusType.HOOK_EXECUTION_RESPONSE;
  correlationId: string;
  success: boolean;
  output?: AggregatedHookResult;
  error?: {
    code?: string;
    message: string;
    details?: unknown;
  };
}
```

**Step 3 — Union type extension:** Both interfaces SHALL be added to the `MessageBusMessage` union type in `packages/core/src/confirmation-bus/types.ts` so the MessageBus type system recognizes them as valid message shapes.

**The `eventName` field SHALL use the `HookEventName` enum type, not a raw `string`.**

### DELTA-HBUS-002 (Conditional)
**If MessageBus is unavailable in runtime configuration, then hook execution SHALL continue to function via direct fire-event methods without behavior regression relative to current direct-path semantics.**

### DELTA-HBUS-003 (Conditional)
**If a received `HOOK_EXECUTION_REQUEST` message does not include a `correlationId`, the HookEventHandler SHALL generate one using `crypto.randomUUID()` (Node.js built-in) and echo the generated ID in the `HOOK_EXECUTION_RESPONSE`. Callers are expected to supply their own stable IDs; generation is a fallback only.**

---

## F. Local logging and observability deltas

**Important:** llxprt-code does NOT use OpenTelemetry, OTLP, or any remote telemetry collection. All observability in this section refers to local structured logging via the existing `DebugLogger` infrastructure. The term "telemetry" in upstream Gemini CLI documents maps to "local debug logging" in llxprt-code.

### DELTA-HTEL-001 (Ubiquitous)
**For each hook execution result produced by runner, the HookEventHandler SHALL emit per-hook log records (via DebugLogger) containing event name, hook identity/type, duration, success flag, and execution artifacts (exit code/stdout/stderr/error message when present).**

### DELTA-HTEL-002 (Ubiquitous)
**The HookEventHandler SHALL log batch-level execution summaries (via DebugLogger) that include hook count, success/failure counts, and total duration for each fired event.**

### DELTA-HTEL-003 (Conditional)
**If one or more hooks fail within a batch, then the HookEventHandler SHALL log explicit error diagnostics (via DebugLogger) for each failure while still returning the aggregated result envelope.**

---

## G. Caller-side application semantics deltas

### DELTA-HAPP-001 (Ubiquitous)
**The hook subsystem SHALL provide a single canonical interpretation point for common hook output fields so all caller-side integrations observe consistent behavior.**

### DELTA-HAPP-002 (Conditional)
**If hook output indicates execution should stop, then caller-facing hook results SHALL preserve stop intent and effective reason in a form consumable by trigger/integration layers without ad hoc parsing.**

---

## H. Failure semantics deltas

### DELTA-HFAIL-001 (Ubiquitous)
**The HookEventHandler SHALL standardize failure envelopes so unexpected internal errors produce explicit `success=false` aggregated results rather than silently converting all failures to empty-success outcomes. An internal `buildFailureEnvelope(error: unknown, stage: string, meta?: FailureMeta): AggregatedHookResult` helper SHALL be used in all catch blocks; returning `EMPTY_SUCCESS_RESULT` from a catch block is non-conforming.**

### DELTA-HFAIL-002 (Event-driven)
**When mediated execution fails at any stage (validation, translation, planning, execution, aggregation, or response formatting), the HookEventHandler SHALL publish a failure response and SHALL include error detail sufficient for caller diagnosis.**

### DELTA-HFAIL-003 (Conditional)
**If no hooks match a valid event request, then the HookEventHandler SHALL return a success envelope with empty outputs/errors and zero or measured near-zero duration, preserving no-op determinism for callers.**

### DELTA-HFAIL-004 (Ubiquitous)
**The `EMPTY_SUCCESS_RESULT` constant SHALL NOT be returned by reference from any code path where the caller could mutate the object. All no-match short-circuit paths SHALL call the `makeEmptySuccessResult()` factory function, which returns a fresh object on every invocation. The factory SHALL be defined as:**

```typescript
function makeEmptySuccessResult(): AggregatedHookResult {
  return { ...EMPTY_SUCCESS_RESULT };
}
```

**Returning the raw constant directly (without spread or factory) is non-conforming. Catch-block paths are not permitted to use `EMPTY_SUCCESS_RESULT` or `makeEmptySuccessResult()` under any circumstances — catch blocks MUST use `buildFailureEnvelope` (see DELTA-HFAIL-001).**

### DELTA-HFAIL-005 (Ubiquitous)
**All internal routing, helper, and private methods in HookEventHandler that accept an event name SHALL use `HookEventName` (the enum from `types.ts`) as the parameter type rather than the primitive `string`. Public entry points that receive unvalidated string input SHALL narrow to `HookEventName` before passing to internal logic, and SHALL produce a structured failure result if the value is not a valid `HookEventName`.**

---

## Traceability map (delta requirement -> implementation focus)
- HookSystem composition: `packages/core/src/hooks/hookSystem.ts`
- HookEventHandler disposal: `packages/core/src/hooks/hookEventHandler.ts` (`dispose()` method)
- Event mediation + validation + translation + failure publication: `packages/core/src/hooks/hookEventHandler.ts`
- MessageBusType enum extension (`HOOK_EXECUTION_REQUEST`, `HOOK_EXECUTION_RESPONSE` values + `MessageBusMessage` union): `packages/core/src/confirmation-bus/types.ts`
- Bus contracts (interfaces with `type` discriminator fields): `packages/core/src/hooks/hookBusContracts.ts` (preferred) or `packages/core/src/hooks/hookEventHandler.ts`
- ProcessedHookResult interface: `packages/core/src/hooks/hookEventHandler.ts` or shared types file
- Planner/runner/aggregator integration point: `packages/core/src/hooks/hookEventHandler.ts` with collaborators in `hookPlanner.ts`, `hookRunner.ts`, `hookAggregator.ts`
- Translator integration: `packages/core/src/hooks/hookTranslator.ts` and HookEventHandler call sites
- Telemetry wiring: hook handler telemetry/logging call sites and telemetry modules under `packages/core/src/telemetry/*`
- Type predicate validators: `packages/core/src/hooks/hookEventHandler.ts` or closely scoped validation module
- SessionStart/SessionEnd enum types: `packages/core/src/hooks/types.ts` (already defined; fire method signatures must use them)
