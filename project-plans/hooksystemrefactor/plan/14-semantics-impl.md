# Phase 14: Semantics/Logging Implementation

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P14`

## Prerequisites

- Required: Phase 13a (semantics TDD verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P13" packages/core/src/hooks/__tests__/`
- P13 tests MUST be failing before this phase starts

## CRITICAL IMPLEMENTATION RULES

- Follow pseudocode EXACTLY — cite specific line numbers
- Do NOT modify test files from P13 or any earlier phase
- UPDATE existing files only — no V2/New/Copy versions
- No console.log, no TODO, no FIXME in production code

## CENTRALIZED OUTPUT ENFORCEMENT (HARDENED)

`processCommonHookOutputFields()` is the **SINGLE MANDATORY PATH** for all hook output processing.

**Rules**:
1. **No bypass allowed**: Every execution path through `executeHooksCore()` that has hook results
   MUST call `processCommonHookOutputFields()`. There is no shortcut, no early return that skips it.
2. **Single call site**: `processCommonHookOutputFields()` is called exactly once per
   `executeHooksCore()` invocation — after aggregation, before logging.
3. **Private enforcement**: `processCommonHookOutputFields()` is `private`. Only `executeHooksCore()`
   calls it. No other method may bypass it by calling aggregator directly.
4. **Atomic pipeline**: The post-aggregation pipeline is:
   ```
   aggregate(hookResults)
     → processCommonHookOutputFields(aggregated)   ← MANDATORY, no bypass
     → emitPerHookLogs(...)                         ← telemetry
     → emitBatchSummary(...)                        ← telemetry
     → return processedResult.aggregated            ← public result
   ```
5. **Verification grep**: After P14, this grep MUST return exactly 1 (one call site only):
   ```bash
   grep -c "processCommonHookOutputFields" packages/core/src/hooks/hookEventHandler.ts
   # Expected: exactly 2 (definition + 1 call site in executeHooksCore)
   ```

## Requirements Implemented

DELTA-HRUN-001, DELTA-HRUN-002, DELTA-HRUN-003, DELTA-HRUN-004,
DELTA-HTEL-001, DELTA-HTEL-002, DELTA-HTEL-003,
DELTA-HFAIL-001, DELTA-HFAIL-004,
DELTA-HAPP-001, DELTA-HAPP-002

## Implementation Tasks

### File: `packages/core/src/hooks/hookEventHandler.ts`

**Primary pseudocode reference**: `analysis/pseudocode/common-output-processing.md`

---

#### 1. Implement `processCommonHookOutputFields()`

**Pseudocode reference**: `common-output-processing.md` lines 10–44

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P14
 * @requirement DELTA-HRUN-001, DELTA-HRUN-004
 * @pseudocode common-output-processing.md lines 10-44
 */
private processCommonHookOutputFields(
  aggregated: AggregatedHookResult
): ProcessedHookResult {
  // Line 12-15: Initialize all derived fields
  let shouldStop = false;
  let stopReason: string | undefined = undefined;
  let systemMessage: string | undefined = undefined;
  let suppressOutput = false;

  // Line 18-25: Pass 1 — scan for stop intent
  // First stop intent wins (BREAK after finding first)
  for (const hookOutput of aggregated.allOutputs ?? []) {
    if (hookOutput.stop === true || hookOutput.shouldStopExecution?.() === true) {
      shouldStop = true;
      const rawReason = hookOutput.stopReason ?? hookOutput.reason ?? hookOutput.stop_reason;
      stopReason = this.normalizeStopReason(rawReason);
      break; // Line 23: first stop intent wins
    }
  }

  // Line 28-36: Pass 2 — scan for systemMessage and suppressOutput
  for (const hookOutput of aggregated.allOutputs ?? []) {
    if (hookOutput.systemMessage != null && hookOutput.systemMessage !== '') {
      systemMessage = hookOutput.systemMessage;
      if (hookOutput.suppressOutput === true) {
        suppressOutput = true;
      }
    }
  }

  // Line 38-44: Return ProcessedHookResult
  return {
    aggregated,
    shouldStop,
    stopReason,
    systemMessage,
    suppressOutput
  };
}
```

---

#### 2. Implement `normalizeStopReason()`

**Pseudocode reference**: `common-output-processing.md` lines 50–61

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P14
 * @requirement DELTA-HRUN-002
 * @pseudocode common-output-processing.md lines 50-61
 */
private normalizeStopReason(rawReason: unknown): string | undefined {
  if (rawReason === undefined || rawReason === null) return undefined; // Line 51-53
  if (typeof rawReason === 'string') {                                  // Line 54
    const trimmed = rawReason.trim();                                   // Line 55
    return trimmed.length === 0 ? undefined : trimmed;                 // Lines 56-58
  }
  return String(rawReason);                                             // Line 61
}
```

---

#### 3. Implement `makeEmptySuccessResult()`

**Pseudocode reference**: `common-output-processing.md` lines 70–80

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P14
 * @requirement DELTA-HFAIL-004
 * @pseudocode common-output-processing.md lines 70-80
 */
private makeEmptySuccessResult(): AggregatedHookResult {
  // Line 72-80: ALWAYS spread — never return constant by reference
  return { ...EMPTY_SUCCESS_RESULT };
}
```

Replace all remaining direct `return EMPTY_SUCCESS_RESULT;` references in no-match paths
with `return this.makeEmptySuccessResult();`.

---

#### 4. Implement `buildFailureEnvelope()`

**Pseudocode reference**: `common-output-processing.md` lines 90–123

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P14
 * @requirement DELTA-HFAIL-001
 * @pseudocode common-output-processing.md lines 90-123
 */
private buildFailureEnvelope(
  error: unknown,
  stage: string,
  meta?: FailureMeta
): AggregatedHookResult {
  // Lines 97-100: extract human-readable message
  const message =
    error instanceof Error ? error.message
    : typeof error === 'string' ? error
    : JSON.stringify(error) ?? 'Unknown error';

  // Lines 103-115: build normalized error object
  const normalizedError: Record<string, unknown> = { stage, message, details: error };
  if (meta?.eventName !== undefined) normalizedError['eventName'] = meta.eventName;
  if (meta?.correlationId !== undefined) normalizedError['correlationId'] = meta.correlationId;

  // Lines 117-123: return failure shape
  return {
    success: false,
    hookResults: [],
    allOutputs: [],
    errors: [normalizedError],
    totalDuration: 0
  };
}
```

Audit ALL catch blocks in hookEventHandler.ts and replace any remaining
`return EMPTY_SUCCESS_RESULT` or `return { success: true, ... }` with
`return this.buildFailureEnvelope(error, '<stage>', meta)`.

---

#### 5. Implement `emitPerHookLogs()`

**Pseudocode reference**: `common-output-processing.md` lines 130–158

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P14
 * @requirement DELTA-HTEL-001, DELTA-HTEL-003
 * @pseudocode common-output-processing.md lines 130-158
 */
private emitPerHookLogs(
  eventName: HookEventName,
  hookResults: readonly HookResult[]
): void {
  if (this.debugLogger === undefined) return; // Line 131-133: optional, no-op

  for (const result of hookResults) { // Line 135
    const record = { // Lines 136-145
      eventName: String(eventName),
      hookIdentity: result.hookName ?? result.hookType ?? 'unknown',
      duration: result.durationMs,
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      errorMessage: result.success ? undefined : (result.error?.message ?? 'execution failed')
    };

    this.debugLogger.log('hook:result', record); // Line 148

    if (!result.success) { // Line 151-157
      this.debugLogger.log('hook:failure_diagnostic', {
        ...record,
        error: result.error,
        details: (result as any).errorDetails
      });
    }
  }
}
```

---

#### 6. Implement `emitBatchSummary()`

**Pseudocode reference**: `common-output-processing.md` lines 165–182

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P14
 * @requirement DELTA-HTEL-002
 * @pseudocode common-output-processing.md lines 165-182
 */
private emitBatchSummary(
  eventName: HookEventName,
  hookResults: readonly HookResult[],
  totalDurationMs: number
): void {
  if (this.debugLogger === undefined) return; // Line 166-168

  const hookCount = hookResults.length;         // Line 170
  const successCount = hookResults.filter(r => r.success).length; // Line 171
  const failureCount = hookCount - successCount; // Line 172

  this.debugLogger.log('hook:batch_summary', {  // Line 182
    eventName: String(eventName),
    hookCount,
    successCount,
    failureCount,
    totalDurationMs
  });
}
```

---

#### 7. Wire into `executeHooksCore()`

**Pseudocode reference**: `common-output-processing.md` lines 190–208

```typescript
// After aggregator.aggregate(hookResults) → aggregatedResult:
const processedResult = this.processCommonHookOutputFields(aggregatedResult); // Line 196

this.emitPerHookLogs(eventName, hookResults);                    // Line 199

const totalDuration = hookResults.reduce((sum, r) => sum + (r.durationMs ?? 0), 0); // Line 202
this.emitBatchSummary(eventName, hookResults, totalDuration);    // Line 203

// Return aggregatedResult for backward compatibility:
return processedResult.aggregated;                                // Line 207
```

---

## §7: DELTA-HAPP — ProcessedHookResult vs AggregatedHookResult

**Requirements**: DELTA-HAPP-001, DELTA-HAPP-002

These two types serve different roles in the processing pipeline and must not be confused:

| Type | Where produced | Fields | Who consumes it |
|------|----------------|--------|-----------------|
| `AggregatedHookResult` | `HookAggregator.aggregate()` | `hookResults`, `success`, `allOutputs`, `errors`, `totalDuration` | Public return type of all `fire*Event` methods; callers (e.g. `coreToolHookTriggers.ts`) receive this |
| `ProcessedHookResult` | `processCommonHookOutputFields()` in this phase | All of `AggregatedHookResult` **plus** `shouldStop`, `stopReason`, `systemMessage`, `suppressOutput` | Internal to `executeHooksCore()` only — never returned to callers |

**Key rule**: `executeHooksCore()` MUST return `processedResult.aggregated` (the inner `AggregatedHookResult`),
NOT the `ProcessedHookResult` wrapper, so that existing callers remain unaffected.

**DELTA-HAPP-001** — Application hook output fields (`shouldStop`, `systemMessage`, `suppressOutput`) are
extracted and available inside `executeHooksCore()` for future stop-propagation logic.

**DELTA-HAPP-002** — The `stopReason` field is normalized (trimmed, undefined if empty) via
`normalizeStopReason()` before being exposed in `ProcessedHookResult`.

This two-type design allows the internal processing pipeline to carry richer metadata without
breaking the public API surface. Future phases may promote `ProcessedHookResult` to the public
return type if callers need stop-propagation; that is explicitly deferred.

---

## Verification Commands

### Primary: All P13 Tests Must Pass

```bash
npm test -- --testPathPattern="hookSemantics"
# Expected: ALL pass

npm test -- --testPathPattern="hookSystem-lifecycle|hookValidators|hookEventHandler-messagebus"
# Expected: ALL still pass
```

### No Test Modifications

```bash
git diff packages/core/src/hooks/__tests__/
# Expected: no diff
```

### Centralized Output Enforcement (HARDENED)

```bash
# processCommonHookOutputFields: EXACTLY 2 occurrences (definition + 1 call site)
grep -c "processCommonHookOutputFields" packages/core/src/hooks/hookEventHandler.ts
# Expected: 2 (definition + exactly 1 call site in executeHooksCore)
# If > 2: FAIL — method is being called from multiple places (bypass detected)

# No bypass: processCommonHookOutputFields called before any return in executeHooksCore
grep -A 30 "executeHooksCore" packages/core/src/hooks/hookEventHandler.ts | \
  grep -n "processCommonHookOutputFields\|return "
# Expected: processCommonHookOutputFields appears before every return statement

# Private modifier prevents external bypass
grep "private processCommonHookOutputFields\|public processCommonHookOutputFields\|protected processCommonHookOutputFields" \
  packages/core/src/hooks/hookEventHandler.ts
# Expected: only "private processCommonHookOutputFields" (never public or protected)

# Mandatory pipeline order: aggregate → processCommon → emitPerHook → emitBatch → return
# (Verify ordering by checking line numbers in the output)
grep -n "aggregate\|processCommonHookOutputFields\|emitPerHookLogs\|emitBatchSummary\|return processedResult" \
  packages/core/src/hooks/hookEventHandler.ts | head -20
# Expected: line numbers increase in the order above within executeHooksCore
```

### Pseudocode Compliance

```bash
# processCommonHookOutputFields: two passes
grep -A 25 "processCommonHookOutputFields" packages/core/src/hooks/hookEventHandler.ts | \
  grep -c "for.*allOutputs\|allOutputs.*for"
# Expected: 2 (two passes)

# normalizeStopReason: trim + undefined
grep -A 8 "normalizeStopReason" packages/core/src/hooks/hookEventHandler.ts | \
  grep "trim\|undefined"
# Expected: both present

# buildFailureEnvelope: success:false shape
grep -A 10 "buildFailureEnvelope" packages/core/src/hooks/hookEventHandler.ts | \
  grep "success: false"
# Expected: present

# emitPerHookLogs: hook:result and hook:failure_diagnostic
grep "hook:result\|hook:failure_diagnostic" packages/core/src/hooks/hookEventHandler.ts
# Expected: both present

# emitBatchSummary: hook:batch_summary
grep "hook:batch_summary" packages/core/src/hooks/hookEventHandler.ts
# Expected: present

# No EMPTY_SUCCESS_RESULT returned from catch blocks
grep -n "return EMPTY_SUCCESS_RESULT" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 (all replaced with buildFailureEnvelope)

# makeEmptySuccessResult called in no-match paths
grep "makeEmptySuccessResult" packages/core/src/hooks/hookEventHandler.ts
# Expected: 2+ (function definition + calls)
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" \
  packages/core/src/hooks/hookEventHandler.ts | grep -v ".test.ts"
# Expected: 0 matches

grep -rn "// Stub\|// stub\|no-op until" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 matches in implemented methods
```

### AST / Static Checks

```bash
# BANNED: bare EMPTY_SUCCESS_RESULT return — must be zero after P14
grep -n "return EMPTY_SUCCESS_RESULT" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 — any match is a BLOCKER

# BANNED: placeholder empty returns in impl files
grep -E "return \[\]|return \{\}|return null" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 in any method that handles hook execution results

# All catch blocks must call buildFailureEnvelope
grep -n "} catch\|catch(" packages/core/src/hooks/hookEventHandler.ts
# For each catch block found above, verify the corresponding buildFailureEnvelope call:
grep -n "buildFailureEnvelope" packages/core/src/hooks/hookEventHandler.ts
# Expected: count of buildFailureEnvelope calls >= count of catch blocks

# failure envelope ALL error classes: verify each error class tag is present
for stage in "validation" "transport" "runtime" "translation" "output_processing"; do
  grep -q "'$stage'" packages/core/src/hooks/hookEventHandler.ts && \
    echo "PASS: stage '$stage' envelope present" || \
    echo "WARN: stage '$stage' envelope not yet coded (may be added in P15+)"
done
```

### TypeScript and Build

```bash
npm run typecheck && echo "PASS"
npm run build && echo "PASS"
```

## Success Criteria

- All P13 tests pass
- All previous phase tests pass
- TypeScript compiles, build succeeds
- All 7 methods implemented (processCommon, normalizeStop, makeEmpty, buildFailure, emitPerHook, emitBatch + wiring)
- No EMPTY_SUCCESS_RESULT in catch blocks
- No stubs remaining
- No test modifications

## Failure Recovery

If P13 tests fail:
1. Read which specific assertion fails
2. Trace to pseudocode line number
3. Fix the specific logic (stop scanning, normalization, log record shape, etc.)

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P14.md`
