# Phase 12: Semantics/Logging Stub

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P12`

## Prerequisites

- Required: Phase 11a (validation impl verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P11" packages/core/src/hooks/`
- All P10, P07, P04 tests must be passing

## Requirements Implemented (Expanded)

### DELTA-HRUN-001: Centralized common-output processing

**Full Text**: HookEventHandler SHALL apply centralized post-aggregation processing for common hook output semantics
**Behavior**:
- GIVEN: Aggregated hook result with shouldStop, systemMessage, suppressOutput fields
- WHEN: processCommonHookOutputFields is called
- THEN: Returns ProcessedHookResult with all fields normalized

### DELTA-HRUN-002: Stop intent normalization

**Full Text**: If aggregated output contains stop intent, SHALL normalize and surface canonical stop reason
**Behavior**:
- GIVEN: Any hook signals stop with a reason
- WHEN: processCommonHookOutputFields runs
- THEN: shouldStop=true and stopReason normalized

### DELTA-HRUN-003: systemMessage and suppressOutput

**Full Text**: Consistent display semantics from one centralized location
**Behavior**:
- GIVEN: Hook output has systemMessage and suppressOutput
- WHEN: processCommonHookOutputFields runs
- THEN: These fields present in ProcessedHookResult

### DELTA-HRUN-004: ProcessedHookResult interface

**Full Text**: processCommonHookOutputFields SHALL return ProcessedHookResult with: aggregated, shouldStop, stopReason, systemMessage, suppressOutput
**Behavior**:
- GIVEN: Any AggregatedHookResult
- WHEN: processCommonHookOutputFields called
- THEN: Returns ProcessedHookResult with all 5 fields

### DELTA-HTEL-001: Per-hook logging

**Full Text**: FOR each hook execution result, SHALL emit per-hook log records via DebugLogger
**Behavior**:
- GIVEN: DebugLogger injected and hooks executed
- WHEN: emitPerHookLogs called after execution
- THEN: One log record per hook with eventName, hookIdentity, duration, success, exitCode, stdout, stderr, errorMessage

### DELTA-HTEL-002: Batch summary

**Full Text**: SHALL log batch-level summaries via DebugLogger
**Behavior**:
- GIVEN: Batch of hooks executed
- WHEN: emitBatchSummary called
- THEN: One summary record with hookCount, successCount, failureCount, totalDuration

### DELTA-HFAIL-001: buildFailureEnvelope in all catch blocks

**Full Text**: buildFailureEnvelope SHALL be used in all catch blocks; returning EMPTY_SUCCESS_RESULT from catch is non-conforming

### DELTA-HFAIL-004: makeEmptySuccessResult factory

**Full Text**: EMPTY_SUCCESS_RESULT SHALL NOT be returned by reference; all no-match paths SHALL call makeEmptySuccessResult()

## Implementation Tasks

### Files to Modify

#### `packages/core/src/hooks/hookEventHandler.ts`

Add stub `processCommonHookOutputFields` returning default ProcessedHookResult:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P12
 * @requirement DELTA-HRUN-001, DELTA-HRUN-004
 */
private processCommonHookOutputFields(
  aggregated: AggregatedHookResult
): ProcessedHookResult {
  // Stub — returns defaults until P14 implements real scanning
  return {
    aggregated,
    shouldStop: false,
    stopReason: undefined,
    systemMessage: undefined,
    suppressOutput: false
  };
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P12
 * @requirement DELTA-HTEL-001
 */
private emitPerHookLogs(
  eventName: HookEventName,
  hookResults: readonly HookResult[]
): void {
  // Stub — no-op until P14
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P12
 * @requirement DELTA-HTEL-002
 */
private emitBatchSummary(
  eventName: HookEventName,
  hookResults: readonly HookResult[],
  totalDurationMs: number
): void {
  // Stub — no-op until P14
}
```

Add ProcessedHookResult interface (or import from types.ts if it exists):

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P12
 * @requirement DELTA-HRUN-004
 */
export interface ProcessedHookResult {
  aggregated: AggregatedHookResult;
  shouldStop: boolean;
  stopReason: string | undefined;
  systemMessage: string | undefined;
  suppressOutput: boolean;
}
```

Wire `processCommonHookOutputFields` into `executeHooksCore` (after aggregation):

```typescript
// In executeHooksCore, after aggregator.aggregate():
const processedResult = this.processCommonHookOutputFields(aggregatedResult);
this.emitPerHookLogs(eventName, hookResults);
this.emitBatchSummary(eventName, hookResults, aggregatedResult.totalDuration ?? 0);
// Still return aggregatedResult for backward compat in Phase D stub
// Phase D impl changes return type to ProcessedHookResult
```

Ensure all catch blocks use `buildFailureEnvelope` (not EMPTY_SUCCESS_RESULT):

```typescript
// Audit all catch blocks in hookEventHandler.ts:
// FORBIDDEN: } catch (e) { return EMPTY_SUCCESS_RESULT; }
// REQUIRED:  } catch (e) { return this.buildFailureEnvelope(e, 'stage', meta); }
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P12
 * @requirement DELTA-HRUN-001
 */
```

## Verification Commands

```bash
# processCommonHookOutputFields stub exists
grep -n "processCommonHookOutputFields" packages/core/src/hooks/hookEventHandler.ts
# Expected: method definition present

# emitPerHookLogs stub exists
grep -n "emitPerHookLogs" packages/core/src/hooks/hookEventHandler.ts
# Expected: method definition present

# emitBatchSummary stub exists
grep -n "emitBatchSummary" packages/core/src/hooks/hookEventHandler.ts
# Expected: method definition present

# ProcessedHookResult interface defined or imported
grep -n "ProcessedHookResult" packages/core/src/hooks/hookEventHandler.ts
# Expected: interface definition or import present

# No EMPTY_SUCCESS_RESULT returned from catch blocks
grep -B 2 "EMPTY_SUCCESS_RESULT" packages/core/src/hooks/hookEventHandler.ts | grep -i "catch\|error"
# Expected: 0 lines (all catch blocks use buildFailureEnvelope)

# TypeScript compiles
npm run typecheck
# Expected: 0 errors

# Plan markers
grep -c "PLAN-20250218-HOOKSYSTEM.P12" packages/core/src/hooks/hookEventHandler.ts
# Expected: 5+

# All previous tests still pass
npm test -- --testPathPattern="hookSystem-lifecycle|hookValidators|hookEventHandler-messagebus" 2>&1 | grep "passed"
# Expected: all still passing
```

## Success Criteria

- processCommonHookOutputFields stub present
- emitPerHookLogs, emitBatchSummary stubs present
- ProcessedHookResult interface defined
- All catch blocks use buildFailureEnvelope (not EMPTY_SUCCESS_RESULT)
- makeEmptySuccessResult() called for no-match paths (not EMPTY_SUCCESS_RESULT by reference)
- TypeScript compiles
- All previous tests pass

## Failure Recovery

If TypeScript fails:
1. Check ProcessedHookResult interface is imported or defined before use
2. Check HookResult type exists and has correct shape
3. Fix imports and re-run typecheck

If the stub is incorrect or needs to be reset:
1. `git checkout -- packages/core/src/hooks/hookEventHandler.ts`
2. Re-read pseudocode lines 10–45 (processCommonHookOutputFields) and retry
3. Ensure ProcessedHookResult interface is declared before use

If pre-existing tests regress:
1. `git checkout -- packages/core/src/hooks/hookEventHandler.ts`
2. Confirm stub methods return values of the correct type (no signature changes)
3. Re-run pre-existing tests to confirm baseline

Cannot proceed to P13 until TypeScript compiles and existing tests pass.

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P12.md`
