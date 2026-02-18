# Gemini CLI Upstream Hook System Detail (Evidence Snapshot)

**Important Note:** This document describes the **upstream Gemini CLI** implementation which uses OpenTelemetry for telemetry. **llxprt-code does NOT use OpenTelemetry or OTLP.** When adapting these patterns, replace OpenTelemetry logger references with the existing `DebugLogger` infrastructure. All telemetry in llxprt-code is local-only.

## Scope and evidence base
This document describes hook-system behavior in the upstream snapshot at:
- `tmp/gemini-cli-upstream/packages/core/src/hooks/hookSystem.ts`
- `tmp/gemini-cli-upstream/packages/core/src/hooks/hookEventHandler.ts`

and its direct collaborators inferred from these files:
- `tmp/gemini-cli-upstream/packages/core/src/hooks/hookPlanner.ts`
- `tmp/gemini-cli-upstream/packages/core/src/hooks/hookRunner.ts`
- `tmp/gemini-cli-upstream/packages/core/src/hooks/hookAggregator.ts`
- `tmp/gemini-cli-upstream/packages/core/src/hooks/hookTranslator.ts`
- `tmp/gemini-cli-upstream/packages/core/src/confirmation-bus/*`
- `tmp/gemini-cli-upstream/packages/core/src/telemetry/*`

## 1) HookSystem lifecycle (upstream)
Primary coordinator: `HookSystem` class in `hookSystem.ts`.

### Construction phase
`constructor(config: Config)` eagerly creates:
- `HookRegistry`
- `HookRunner`
- `HookAggregator`
- `HookPlanner`
- `HookEventHandler`

Notable constructor details:
- Obtains OpenTelemetry logger via `logs.getLogger(SERVICE_NAME)`.
- Obtains MessageBus with `config.getMessageBus()`.
- Injects `messageBus` into `HookEventHandler` explicitly to enable mediated request/response execution path.

### Initialization phase
`initialize()`:
- idempotent via `initialized` boolean guard.
- calls `await hookRegistry.initialize()` exactly once.
- marks `initialized=true` and debug logs success.

### Accessors / management API
- `getEventHandler()` throws if not initialized (`Error('Hook system not initialized')`).
- `getRegistry()` returns registry (no init guard at method level).
- `setHookEnabled(name, enabled)` delegates to registry.
- `getAllHooks()` delegates to registry.
- `getStatus()` returns `{ initialized, totalHooks }` where total uses registry when initialized.

## 2) HookEventHandler architecture (upstream)
Primary class: `HookEventHandler` in `hookEventHandler.ts`.

### Dependency graph
Injected dependencies:
- `config: Config`
- `logger: Logger` (OpenTelemetry API logs type)
- `hookPlanner: HookPlanner`
- `hookRunner: HookRunner`
- `hookAggregator: HookAggregator`
- optional `messageBus?: MessageBus`

### Dual execution architecture
Upstream supports two paths:
1. **Direct call path**: `fire*Event(...)` methods construct typed input and call `executeHooks(...)`.
2. **Mediated MessageBus path**: constructor subscribes to `MessageBusType.HOOK_EXECUTION_REQUEST` and routes via `handleHookExecutionRequest(request)`, then publishes `HOOK_EXECUTION_RESPONSE` with correlation ID.

This creates a decoupled boundary between hook callers and executor internals.

### Exposed event APIs
Event methods present:
- `fireBeforeToolEvent`
- `fireAfterToolEvent`
- `fireBeforeAgentEvent`
- `fireAfterAgentEvent`
- `fireSessionStartEvent`
- `fireSessionEndEvent`
- `firePreCompressEvent`
- `fireBeforeModelEvent`
- `fireAfterModelEvent`
- `fireBeforeToolSelectionEvent`
- `fireNotificationEvent`

Each method builds a typed event input (`BeforeToolInput`, `AfterModelInput`, etc.) on top of shared base fields.

## 3) Planner/runner/aggregator behavior (upstream integration semantics)
Within `executeHooks(eventName, input, context?)`:
1. Calls `hookPlanner.createExecutionPlan(eventName, context)`.
2. If no plan or empty hooks, returns success object with empty outputs/errors and zero duration.
3. Selects execution mode:
   - `executeHooksSequential(...)` when `plan.sequential`
   - `executeHooksParallel(...)` otherwise
4. Aggregates using `hookAggregator.aggregateResults(results, eventName)`.
5. Post-processing:
   - `processCommonHookOutputFields(aggregated)`
   - `logHookExecution(eventName, input, results, aggregated)`

### Aggregated result handling
`AggregatedHookResult` is treated as canonical output surface with:
- success boolean
- allOutputs
- errors
- totalDuration
- optional finalOutput

On unexpected handler errors, upstream returns failure object (`success:false`) with captured error; it does not throw from `executeHooks`.

## 4) Payload translation and validation (upstream)
Upstream includes explicit validation helpers in `hookEventHandler.ts`:
- `validateBeforeToolInput`
- `validateAfterToolInput`
- `validateBeforeAgentInput`
- `validateAfterAgentInput`
- `validateModelInput`
- `validateAfterModelInput`
- `validateNotificationInput`
- shared guard: `isObject`

### Translation responsibilities
`defaultHookTranslator` is used for model payload conversion:
- `toHookLLMRequest(...)`
- `toHookLLMResponse(...)`

Translation occurs in two places:
- direct event methods for model events (`fireBeforeModelEvent`, etc.)
- bus-driven routing path (`handleHookExecutionRequest`) before downstream execution/publishing context.

### Base payload fields
`createBaseInput(eventName)` populates:
- `session_id` from `config.getSessionId()`
- `cwd` from `config.getWorkingDir()`
- `timestamp` ISO string
- `hook_event_name`
- `transcript_path` currently TODO placeholder

## 5) MessageBus integration (upstream)
In `HookSystem`, message bus is acquired and injected.
In `HookEventHandler`:
- subscribes to `HOOK_EXECUTION_REQUEST`
- request shape includes `eventName`, `input`, `correlationId`
- routes by event enum switch
- publishes `HOOK_EXECUTION_RESPONSE` including `correlationId`
- response includes `success`, optional `output`, optional `error`

This makes hook execution invokable asynchronously by other subsystems without tight coupling.

## 6) Telemetry and logging (upstream)
Two layers exist:
1. **Debug logging** (`debugLogger`) for summary and error channels.
2. **Telemetry event emission** per hook execution result:
   - constructs `HookCallEvent`
   - emits via `logHookCall(config, hookCallEvent)`

Telemetry payload includes event name, hook type/name, input snapshot, duration, success, output, exit code, stdout/stderr, and error message.

## 7) Caller-side application semantics (upstream)
`processCommonHookOutputFields(aggregated)` centralizes interpretation of common output fields:
- `systemMessage`: logged when present and not suppressed.
- `suppressOutput`: respected during message emission behavior.
- stop/continue semantics:
  - evaluates `aggregated.finalOutput.shouldStopExecution()`
  - derives reason via `getEffectiveReason()`
  - logs stop request for caller integration points.

Important nuance: upstream logs/normalizes common semantics centrally, but explicit workflow termination is left to event integration points outside this class.

## 8) Failure semantics (upstream)
### Direct execution failures
`executeHooks(...)` catches all internal errors and returns `success:false` aggregated result with captured error list.

### MessageBus request failures
`handleHookExecutionRequest(...)` has try/catch and publishes error response with `success:false` and error object.

### Validation failures
Validation helper throws are captured by handler-level catches in bus path, converted to structured error response instead of process-level throw.

### Initialization failure surface
`getEventHandler()` throws pre-init; callers are expected to initialize system before event dispatch.

## 9) Robustness characteristics summary (upstream)
Upstream robustness posture is characterized by:
- explicit input validation for bus-routed events,
- translation normalization for model-facing payloads,
- mediated async request/response execution through MessageBus,
- centralized common output interpretation,
- per-hook telemetry emission,
- comprehensive catch-and-return error envelopes in handler execution.
