# Current Repository Hook System Detail (llxprt-code)

## Scope and evidence base
This document describes current hook-system behavior in this repository from:
- `packages/core/src/hooks/hookSystem.ts`
- `packages/core/src/hooks/hookEventHandler.ts`

with architecture references to:
- `packages/core/src/hooks/hookPlanner.ts`
- `packages/core/src/hooks/hookRunner.ts`
- `packages/core/src/hooks/hookAggregator.ts`
- `packages/core/src/hooks/hookTranslator.ts`
- `packages/core/src/core/*HookTriggers.ts`

## 1) HookSystem lifecycle (current)
Primary coordinator: `HookSystem` class (`packages/core/src/hooks/hookSystem.ts`).

### Construction phase
`constructor(config: Config)` eagerly constructs core components but defers event-handler creation:
- `registry = new HookRegistry(config)`
- `planner = new HookPlanner(registry)`
- `runner = new HookRunner()`
- `aggregator = new HookAggregator()`
- `eventHandler` remains `null` until initialization.

### Initialization phase
`initialize()`:
- idempotent using `initialized` guard and debug log short-circuit.
- calls `await registry.initialize()`.
- constructs `eventHandler = new HookEventHandler(config, registry, planner, runner, aggregator)` after registry readiness.
- sets `initialized = true` and logs status.

### Accessor semantics
- `getRegistry()` throws `HookSystemNotInitializedError` if pre-init.
- `getEventHandler()` throws `HookSystemNotInitializedError` if pre-init or null handler.
- `getStatus()` returns `{ initialized, totalHooks }` with zero total pre-init.
- `isInitialized()` exposes lifecycle state.

## 2) HookEventHandler architecture (current)
Primary class: `HookEventHandler` (`packages/core/src/hooks/hookEventHandler.ts`).

### Dependency graph
Constructor accepts:
- `config`
- `_registry` (retained but currently unused; planner carries registry path)
- `planner`
- `runner`
- `aggregator`

No MessageBus dependency is injected; event handling is direct invocation only.

### Event method surface
Public methods include:
- `fireBeforeToolEvent`
- `fireAfterToolEvent`
- `fireBeforeModelEvent`
- `fireAfterModelEvent`
- `fireBeforeToolSelectionEvent`
- `fireSessionStartEvent`
- `fireSessionEndEvent`
- `fireBeforeAgentEvent`
- `fireAfterAgentEvent`
- `fireNotificationEvent`

Return-type behavior differs by method family:
- tool events return `DefaultHookOutput | undefined` via `executeEvent(...)` helper.
- model/session/agent/notification methods return `AggregatedHookResult` via `executeEventWithFullResult(...)`.

## 3) Planner/runner/aggregator behavior (current integration semantics)
Core flow in `executeEventWithFullResult(eventName, context)`:
1. build execution plan with `planner.createExecutionPlan(...)` and optional `{ toolName }` context.
2. if no matching hooks: return constant `EMPTY_SUCCESS_RESULT`.
3. build input by merging `buildBaseInput(eventName)` + `context`.
4. execute sequential or parallel based on plan flag:
   - `runner.executeHooksSequential(...)`
   - `runner.executeHooksParallel(...)`
5. aggregate via `aggregator.aggregateResults(results, eventName)`.
6. debug-log summary and return.

Error policy in this layer:
- `executeEventWithFullResult` itself is not internally guarded; callers wrap it.
- each public `fire*` method catches exceptions and returns non-fatal empty success (or `undefined` for tool-output helper path).

## 4) Payload translation and validation (current)
### Base payload generation
`buildBaseInput(eventName)` sets:
- `session_id` from `config.getSessionId()`
- `cwd` from `config.getTargetDir()`
- `timestamp` ISO string
- `hook_event_name`
- `transcript_path` TODO placeholder

### Validation posture
Current `HookEventHandler` does not define dedicated schema validation helpers (no equivalent to upstream `validate*Input` functions). Context fields are accepted and cast into `HookInput` after merge.

### Translation posture
Current handler does not call `defaultHookTranslator` in `fireBeforeModelEvent` / `fireAfterModelEvent` / `fireBeforeToolSelectionEvent`; methods pass provided `llmRequest` / `llmResponse` context directly into event input composition path.

## 5) MessageBus integration (current)
No MessageBus integration in current `hookEventHandler.ts` or `hookSystem.ts`:
- no injected message bus
- no subscription to hook execution requests
- no correlation-id-based async response publication

Callers are expected to invoke `fire*Event` directly via hook trigger functions.

## 6) Local logging (current)

**Note:** llxprt-code uses local `DebugLogger` for observability. We do NOT use OpenTelemetry or OTLP — all logging is local.

Logging present:
- `DebugLogger` is used in `HookSystem` and `HookEventHandler` for init, no-hook, and non-fatal error messages.

Logging absent in current event-handler path:
- no per-hook structured log record construction
- no per-hook logging emission from handler
- no explicit decomposition of success/error counts per execution batch inside handler

## 7) Caller-side application semantics (current)
Current handler does not implement a central `processCommonHookOutputFields(...)` equivalent.

Implications:
- interpretation of fields such as `systemMessage`, `suppressOutput`, and stop/continue semantics is left to caller/integration points and/or downstream output classes.
- handler role is primarily execution orchestration and aggregate return.

## 8) Failure semantics (current)
### Event fire failure behavior
Each public `fire*` method catches exceptions and degrades gracefully:
- returns `EMPTY_SUCCESS_RESULT` for aggregated-result methods.
- returns `undefined` for simplified output methods.

This is intentionally non-fatal; errors are warning-logged.

### Pre-initialization behavior
`HookSystem` enforces strict pre-init access checks via typed `HookSystemNotInitializedError`.

### No MessageBus failure channel
Because there is no message bus route, no structured async error response contract exists for mediated callers.

## 9) Robustness characteristics summary (current)
Current system is robust in lifecycle guarding and non-fatal event execution, with shared planner/runner/aggregator orchestration and good debug traces. Compared to upstream robustness mechanisms, it currently lacks:
- MessageBus-mediated hook execution contract,
- explicit input validation helpers,
- centralized model payload translation in event handler,
- centralized processing of common output semantics,
- per-hook structured logging emission in handler execution flow.

**Note on observability:** The refactor will add per-hook logging via the existing `DebugLogger` infrastructure (NOT OpenTelemetry/OTLP).
