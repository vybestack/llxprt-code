# Phase 02: Pseudocode

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P02`

## Prerequisites

- Required: Phase 01a (analysis verification) completed
- Verification: `ls project-plans/hooksystemrefactor/.completed/P01a.md`

## Purpose

The pseudocode phase is **already complete** — four pseudocode files were produced
during the analysis phase. This phase documents and verifies their completeness
before implementation begins.

## Pseudocode Files Produced

### hook-event-handler.md
**Lines**: 10–427
**Covers**: Constructor/init, dispose, buildBaseInput, makeEmptySuccessResult,
buildFailureEnvelope, executeHooksCore, processCommonHookOutputFields,
all fire*Event direct-path methods, handleHookExecutionRequest (mediated path),
extractCorrelationId, validateEventPayload routing switch, emitPerHookLogs, emitBatchSummary,
buildSuccessResponse, buildFailedResponse

### message-bus-integration.md
**Lines**: 10–162
**Covers**: HookSystem.constructor wiring, HookSystem management APIs (setHookEnabled,
getAllHooks), HookSystem.dispose, HookEventHandler subscription setup, onBusRequest
message handler, routeAndExecuteMediated, publishResponse, HookEventHandler.dispose,
translateModelPayload routing

### validation-boundary.md
**Lines**: 10–188
**Covers**: isObject/isNonEmptyString primitives, validateBeforeToolInput,
validateAfterToolInput, validateBeforeAgentInput, validateAfterAgentInput,
validateBeforeModelInput, validateAfterModelInput, validateBeforeToolSelectionInput,
validateNotificationInput, validateEventPayload routing switch, mediated validation gate

### common-output-processing.md
**Lines**: 10–209
**Covers**: processCommonHookOutputFields, normalizeStopReason, makeEmptySuccessResult,
buildFailureEnvelope, emitPerHookLogs, emitBatchSummary, integration in executeHooksCore

## Requirements Implemented

### DELTA-HRUN-001–004: Common output processing
**Full Text**: Centralized post-aggregation processing for shouldStop, systemMessage, suppressOutput; ProcessedHookResult interface
**Behavior**:
- GIVEN: aggregatedResult from HookAggregator
- WHEN: processCommonHookOutputFields is called
- THEN: Returns ProcessedHookResult with shouldStop, stopReason, systemMessage, suppressOutput derived
**Pseudocode**: common-output-processing.md lines 10–44

### DELTA-HPAY-001–006: Validation and translation
**Full Text**: Type-predicate validators per event type; mediated validation gate; model translation both paths
**Pseudocode**: validation-boundary.md lines 10–188; hook-event-handler.md lines 155–169

### DELTA-HFAIL-001–005: Failure semantics
**Full Text**: buildFailureEnvelope in all catch blocks; makeEmptySuccessResult for no-match; HookEventName enum internal routing
**Pseudocode**: common-output-processing.md lines 90–123; hook-event-handler.md lines 50–75

### DELTA-HBUS-001–003: MessageBus integration
**Full Text**: HookExecutionRequest/HookExecutionResponse interfaces; bus-absent fallback; correlationId generation
**Pseudocode**: message-bus-integration.md lines 10–162

## Implementation Tasks

This phase is read-only (pseudocode already produced). Verify completeness only.

## Verification Commands

### Prerequisites Verification

```bash
# Verify Phase 01a (analysis verification) completion marker exists
ls project-plans/hooksystemrefactor/.completed/P01a.md || \
  { echo "FAIL: P01a not completed — run analysis verification first"; exit 1; }

# Verify domain model was produced by Phase 01
ls project-plans/hooksystemrefactor/analysis/domain-model.md || \
  { echo "FAIL: domain-model.md missing — Phase 01 incomplete"; exit 1; }

# Verify domain model covers key requirements (not empty/placeholder)
grep -c "DELTA-\|MessageBus\|validation\|ProcessedHookResult" \
  project-plans/hooksystemrefactor/analysis/domain-model.md | \
  xargs -I{} sh -c '[ {} -ge 3 ] && echo "PASS: domain model has {} relevant entries" || echo "FAIL: domain model too sparse"'
```

### Pseudocode Completeness

```bash
# All four pseudocode files present
for f in hook-event-handler message-bus-integration validation-boundary common-output-processing; do
  ls project-plans/hooksystemrefactor/analysis/pseudocode/${f}.md && echo "PASS: $f" || echo "FAIL: $f missing"
done

# Each file has numbered lines
for f in project-plans/hooksystemrefactor/analysis/pseudocode/*.md; do
  grep -cE "^[0-9]+:" "$f" | xargs -I{} echo "$(basename $f): {} numbered lines"
done
# Expected: each file has 20+ numbered lines

# Interface contracts present in each file
for f in project-plans/hooksystemrefactor/analysis/pseudocode/*.md; do
  grep -q "Interface Contracts" "$f" && echo "PASS: $f has contracts" || echo "FAIL: $f missing contracts"
done

# Anti-pattern warnings present
for f in project-plans/hooksystemrefactor/analysis/pseudocode/*.md; do
  grep -q "Anti-Pattern" "$f" && echo "PASS: $f" || echo "FAIL: $f missing anti-patterns"
done

# No actual TypeScript implementations (only pseudocode notation)
grep -rn "const \|let \|var \|=> \|async function\|export " \
  project-plans/hooksystemrefactor/analysis/pseudocode/*.md | \
  grep -v "interface\|Interface Contracts\|Dependencies\|typescript\|Anti-Pattern" | head -5
# Expected: 0 matches of production code (interface declarations are OK)

# Key algorithm steps present
grep -q "executeHooksCore\|processCommonHookOutputFields" \
  project-plans/hooksystemrefactor/analysis/pseudocode/hook-event-handler.md
echo "PASS: Core methods present in hook-event-handler pseudocode"

grep -q "translateModelPayload\|routeAndExecuteMediated" \
  project-plans/hooksystemrefactor/analysis/pseudocode/message-bus-integration.md
echo "PASS: Bus methods present in message-bus-integration pseudocode"

grep -q "validateBeforeToolInput\|validateNotificationInput" \
  project-plans/hooksystemrefactor/analysis/pseudocode/validation-boundary.md
echo "PASS: Validators present in validation-boundary pseudocode"

grep -q "buildFailureEnvelope\|makeEmptySuccessResult\|emitBatchSummary" \
  project-plans/hooksystemrefactor/analysis/pseudocode/common-output-processing.md
echo "PASS: Processing functions present in common-output-processing pseudocode"
```

## Success Criteria

- All 4 pseudocode files present with numbered lines
- Interface contracts and anti-pattern warnings in each file
- Algorithm covers all 5 gaps
- No production TypeScript in pseudocode sections (only in interface contracts)
- Implementation phases can reference specific line numbers

## Failure Recovery

If pseudocode is incomplete:
1. Identify which component/function is missing
2. Add numbered pseudocode to appropriate file
3. Ensure anti-pattern warnings cover the new section
4. Re-run verification

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P02.md`
