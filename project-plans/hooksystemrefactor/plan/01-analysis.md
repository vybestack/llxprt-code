# Phase 01: Analysis

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P01`

## Prerequisites

- Required: Phase 00a (preflight) completed
- Verification: All preflight checkboxes checked in `00a-preflight-verification.md`
- Preflight verification MUST be completed before this phase

## Purpose

Produce a complete domain model for the hook system refactor that covers all five gaps:
MessageBus integration, payload validation, model-payload translation, centralized
common-output processing, and failure envelope standardization.

This analysis phase is **complete** — the outputs are already present in:
- `project-plans/hooksystemrefactor/analysis/domain-model.md`
- (Pseudocode developed in Phase 02)

## Requirements Analyzed

### DELTA-HSYS-001: HookSystem SHALL inject MessageBus and DebugLogger

**Full Text**: HookSystem SHALL inject MessageBus and DebugLogger into HookEventHandler during composition
**Behavior**:
- GIVEN: HookSystem is constructed with optional messageBus and debugLogger arguments
- WHEN: HookSystem instantiates HookEventHandler
- THEN: Both dependencies are forwarded to HookEventHandler constructor
**Why This Matters**: Enables MessageBus-mediated invocation and local observability without tight coupling

### DELTA-HSYS-002: Management APIs

**Full Text**: HookSystem SHALL expose setHookEnabled / getAllHooks management methods
**Behavior**:
- GIVEN: HookSystem is initialized with a hook registry
- WHEN: setHookEnabled(id, true/false) is called
- THEN: The specified hook's enabled state is updated
- GIVEN: getAllHooks() is called
- THEN: Returns current HookDefinition[] from registry
**Why This Matters**: Provides runtime control without requiring restart

### DELTA-HEVT-001–004: HookEventHandler Dual-Path

**Full Text**: MessageBus subscription, response publication, unsupported-event handling, dispose()
**Behavior**: Documented in domain-model.md section 3.1 (lifecycle states) and 3.2 (execution state machine)
**Why This Matters**: Enables async/decoupled invocation without breaking direct-path callers

### DELTA-HFAIL-001–005: Failure Semantics

**Full Text**: buildFailureEnvelope in all catch blocks; makeEmptySuccessResult() for no-match;
HookEventName enum throughout internal routing
**Why This Matters**: Silent failure masking is the most dangerous gap; errors must surface

## Implementation Tasks

### Files to Review (analysis artifacts — already complete)

- `project-plans/hooksystemrefactor/analysis/domain-model.md`
  - MUST include: Entity relationships, state transitions, business rules, edge cases, error scenarios
- `project-plans/hooksystemrefactor/analysis/pseudocode/hook-event-handler.md`
- `project-plans/hooksystemrefactor/analysis/pseudocode/message-bus-integration.md`
- `project-plans/hooksystemrefactor/analysis/pseudocode/validation-boundary.md`
- `project-plans/hooksystemrefactor/analysis/pseudocode/common-output-processing.md`

## Verification Commands

### Prerequisites Verification

```bash
# Verify Phase 00a (preflight) completion marker exists
ls project-plans/hooksystemrefactor/.completed/P00a.md || \
  { echo "FAIL: P00a not completed — run preflight verification first"; exit 1; }

# Verify preflight verification document was reviewed
grep -q "PASS\|VERIFIED\|Verdict" \
  project-plans/hooksystemrefactor/plan/00a-preflight-verification.md || \
  { echo "FAIL: Preflight verification not completed"; exit 1; }

# Verify source files exist that will be analyzed
grep -rn "hookEventHandler\|hookSystem\|HookEventName" \
  packages/core/src/hooks/ | grep -v ".test.ts" | wc -l | \
  xargs -I{} sh -c '[ {} -gt 0 ] && echo "PASS: {} source references found" || echo "FAIL: No hook source files found"'
```

### Structural

```bash
# Verify domain model exists and is complete
ls project-plans/hooksystemrefactor/analysis/domain-model.md
# Expected: file exists

# Verify domain model covers all five gaps
grep -c "MessageBus\|validation\|translation\|ProcessedHookResult\|buildFailureEnvelope" \
  project-plans/hooksystemrefactor/analysis/domain-model.md
# Expected: 5+ matches

# Verify all DELTA- requirements appear in domain model
grep -c "DELTA-" project-plans/hooksystemrefactor/analysis/domain-model.md
# Expected: 1+ matches (not necessarily all, but key ones)

# Verify entity relationships section
grep "Entity Relationships\|State Transitions\|Business Rules\|Edge Cases\|Error Scenarios" \
  project-plans/hooksystemrefactor/analysis/domain-model.md
# Expected: all sections present
```

### Semantic Verification

- [ ] Domain model covers all 5 gaps from specification
- [ ] Entity relationships defined: HookSystem → HookEventHandler → Planner/Runner/Aggregator
- [ ] State machine documented: REQUEST_RECEIVED → validation → routing → execution → COMPLETE
- [ ] Business rules F1–F4 (failure), C1–C3 (correlation), V1–V4 (validation), T1–T3 (translation)
- [ ] All 10 edge cases documented
- [ ] All error scenarios with direct/mediated response paths

## Success Criteria

- `analysis/domain-model.md` exists with all required sections
- Domain model covers all DELTA- requirements
- No implementation details in analysis (only behavior descriptions)

## Failure Recovery

If domain model is incomplete:
1. Re-read `specification.md` sections for missing gaps
2. Add missing sections to `domain-model.md`
3. Re-run Phase 01 verification before proceeding

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P01.md`
