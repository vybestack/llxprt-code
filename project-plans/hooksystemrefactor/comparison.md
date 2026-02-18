# Hook System Robustness Parity Comparison (Current vs Upstream Snapshot)

## Comparison basis
Compared artifacts:
- Current:
  - `packages/core/src/hooks/hookSystem.ts`
  - `packages/core/src/hooks/hookEventHandler.ts`
- Upstream snapshot:
  - `tmp/gemini-cli-upstream/packages/core/src/hooks/hookSystem.ts`
  - `tmp/gemini-cli-upstream/packages/core/src/hooks/hookEventHandler.ts`

Categories requested: lifecycle, architecture, planner/runner/aggregator, translation/validation, MessageBus, telemetry/logging, caller-side semantics, failure semantics.

---

## 1) HookSystem lifecycle parity

### Already-parity
- **Idempotent initialize** in both implementations via `initialized` guard.
- **Single shared component instances** for registry/planner/runner/aggregator owned by HookSystem.
- **Status reporting** via `{ initialized, totalHooks }`.

### Partial parity
- Both gate access to event handler before init, but error type differs:
  - Current: `HookSystemNotInitializedError` (typed domain error).
  - Upstream: generic `Error('Hook system not initialized')`.
- Current defers event-handler construction until initialize; upstream constructs at HookSystem constructor time. Both are valid lifecycle strategies but not structurally equivalent.

### Parity gap
- Upstream HookSystem includes operational management methods:
  - `setHookEnabled(...)`
  - `getAllHooks()`
  Current HookSystem does not expose these methods directly.
- Upstream injects MessageBus and OpenTelemetry logger into HookEventHandler during construction; current does not.
  - **Note for llxprt-code:** We will inject MessageBus and DebugLogger (NOT OpenTelemetry). llxprt-code does not use OTLP or remote telemetry.

---

## 2) HookEventHandler architecture parity

### Already-parity
- Both have a dedicated `HookEventHandler` orchestration class.
- Both expose broad `fire*Event` method families for tool/model/agent/session/notification-type events.
- Both delegate execution planning to planner and execution to runner with aggregation by aggregator.

### Partial parity
- Current includes all major event types in requested list, but naming and typed contracts differ from upstream in parameter forms and return forms.
- Current has graceful non-throw event wrappers; upstream handles errors in central executor and bus handler path.

### Parity gap
- Upstream has **dual-path architecture** (direct + MessageBus mediated request/response).
- Current is **direct-path only**; no mediated request contract.

---

## 3) Planner/runner/aggregator execution parity

### Already-parity
- Both call planner for execution plan generation.
- Both support sequential vs parallel execution by plan flag.
- Both aggregate runner results through a dedicated aggregator.
- Both short-circuit to success/empty result when no matching hooks.

### Partial parity
- Current exposes simplified tool-event return (`DefaultHookOutput | undefined`) using helper wrapper, whereas upstream consistently returns `AggregatedHookResult` from fire methods.

### Parity gap
- Upstream includes central post-aggregation processing (`processCommonHookOutputFields`) and richer execution logging in handler; current lacks this stage.

---

## 4) Payload translation and validation parity

### Already-parity
- Both create base hook input with common fields (`session_id`, cwd-equivalent, event name, timestamp, transcript placeholder).

### Partial parity
- Base field key-set is aligned, but cwd source accessor differs:
  - Current uses `config.getTargetDir()`.
  - Upstream uses `config.getWorkingDir()`.

### Parity gap
- Upstream has explicit runtime input validators (`validateBeforeToolInput`, `validateAfterToolInput`, `validateModelInput`, etc.) especially in MessageBus routing path.
- Current has no equivalent handler-level validation helper set.
- Upstream uses `defaultHookTranslator` for model request/response normalization in fire methods and bus path.
- Current handler path does not explicitly invoke translator in model events.

---

## 5) MessageBus integration parity

### Already-parity
- None in this category.

### Partial parity
- None; integration is absent rather than partial.

### Parity gap
- Upstream subscribes to `MessageBusType.HOOK_EXECUTION_REQUEST`, routes per-event, and publishes `HOOK_EXECUTION_RESPONSE` including correlation IDs.
- Current has no message bus subscription/publication route, no `HookExecutionRequest`/response mediation logic.

---

## 6) Local logging/observability parity

**Note:** llxprt-code does NOT use OpenTelemetry or OTLP. Upstream's "telemetry" maps to local DebugLogger usage in llxprt-code.

### Already-parity
- Both implementations use debug logging for execution/instrumentation traces and errors.

### Partial parity
- Both report event-level outcomes, but current reports coarse summaries; upstream reports richer per-result logging.

### Parity gap
- Upstream constructs and emits per-hook log records (`HookCallEvent` via `logHookCall`).
- Current handler does not emit equivalent per-hook log payloads.
- **llxprt-code approach:** We will add per-hook logging via DebugLogger (not OpenTelemetry).

---

## 7) Caller-side application semantics parity

### Already-parity
- Both return aggregated outcomes that callers can interpret.

### Partial parity
- Current exposes final output for some call sites (`executeEvent` path), but central semantics application is external.

### Parity gap
- Upstream centralizes interpretation of common output fields (`systemMessage`, `suppressOutput`, stop-execution signaling) in handler-level `processCommonHookOutputFields`.
- Current lacks corresponding central stage in handler.

---

## 8) Failure semantics parity

### Already-parity
- Both designs aim for non-fatal hook execution behavior and avoid crashing core flow for hook failures.

### Partial parity
- Error envelope style differs:
  - Current often degrades to empty success in public fire methods.
  - Upstream returns explicit `success:false` aggregated result in `executeHooks` catch path.

### Parity gap
- Upstream defines mediated failure semantics for MessageBus request handling (publishes structured failed response).
- Current has no mediated error channel for asynchronous callers.

---

## 9) Parity matrix summary

| Area | Status | Notes |
|---|---|---|
| Lifecycle init/idempotency | Already parity | Both have single-init guards and shared components |
| Event handler orchestration | Partial parity | Similar orchestration, but upstream has dual execution architecture |
| Planner/Runner/Aggregator core flow | Already parity | Planning, sequential/parallel run, and aggregation all present |
| Payload validation | Gap | Upstream validator helpers absent in current |
| Payload translation (model) | Gap | Upstream translator integration not mirrored in current handler path |
| MessageBus integration | Gap | Upstream request/response mediation absent currently |
| Per-hook logging | Gap | Upstream HookCallEvent logging absent currently (llxprt-code will use DebugLogger, not OpenTelemetry) |
| Caller-side common output semantics | Gap | Upstream central processing absent currently |
| Failure semantics | Partial parity | Both non-fatal, but upstream has structured failure envelopes and bus error responses |

## 10) Priority gap ranking for robustness parity
1. MessageBus mediated execution + response correlation contract.
2. Input validation layer for mediated/direct execution boundaries.
3. Central model payload translation in handler path.
4. Per-hook local logging (via DebugLogger) and richer execution diagnostics.
5. Central common output semantics processing and standardized failure envelope behavior.

**Note:** llxprt-code will NOT adopt OpenTelemetry/OTLP from upstream. All observability uses local DebugLogger.
