# Phase 13: Semantics/Logging TDD

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P13`

## Prerequisites

- Required: Phase 12a (semantics stub verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P12" packages/core/src/hooks/`
- processCommonHookOutputFields, emitPerHookLogs, emitBatchSummary stubs must exist

## MANDATORY TDD RULES

- Tests expect REAL BEHAVIOR that does not yet exist (stubs return defaults)
- NO testing for NotYetImplemented — tests fail naturally
- NO reverse tests, NO mock theater
- 30% property-based tests using fast-check
- Each test MUST have @plan and @requirement markers

## RED/GREEN EVIDENCE MANDATE

After writing the test file and BEFORE implementing (P14), you MUST run tests and capture failure evidence:

```bash
npm test -- --testPathPattern="hookSemantics" 2>&1 | tee /tmp/p13-red-evidence.txt
grep -E "FAIL|● " /tmp/p13-red-evidence.txt | head -20
```

**Required**: Paste the captured failure output into the P13 completion marker file.
The completion marker is INVALID without RED evidence showing tests failed before P14.

## PROPERTY TEST QUALITY REQUIREMENTS

Property-based tests MUST encode metamorphic invariants with domain entropy — vacuous generators are BANNED:

**Banned patterns**:
```typescript
fc.array(fc.record({ shouldStop: fc.boolean() }))   // record without minLength on arrays
fc.option(fc.string())                               // generates null which may trivially pass
```

**Required metamorphic invariants for semantics tests**:
- `shouldStop === (∃ output where output.shouldStop === true)` — existential stop detection
- `normalizeStopReason(reason).length >= normalizeStopReason(reason).trim().length` — trim idempotency
- `emitPerHookLogs count >= hookResults.length` — log cardinality

## Requirements Implemented (Expanded)

### DELTA-HRUN-001 through DELTA-HRUN-004: processCommonHookOutputFields

**Behavior summary**:
- No hook output signals stop → shouldStop=false, stopReason=undefined
- First hook signals stop with reason → shouldStop=true, stopReason=normalized reason
- Multiple hooks signal stop → first wins
- Hook has systemMessage → systemMessage field populated
- Hook has suppressOutput → suppressOutput=true

### DELTA-HTEL-001: Per-hook logging

**Behavior summary**:
- Each hook result generates one log record with correct fields
- Failed hooks get additional failure_diagnostic record
- No log records when debugLogger not injected

### DELTA-HTEL-002: Batch summary

**Behavior summary**:
- One summary record per fired event
- hookCount, successCount, failureCount, totalDurationMs computed correctly
- No summary when debugLogger not injected

### DELTA-HFAIL-001: buildFailureEnvelope in catch blocks

**Behavior summary**:
- Any thrown error in executeHooksCore returns failure envelope (not EMPTY_SUCCESS_RESULT)
- Failure envelope has success=false, errors array with message and stage

### DELTA-HAPP-001 + DELTA-HAPP-002: Caller-facing stop semantics

**Behavior summary**:
- ProcessedHookResult.shouldStop=true when any hook signals stop
- ProcessedHookResult.stopReason contains the normalized reason

## Implementation Tasks

### Files to Create

#### `packages/core/src/hooks/__tests__/hookSemantics.test.ts` (NEW)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P13
 * @requirement DELTA-HRUN-001, DELTA-HRUN-002, DELTA-HRUN-003, DELTA-HRUN-004,
 *              DELTA-HTEL-001, DELTA-HTEL-002, DELTA-HFAIL-001, DELTA-HAPP-001, DELTA-HAPP-002
 */
```

Write 15–20 behavioral tests:

**Test Group 1: processCommonHookOutputFields — stop semantics (DELTA-HRUN-002, DELTA-HAPP-001/002)**

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P13
 * @requirement DELTA-HRUN-002
 * @scenario First hook signals stop
 * @given aggregated result with hookOutput that signals stop with reason 'token limit'
 * @when processCommonHookOutputFields called
 * @then shouldStop=true, stopReason='token limit'
 */
it('surfaces stop intent from first hook @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  const aggregated = buildAggregated([
    { shouldStop: true, stopReason: 'token limit' },
    { shouldStop: false }
  ]);
  const result = processCommonHookOutputFields(aggregated);
  expect(result.shouldStop).toBe(true);
  expect(result.stopReason).toBe('token limit');
});

it('first stop intent wins when multiple hooks signal stop @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  const aggregated = buildAggregated([
    { shouldStop: true, stopReason: 'first reason' },
    { shouldStop: true, stopReason: 'second reason' }
  ]);
  const result = processCommonHookOutputFields(aggregated);
  expect(result.stopReason).toBe('first reason');
});

it('no stop when no hooks signal stop @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  const aggregated = buildAggregated([{ shouldStop: false }, { shouldStop: false }]);
  const result = processCommonHookOutputFields(aggregated);
  expect(result.shouldStop).toBe(false);
  expect(result.stopReason).toBeUndefined();
});
```

**Test Group 2: systemMessage and suppressOutput (DELTA-HRUN-003)**

```typescript
it('extracts systemMessage from hook output @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  const aggregated = buildAggregated([{ systemMessage: 'info: rate limited' }]);
  const result = processCommonHookOutputFields(aggregated);
  expect(result.systemMessage).toBe('info: rate limited');
});

it('sets suppressOutput when hook output specifies it @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  const aggregated = buildAggregated([{ systemMessage: 'msg', suppressOutput: true }]);
  const result = processCommonHookOutputFields(aggregated);
  expect(result.suppressOutput).toBe(true);
});
```

**Test Group 3: No hook outputs (empty batch)**

```typescript
it('returns safe defaults for empty allOutputs @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  const aggregated = buildAggregated([]);
  const result = processCommonHookOutputFields(aggregated);
  expect(result.shouldStop).toBe(false);
  expect(result.stopReason).toBeUndefined();
  expect(result.systemMessage).toBeUndefined();
  expect(result.suppressOutput).toBe(false);
});
```

**Test Group 4: stopReason normalization**

```typescript
it('trims whitespace from stopReason @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  const aggregated = buildAggregated([{ shouldStop: true, stopReason: '  whitespace  ' }]);
  const result = processCommonHookOutputFields(aggregated);
  expect(result.stopReason).toBe('whitespace');
});

it('normalizes undefined stopReason to undefined @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  const aggregated = buildAggregated([{ shouldStop: true, stopReason: undefined }]);
  const result = processCommonHookOutputFields(aggregated);
  expect(result.stopReason).toBeUndefined();
});
```

**Test Group 5: Logging (DELTA-HTEL-001, DELTA-HTEL-002)**

```typescript
it('emits one log record per hook result when logger injected @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  const logRecords: unknown[] = [];
  const debugLogger = { log: (channel: string, record: unknown) => logRecords.push({ channel, record }) };
  // execute hooks with debugLogger
  // verify logRecords has one 'hook:result' per hook
  expect(logRecords.filter(r => (r as any).channel === 'hook:result').length).toBe(2);
});

it('emits one batch_summary record per event @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  const logRecords: unknown[] = [];
  // execute, verify exactly one 'hook:batch_summary'
  expect(logRecords.filter(r => (r as any).channel === 'hook:batch_summary').length).toBe(1);
});

it('no log records when debugLogger absent @plan:PLAN-20250218-HOOKSYSTEM.P13', () => {
  // construct without debugLogger, execute hooks
  // no log side effects; test that execution completes without error
  // (indirect: test via executing without logger injection)
});
```

**Test Group 6: buildFailureEnvelope (DELTA-HFAIL-001)**

```typescript
it('catch block returns failure envelope not empty success @plan:PLAN-20250218-HOOKSYSTEM.P13', async () => {
  // Inject broken runner that throws
  // Execute; verify returned result has success=false
  const result = await hookEventHandler.fireBeforeToolEvent({ toolName: 'x', toolInput: {} });
  // If runner throws, we get failure envelope
  expect(result.success).toBe(false);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toHaveProperty('stage');
  expect(result.errors[0]).toHaveProperty('message');
});
```

**Property-Based Tests (30% minimum = ~5 of 17 tests)**:

Each property test encodes a metamorphic invariant with domain-constrained generators.

```typescript
import * as fc from 'fast-check';

// METAMORPHIC INVARIANT 1: shouldStop is exactly the existential OR of all hook stop signals
// Domain: non-empty arrays of hook output records with defined stop fields
test.prop([
  fc.array(
    fc.record({
      shouldStop: fc.boolean(),                          // domain: full boolean
      stopReason: fc.option(fc.string({ minLength: 1 })) // domain: non-empty strings or null
    }),
    { minLength: 1, maxLength: 8 }                       // non-empty arrays (minLength=1)
  )
])(
  'METAMORPHIC: shouldStop=true iff at least one hook output signals stop @plan:PLAN-20250218-HOOKSYSTEM.P13',
  (outputs) => {
    // Invariant: processCommonHookOutputFields(x).shouldStop === outputs.some(o => o.shouldStop)
    const aggregated = buildAggregated(outputs);
    const result = processCommonHookOutputFields(aggregated);
    const expectedStop = outputs.some(o => o.shouldStop === true);
    expect(result.shouldStop).toBe(expectedStop);
  }
);

// METAMORPHIC INVARIANT 2: normalizeStopReason is trim-idempotent (result is already trimmed)
// Domain: strings with realistic whitespace patterns
test.prop([
  fc.oneof(
    fc.string({ minLength: 1, maxLength: 100 }),                           // plain strings
    fc.string({ minLength: 1, maxLength: 50 }).map(s => `  ${s}  `),       // padded strings
    fc.string({ minLength: 1, maxLength: 50 }).map(s => `	${s}
`),       // tab-newline padded
  )
])(
  'METAMORPHIC: normalizeStopReason output is trim-idempotent @plan:PLAN-20250218-HOOKSYSTEM.P13',
  (reason) => {
    // Invariant: normalizeStopReason(s) === normalizeStopReason(s).trim()
    const aggregated = buildAggregated([{ shouldStop: true, stopReason: reason }]);
    const result = processCommonHookOutputFields(aggregated);
    if (result.stopReason !== undefined) {
      // The result is already trimmed — applying trim again produces identical string
      expect(result.stopReason).toBe(result.stopReason.trim());
    }
  }
);

// METAMORPHIC INVARIANT 3: log record count >= hook count (failures emit extra diagnostic)
// Domain: bounded arrays of success flags with realistic hook durations
test.prop([
  fc.array(
    fc.record({
      success: fc.boolean(),
      durationMs: fc.integer({ min: 0, max: 5000 })  // realistic duration domain
    }),
    { minLength: 0, maxLength: 8 }
  )
])(
  'METAMORPHIC: emitPerHookLogs emits at least one record per hook result @plan:PLAN-20250218-HOOKSYSTEM.P13',
  (hookResultShapes) => {
    // Invariant: logRecords.length >= hookResults.length (failures add extra diagnostic)
    const hookResults = hookResultShapes.map((s, i) => ({
      success: s.success,
      hookName: `hook-${i}`,
      durationMs: s.durationMs
    }));
    const logRecords: Array<{ channel: string; record: unknown }> = [];
    const debugLogger = { log: (channel: string, record: unknown) => logRecords.push({ channel, record }) };
    emitPerHookLogs(HookEventName.BeforeTool, hookResults, debugLogger);
    // Invariant: each hook gets at least one record; failed hooks get an additional diagnostic
    expect(logRecords.length).toBeGreaterThanOrEqual(hookResultShapes.length);
  }
);
```

## Verification Commands

```bash
# Test file exists
ls packages/core/src/hooks/__tests__/hookSemantics.test.ts

# Test count
TOTAL=$(grep -c "^\s*it(\|test\.prop(" packages/core/src/hooks/__tests__/hookSemantics.test.ts)
[ "$TOTAL" -ge 15 ] && echo "PASS: $TOTAL tests" || echo "FAIL: $TOTAL"

# Property tests
PROPERTY=$(grep -cE "test\.prop|fc\.assert|fc\.property" \
  packages/core/src/hooks/__tests__/hookSemantics.test.ts)
PERCENTAGE=$((PROPERTY * 100 / TOTAL))
[ "$PERCENTAGE" -ge 30 ] && echo "PASS: $PERCENTAGE%" || echo "FAIL: $PERCENTAGE%"

# Requirements covered
for req in "DELTA-HRUN-001" "DELTA-HRUN-002" "DELTA-HRUN-003" "DELTA-HRUN-004" \
           "DELTA-HTEL-001" "DELTA-HTEL-002" "DELTA-HFAIL-001"; do
  grep -q "$req" packages/core/src/hooks/__tests__/hookSemantics.test.ts && \
    echo "PASS: $req" || echo "FAIL: $req"
done

# RED/GREEN EVIDENCE: capture failures BEFORE P14 implementation
npm test -- --testPathPattern="hookSemantics" 2>&1 | tee /tmp/p13-red-evidence.txt
grep "NotYetImplemented" /tmp/p13-red-evidence.txt && echo "FAIL: NYI in failures" || echo "PASS: Natural failures"
grep -E "FAIL|● " /tmp/p13-red-evidence.txt | head -20
# Expected: multiple ● failure lines showing stub defaults causing test failures
# REQUIREMENT: paste this output into .completed/P13.md — INVALID without RED evidence

# No mock theater
grep -cE "toHaveBeenCalled\b" packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 0 (verify log records directly, not mock calls)

# Behavioral assertions
grep -cE "toBe\(|toEqual\(|toStrictEqual\(|toContain\(" \
  packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 12+
```

### Property Test Quality

```bash
# No vacuous generators in property tests
grep -E "\bfc\.object\(\)|\bfc\.anything\(\)" \
  packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 0 (banned generators absent)

# Metamorphic invariant comments present
grep -c "METAMORPHIC\|metamorphic\|Invariant\|invariant" \
  packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 3+ (one per property test)

# Domain-constrained array generators (minLength specified)
grep -E "minLength|maxLength|min:|max:|integer\(|constantFrom\(" \
  packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 5+ constraint applications
```

### AST / Static Checks

```bash
# No placeholder empty returns in test helpers
grep -E "return \[\]|return \{\}|return null" \
  packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 0

# No fc.option() with string (generates null, trivially passes type checks)
grep -E "fc\.option\(fc\.string\(\)\)" \
  packages/core/src/hooks/__tests__/hookSemantics.test.ts
# Expected: 0 — use fc.option(fc.string({ minLength: 1 })) instead
```

## Success Criteria

- 15+ behavioral tests
- 5+ property-based (30%+)
- Tests fail naturally on stub defaults
- No mock theater (log records verified by content, not mock calls)
- All 7 requirements tagged

## Failure Recovery

1. If test verifies log mock calls: rewrite to capture log records and verify content
2. If tests are checking structure not values: add specific value assertions
3. Cannot proceed to P14 until all checks pass

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P13.md`
