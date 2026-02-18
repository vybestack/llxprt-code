# Phase 10: Validation TDD

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P10`

## Prerequisites

- Required: Phase 09a (validation stub verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P09" packages/core/src/hooks/`
- hookValidators.ts must exist with all 10 stub functions

## MANDATORY TDD RULES

- Tests expect REAL BEHAVIOR that does not yet exist
- NO testing for NotYetImplemented — tests fail naturally (validators return false for valid inputs)
- NO reverse tests
- NO mock theater
- 30% property-based tests using fast-check
- Each test MUST have @plan and @requirement markers

## RED/GREEN EVIDENCE MANDATE

After writing the test file and BEFORE implementing (P11), you MUST run tests and capture evidence of failure:

```bash
npm test -- --testPathPattern="hookValidators" 2>&1 | tee /tmp/p10-red-evidence.txt
grep -E "FAIL|failed|● " /tmp/p10-red-evidence.txt | head -20
```

**Required**: Paste the captured failure output into the P10 completion marker file.
The completion marker is INVALID without RED evidence showing tests were failing before P11.

## PROPERTY TEST QUALITY REQUIREMENTS

Property-based tests MUST meet these standards — vacuous generators are BANNED:

**Banned patterns** (zero domain entropy):
```typescript
// BANNED: always produces empty object — no entropy
fc.object()
// BANNED: fc.anything() with no constraint — generates non-objects
fc.anything()
// BANNED: string without minLength — generates empty string which may trivially pass/fail
fc.string()
```

**Required patterns** (domain entropy):
```typescript
// REQUIRED: constrained string with domain meaning
fc.string({ minLength: 1, maxLength: 100 })  // non-empty name
fc.record({ tool_name: fc.string({ minLength: 1 }), tool_input: fc.record({}) })  // shaped object

// REQUIRED: metamorphic invariants (not just "doesn't crash")
// Example: adding extra fields should NOT change validator result (toleration rule)
// Example: removing required field ALWAYS fails (monotone failure)
// Example: swapping a field from string to number ALWAYS fails type check
```

**Metamorphic invariant requirement**: Each property test MUST encode an invariant of the form:
- `f(transform(x)) === f(x)` (extra-fields toleration)
- `f(degrade(x)) === false` (removal of required field → always false)
- `f(x) → f(x ∪ {extra})` (adding extra fields does not break valid payload)

## Requirements Implemented (Expanded)

### DELTA-HPAY-001: Runtime validation for all 8 event families

**Full Text**: SHALL perform runtime validation at mediated boundaries for all 8 event families
**Behavior**:
- GIVEN: BeforeTool payload with tool_name='read_file' and tool_input={}
- WHEN: validateBeforeToolInput(payload) called
- THEN: Returns true (valid); input narrowed to BeforeToolInput
**Test Strategy**: Call each validator with valid input; verify returns true and TypeScript narrows

### DELTA-HPAY-002: Validation failure prevents execution

**Full Text**: If validation fails, return structured failure; SHALL NOT execute planner/runner
**Behavior**:
- GIVEN: BeforeTool payload missing tool_name
- WHEN: validateBeforeToolInput(payload) called
- THEN: Returns false
- GIVEN: Mediated request with missing tool_name arrives on bus
- WHEN: Handler processes it
- THEN: Failure response published with code 'validation_failure'; planner never called
**Test Strategy**: Publish invalid mediated request; verify failure response; verify hooks not invoked

### DELTA-HPAY-005: Type predicates

**Full Text**: Each validator SHALL be a TypeScript type predicate
**Behavior**:
- GIVEN: Input passes validateBeforeToolInput
- WHEN: Code after the guard uses the input
- THEN: TypeScript narrows type to BeforeToolInput (compile-time check)
**Test Strategy**: Compile-time verification by TypeScript; runtime: verify true/false returns

## Implementation Tasks

### Files to Create

#### `packages/core/src/hooks/__tests__/hookValidators.test.ts` (NEW)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P10
 * @requirement DELTA-HPAY-001, DELTA-HPAY-002, DELTA-HPAY-005
 */
```

Write 15–20 behavioral tests:

**Test Group 1: BeforeTool validator**
```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P10
 * @requirement DELTA-HPAY-001
 * @scenario Valid BeforeTool input
 * @given { tool_name: 'read_file', tool_input: { path: '/tmp/x.txt' } }
 * @when validateBeforeToolInput called
 * @then returns true
 */
it('validateBeforeToolInput accepts valid payload @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  expect(validateBeforeToolInput({ tool_name: 'read_file', tool_input: { path: '/tmp/x.txt' } })).toBe(true);
});

it('validateBeforeToolInput rejects missing tool_name @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  expect(validateBeforeToolInput({ tool_input: {} })).toBe(false);
});

it('validateBeforeToolInput rejects missing tool_input @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  expect(validateBeforeToolInput({ tool_name: 'x' })).toBe(false);
});

it('validateBeforeToolInput rejects non-object tool_input @plan:PLAN-20250218-HOOKSYSTEM.P10', () => {
  expect(validateBeforeToolInput({ tool_name: 'x', tool_input: 'string' })).toBe(false);
});
```

**Test Group 2: AfterTool validator**
- Valid: tool_name, tool_input (Record), tool_response (any) → true
- Invalid: missing tool_response → false

**Test Group 3: BeforeModel / AfterModel / BeforeToolSelection validators**
- Valid: model_request (Record) present → true
- Invalid: model_request absent → false

**Test Group 4: Notification validator**
- Valid: message (string) present → true
- Invalid: message absent → false
- Invalid: message not a string → false

**Test Group 5: BeforeAgent / AfterAgent validators**
- At minimum: accepts empty object (base fields only) → true
- Rejects non-object → false

**Test Group 6: Mediated path validation gate integration**
- Mediated request with invalid payload → failure response with 'validation_failure' code
- Mediated request with valid payload → success OR proceeds to execution (not validation failure)

**Property-Based Tests (30% = ~5 of 17 tests)**:

Each property test encodes a metamorphic invariant — not just "doesn't crash".

```typescript
import * as fc from 'fast-check';

// METAMORPHIC INVARIANT 1: extra fields never break a valid payload (toleration)
// Domain entropy: real tool names + real input record shapes + extra scalar fields
test.prop([
  fc.string({ minLength: 1, maxLength: 64 }),  // non-empty tool name
  fc.record({                                   // shaped input record (not fc.object())
    path: fc.string({ minLength: 1 }),
    encoding: fc.constantFrom('utf8', 'binary', 'base64'),
  }),
  fc.record({                                   // extra fields: scalar values only (no clash risk)
    extra_flag: fc.boolean(),
    extra_count: fc.integer({ min: 0, max: 999 }),
  })
])(
  'METAMORPHIC: validateBeforeToolInput(valid ∪ extra) === validateBeforeToolInput(valid) @plan:PLAN-20250218-HOOKSYSTEM.P10',
  (toolName, toolInput, extraFields) => {
    const base = { tool_name: toolName, tool_input: toolInput };
    const withExtra = { ...base, ...extraFields };
    // both must agree: extra fields do not change the validity verdict
    expect(validateBeforeToolInput(withExtra)).toBe(validateBeforeToolInput(base));
  }
);

// METAMORPHIC INVARIANT 2: removing required field ALWAYS fails (monotone failure)
// Domain entropy: wide range of non-empty tool names and shaped inputs
test.prop([
  fc.string({ minLength: 1, maxLength: 64 }),
  fc.record({ path: fc.string({ minLength: 1 }) })
])(
  'METAMORPHIC: validateBeforeToolInput fails when tool_name removed @plan:PLAN-20250218-HOOKSYSTEM.P10',
  (toolName, toolInput) => {
    const valid = { tool_name: toolName, tool_input: toolInput };
    const degraded = { tool_input: toolInput };           // required field removed
    expect(validateBeforeToolInput(valid)).toBe(true);   // valid baseline
    expect(validateBeforeToolInput(degraded)).toBe(false); // degraded always fails
  }
);

// METAMORPHIC INVARIANT 3: all validators uniformly reject non-object primitives
// Domain entropy: wide sample of primitives including edge cases
test.prop([
  fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.integer(),
    fc.boolean(),
    fc.float(),
    fc.string({ maxLength: 10 })  // strings are primitives, not objects
  )
])(
  'METAMORPHIC: all validators reject any primitive input @plan:PLAN-20250218-HOOKSYSTEM.P10',
  (primitive) => {
    expect(validateBeforeToolInput(primitive)).toBe(false);
    expect(validateAfterToolInput(primitive)).toBe(false);
    expect(validateBeforeModelInput(primitive)).toBe(false);
    expect(validateNotificationInput(primitive)).toBe(false);
  }
);

// METAMORPHIC INVARIANT 4: Notification validator accepts any non-empty string message,
// no matter what extra fields are present (toleration + positive path)
test.prop([
  fc.string({ minLength: 1, maxLength: 200 }),   // non-empty message (domain constraint)
  fc.record({ severity: fc.constantFrom('info', 'warn', 'error') })  // realistic extra
])(
  'METAMORPHIC: validateNotificationInput passes for any non-empty message string @plan:PLAN-20250218-HOOKSYSTEM.P10',
  (message, extra) => {
    const payload = { message, ...extra };
    expect(validateNotificationInput(payload)).toBe(true);
  }
);

// METAMORPHIC INVARIANT 5: empty string is never a valid message for Notification
test.prop([
  fc.record({ severity: fc.constantFrom('info', 'warn', 'error') })  // extra realistic fields
])(
  'METAMORPHIC: validateNotificationInput rejects empty string message @plan:PLAN-20250218-HOOKSYSTEM.P10',
  (extra) => {
    expect(validateNotificationInput({ message: '', ...extra })).toBe(false);
  }
);
```

## Verification Commands

### Test Quality

```bash
# Test file exists
ls packages/core/src/hooks/__tests__/hookValidators.test.ts

# Test count
TOTAL=$(grep -c "^\s*it(\|test\.prop(" packages/core/src/hooks/__tests__/hookValidators.test.ts)
[ "$TOTAL" -ge 15 ] && echo "PASS: $TOTAL tests" || echo "FAIL: Only $TOTAL"

# Property-based count
PROPERTY=$(grep -cE "test\.prop|fc\.assert|fc\.property" \
  packages/core/src/hooks/__tests__/hookValidators.test.ts)
PERCENTAGE=$((PROPERTY * 100 / TOTAL))
[ "$PERCENTAGE" -ge 30 ] && echo "PASS: $PERCENTAGE% property" || echo "FAIL: $PERCENTAGE%"

# Requirements covered
for req in "DELTA-HPAY-001" "DELTA-HPAY-002" "DELTA-HPAY-005"; do
  grep -q "$req" packages/core/src/hooks/__tests__/hookValidators.test.ts && \
    echo "PASS: $req" || echo "FAIL: $req missing"
done

# RED/GREEN EVIDENCE: tests must be FAILING before P11 runs
# Capture and save failure evidence:
npm test -- --testPathPattern="hookValidators" 2>&1 | tee /tmp/p10-red-evidence.txt
grep "NotYetImplemented" /tmp/p10-red-evidence.txt && echo "FAIL: NotYetImplemented in failures" || echo "PASS"
grep -E "FAIL|● " /tmp/p10-red-evidence.txt | head -20
# Expected: multiple ● failure lines from stub returning false for valid inputs
# REQUIREMENT: paste this output into .completed/P10.md — completion marker is INVALID without it

# Boundary validation strictness: tests verify BLOCKING behavior (not just return value)
grep -c "VALIDATION_FAILURE\|validation.*failure\|blocks.*execut\|planner.*not.*called" \
  packages/core/src/hooks/__tests__/hookValidators.test.ts
# Expected: 2+ tests checking that invalid payload blocks downstream execution

# No mock theater
grep -cE "toHaveBeenCalled\b" packages/core/src/hooks/__tests__/hookValidators.test.ts
# Expected: 0 (validators are pure functions; no mock theater needed)

# No reverse testing
grep -E "NotYetImplemented|\.not\.toThrow\(\)" packages/core/src/hooks/__tests__/hookValidators.test.ts
# Expected: 0

# PROPERTY TEST QUALITY: no vacuous generators
grep -E "\bfc\.object\(\)\|\bfc\.anything\(\)" \
  packages/core/src/hooks/__tests__/hookValidators.test.ts
# Expected: 0 (fc.object() and fc.anything() BANNED in property tests)

# METAMORPHIC INVARIANTS: each property test has an invariant comment
grep -c "METAMORPHIC\|metamorphic\|invariant" \
  packages/core/src/hooks/__tests__/hookValidators.test.ts
# Expected: 5+ (one per property test)
```

### AST / Static Checks

```bash
# No placeholder empty returns in validators
grep -E "return \[\]|return \{\}|return null" \
  packages/core/src/hooks/hookValidators.ts
# Expected: 0 (validators return boolean type predicates, not empty collections/null)

# No silent fallback — validation gate uses buildFailureEnvelope not EMPTY_SUCCESS_RESULT
grep -n "return EMPTY_SUCCESS_RESULT" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 in validation gate path (all failures are explicit envelopes)

# Validation BLOCKS execution: planner/runner calls must be unreachable after false validation
grep -A 15 "validateEventPayload" packages/core/src/hooks/hookEventHandler.ts | \
  grep -E "return|buildFailureEnvelope"
# Expected: return with buildFailureEnvelope before any planner/runner call
```

## Success Criteria

- 15+ behavioral tests
- 5+ property-based tests (30%+)
- All 8 event family validators covered
- Tests fail naturally (validators return false for valid inputs at stub stage)
- No mock theater, no reverse testing
- All requirements tagged

## Failure Recovery

1. `git checkout -- packages/core/src/hooks/__tests__/hookValidators.test.ts`
2. Re-read validation-boundary.md pseudocode for required field specs
3. Rewrite tests to check actual true/false return values

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P10.md`
