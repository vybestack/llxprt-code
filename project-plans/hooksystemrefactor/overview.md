# Hook System Refactor - Functional Overview

## 1) Purpose
This document defines the functional end-state for hook-system robustness parity in llxprt-code, using only repository evidence from:

- `project-plans/hooksystemrefactor/current-detail.md`
- `project-plans/hooksystemrefactor/geminicli-detail.md`
- `project-plans/hooksystemrefactor/comparison.md`
- `project-plans/hooksystemrefactor/requirements.md`

Target outcome: the llxprt hook subsystem achieves parity with the upstream robustness profile documented in this repo snapshot, specifically for lifecycle control, dual-path execution, payload boundary handling, observability, and failure isolation.

This is a functional/behavior document (what must happen). Implementation design is specified in `techincal-overview.md`.

---

## 2) Scope
In scope:
- HookSystem lifecycle and composition behavior
- HookEventHandler behavior for both direct and mediated execution
- Event dispatch behavior across tool/model/agent/session/notification categories
- Input validation and model payload translation boundaries
- Aggregation and common-output post-processing semantics
- Failure envelopes and non-fatal runtime behavior
- Local logging and observability expectations
- Migration and verification outcomes needed to satisfy DELTA requirements

Out of scope:
- User-authored hook command business logic
- Product features unrelated to hook execution architecture
- Hook JSON schema changes not required by DELTA parity

---

## 3) Functional goals
When complete, the subsystem must provide:

1. Deterministic lifecycle
   - HookSystem initializes idempotently.
   - Event handler access is lifecycle-safe.

2. Two execution entry paths with equivalent semantics
   - Direct path via `fire*Event` methods.
   - Mediated path via MessageBus request/response with correlation.

3. Validated boundaries and canonical translation
   - Mediated event payloads are validated per event type.
   - Model-facing payloads are translated to hook-canonical formats before execution.

4. Centralized output semantics
   - Common fields (`continue`, stop reason, `systemMessage`, `suppressOutput`) are interpreted centrally.

5. Explicit, non-fatal failure handling
   - Failures are surfaced as structured failure envelopes.
   - Hook failures do not crash core runtime.

6. Operational observability
   - Batch- and hook-level local logging (via DebugLogger) enables root-cause analysis.
   - **Note:** llxprt-code does NOT use OpenTelemetry or OTLP. All observability is local.

These goals directly align with DELTA requirements DELTA-HSYS, DELTA-HEVT, DELTA-HRUN, DELTA-HPAY, DELTA-HBUS, DELTA-HTEL, DELTA-HAPP, and DELTA-HFAIL in `requirements.md`.

---

## 4) Functional architecture (component responsibilities)

### 4.1 HookSystem
- Owns lifecycle and dependency composition.
- Exposes lifecycle-safe handler/registry status and management APIs.
- Injects optional MessageBus and DebugLogger dependencies into HookEventHandler.

### 4.2 HookEventHandler
- Defines external execution boundary for direct and mediated invocations.
- Performs boundary validation and event routing.
- Applies translation for model-facing event payloads.
- Orchestrates planner/runner/aggregator execution.
- Applies centralized common output semantics.
- Emits local debug logs (via DebugLogger) and produces deterministic success/failure envelopes.

### 4.3 HookPlanner, HookRunner, HookAggregator
- Planner resolves hook set and execution mode (sequential/parallel).
- Runner executes hooks and returns per-hook execution results.
- Aggregator produces canonical aggregated result envelope.

### 4.4 MessageBus (optional runtime dependency)
- Carries `HOOK_EXECUTION_REQUEST` and `HOOK_EXECUTION_RESPONSE` messages.
- Enables asynchronous/decoupled hook execution while preserving direct-path capability when absent.

---

## 5) Data contract and boundary expectations

### 5.1 Base input invariants
All execution paths include base context fields:
- `session_id`
- `cwd`
- `hook_event_name`
- `timestamp`
- `transcript_path` (placeholder acceptable per current evidence)

### 5.2 Mediated request/response contract
Mediated requests include:
- `eventName`
- event-specific `input`
- `correlationId`

Mediated responses include:
- matching `correlationId`
- `success: boolean`
- optional `output`
- optional structured `error`

### 5.3 Result envelope invariants
- Explicit `success` indicator always present.
- No-match execution returns deterministic success no-op envelope.
- Failure classes remain explicit (validation, translation, planning, execution, aggregation, internal).

---

## 6) Execution-path behavior

### 6.1 Direct path
1. Caller invokes a `fire*Event` method.
2. Handler builds base + event-specific input.
3. For model-related events, handler translates request/response payloads.
4. Planner resolves matching hooks and execution mode.
5. Runner executes hooks.
6. Aggregator merges results.
7. Handler applies common-output semantics.
8. Handler returns structured result envelope.

Expected behavior:
- Deterministic no-op success when no hooks match.
- Internal errors return explicit failure envelopes.

### 6.2 Mediated path
1. Caller publishes `HOOK_EXECUTION_REQUEST`.
2. Handler receives request from MessageBus.
3. Handler validates request/event payload.
4. Handler translates model payloads where required.
5. Planner/runner/aggregator execute as in direct path.
6. Handler publishes `HOOK_EXECUTION_RESPONSE` with matching correlation.

Expected behavior:
- Invalid/unsupported requests yield structured failed responses.
- Equivalent input produces semantically equivalent outcomes across direct and mediated paths.

---

## 7) Validation and translation boundaries

### 7.1 Validation boundary
- Runtime validation occurs at mediated ingress before planning/execution.
- Event families covered: BeforeTool, AfterTool, BeforeAgent, AfterAgent, BeforeModel, AfterModel, BeforeToolSelection, Notification.
- Validation failures do not execute hooks and return/publish structured failures.

### 7.2 Translation boundary
- Model payload translation is mandatory before execution for BeforeModel, AfterModel, and BeforeToolSelection.
- Translation failures produce structured failures, including correlation context in mediated mode.

---

## 8) Common-output semantics
A single canonical processing stage applies shared output semantics after aggregation:
- stop intent (`continue=false` / equivalent output methods)
- effective stop reason normalization
- `systemMessage` and `suppressOutput` behavior

Functional expectation: integration layers consume normalized outcomes instead of re-implementing ad hoc parsing logic.

---

## 9) Local logging and failure handling expectations

**Important:** llxprt-code does NOT use OpenTelemetry, OTLP, or any remote telemetry. All observability uses the existing local `DebugLogger` infrastructure.

### 9.1 Local logging (via DebugLogger)
Per batch:
- event name
- total hooks
- success/failure counts
- total duration

Per hook:
- hook identity/type
- duration
- success flag
- exit code
- stdout/stderr
- error message (if any)

### 9.2 Failure handling
- Hook failures are non-fatal to runtime.
- Every failure stage yields explicit structured failure outcomes.
- Mediated path publishes failures rather than dropping/throwing across bus boundary.

---

## 10) Migration phases (functional milestones)

Phase 1: Lifecycle and composition parity
- Add MessageBus/DebugLogger-capable composition wiring in HookSystem.
- Expose required HookSystem management APIs.

Phase 2: Mediated execution parity
- Add request subscription, event routing, and correlated responses.
- Enforce stable request/response contract.

Phase 3: Boundary hardening parity
- Add explicit event-type validation.
- Add model payload translation integration.

Phase 4: Semantics/observability parity
- Add centralized common-output processing.
- Add per-hook local logging and batch summaries (via DebugLogger).
- Standardize explicit failure envelopes.

Phase 5: Verification closure
- Confirm parity behaviors against DELTA acceptance expectations.

---

## 11) Verification and test strategy (functional)
Verification must prove behavior, not structure:

1. Direct-path behavior tests
- no-match deterministic success no-op
- model translation applied before hook execution
- centralized common-output semantics observed by callers

2. Mediated-path behavior tests
- request-to-response correlation preserved
- invalid payload returns structured failure and skips execution
- unsupported event returns structured failure response

3. Failure-path behavior tests
- validation/translation/planning/runner/aggregation errors return explicit failure envelopes
- hook failures remain non-fatal

4. Observability tests (local logging)
- per-hook log records emitted for success/failure (via DebugLogger)
- batch summaries include required counters/durations

5. Compatibility tests
- MessageBus absent => direct path unaffected
- existing direct caller behavior remains stable except DELTA-defined improvements

---

## 12) DELTA traceability summary
- DELTA-HSYS: lifecycle composition and management API parity
- DELTA-HEVT/HBUS: mediated request/response execution and correlation
- DELTA-HPAY: validation + translation boundaries
- DELTA-HRUN/HAPP: centralized common-output semantics
- DELTA-HTEL: per-hook and batch observability (local logging only — no OpenTelemetry/OTLP)
- DELTA-HFAIL: explicit, non-fatal failure envelopes

---

## 13) End-state acceptance criteria
The functional refactor is complete when all are true:

1. Direct and mediated execution paths are both implemented and semantically aligned.
2. Mediated inputs are validated and model payloads are translated before execution.
3. Common output semantics are centralized and consistently applied.
4. Failure outcomes are explicit and non-fatal across all stages.
5. Per-hook local log records and batch summaries are emitted for all executions (via DebugLogger).
6. Deterministic no-op success is preserved when no hooks match.
7. DELTA requirements in `requirements.md` are satisfied with evidence-backed verification.
