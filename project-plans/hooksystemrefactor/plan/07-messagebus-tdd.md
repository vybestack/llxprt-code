# Phase 07: MessageBus TDD

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P07`

## Prerequisites

- Required: Phase 06a (MessageBus stub verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P06" packages/core/src/hooks/`
- hookBusContracts.ts must exist with both interfaces exported

## MANDATORY TDD RULES

- Tests expect REAL BEHAVIOR that does not yet exist
- NO testing for NotYetImplemented — tests fail naturally (with "undefined" or "not called")
- NO reverse tests (expect().not.toThrow())
- NO mock theater — tests verify actual bus messages, not mock configurations
- 30% of tests MUST be property-based using fast-check
- Each test MUST have @plan and @requirement markers

## RED/GREEN EVIDENCE MANDATE

After writing the test file and BEFORE implementing (P08), you MUST run tests and capture failure evidence:

```bash
npm test -- --testPathPattern="hookEventHandler-messagebus" 2>&1 | tee /tmp/p07-red-evidence.txt
grep -E "FAIL|● " /tmp/p07-red-evidence.txt | head -20
```

**Required**: Paste the captured failure output into the P07 completion marker file.
The completion marker is INVALID without RED evidence showing tests failed before P08.

## PROPERTY TEST QUALITY REQUIREMENTS

Property-based tests MUST encode metamorphic invariants with domain entropy — vacuous generators are BANNED:

**Banned patterns**:
```typescript
fc.object()        // zero domain entropy
fc.anything()      // too wide
fc.string()        // without minLength — allows empty correlationId
```

**Required metamorphic invariants**:
- `f(request with correlationId X).correlationId === X` for all non-empty X (correlation echo)
- `f(request) produces exactly 1 response` for any valid request (response cardinality)
- `f(invalid eventName).success === false` for all invalid names (uniform failure shape)

## Requirements Implemented (Expanded)

### DELTA-HEVT-001: MessageBus subscription

**Full Text**: HookEventHandler SHALL subscribe to MessageBus HOOK_EXECUTION_REQUEST
**Behavior**:
- GIVEN: HookEventHandler constructed with a real MessageBus
- WHEN: A HOOK_EXECUTION_REQUEST is published to the bus
- THEN: HookEventHandler's handler is invoked with the message
**Test Strategy**: Use real (or minimal fake) MessageBus; publish message; verify processing occurred

### DELTA-HEVT-002: HOOK_EXECUTION_RESPONSE published with same correlationId

**Full Text**: When request received, SHALL publish response with same correlationId
**Behavior**:
- GIVEN: HOOK_EXECUTION_REQUEST with correlationId 'test-correlation-123'
- WHEN: Handler processes it
- THEN: HOOK_EXECUTION_RESPONSE published with correlationId 'test-correlation-123'
**Test Strategy**: Subscribe to HOOK_EXECUTION_RESPONSE; verify echoed correlationId

### DELTA-HEVT-003: Unsupported event name → failure response

**Full Text**: When mediated request references unsupported event name, SHALL publish failed response
**Behavior**:
- GIVEN: HOOK_EXECUTION_REQUEST with eventName='UnknownEvent'
- WHEN: Handler processes it
- THEN: Failure response published, no exception escapes bus boundary
**Test Strategy**: Publish unsupported event; verify failure response with code 'unsupported_event'

### DELTA-HBUS-002: Bus-absent direct path unchanged

**Full Text**: If MessageBus unavailable, hook execution SHALL continue via direct fire-event methods
**Behavior**:
- GIVEN: HookEventHandler constructed WITHOUT messageBus
- WHEN: fireBeforeToolEvent() called directly
- THEN: Executes normally (same result as with bus)
**Test Strategy**: Construct without bus; call fire*Event; verify result

### DELTA-HBUS-003: correlationId generation

**Full Text**: Missing correlationId → handler generates one via crypto.randomUUID()
**Behavior**:
- GIVEN: HOOK_EXECUTION_REQUEST arrives without correlationId field
- WHEN: Handler processes it
- THEN: Response correlationId is a valid UUID (not empty string)
**Test Strategy**: Publish request without correlationId; capture response; verify UUID format

### DELTA-HPAY-003: Model payload translation on both paths

**Full Text**: Translation for BeforeModel/AfterModel/BeforeToolSelection on BOTH paths
**Behavior**:
- GIVEN: fireBeforeModelEvent({ modelRequest: {model: 'gpt-4'} }) called
- WHEN: Execution proceeds
- THEN: hookTranslator.translateBeforeModelRequest is called with model_request
- GIVEN: HOOK_EXECUTION_REQUEST with eventName='BeforeModel' on bus
- WHEN: Handler processes it
- THEN: hookTranslator.translateBeforeModelRequest is called

## Implementation Tasks

### Files to Create

#### `packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts` (NEW)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P07
 * @requirement DELTA-HEVT-001, DELTA-HEVT-002, DELTA-HEVT-003, DELTA-HBUS-002, DELTA-HBUS-003, DELTA-HPAY-003
 */
```

Write 15–20 behavioral tests:

**Test Group 1: Subscription and routing (DELTA-HEVT-001)**
- Test: Handler subscribes to HOOK_EXECUTION_REQUEST on construction with MessageBus
- Test: Publishing HOOK_EXECUTION_REQUEST triggers handler processing
- Test: Handler does NOT subscribe when MessageBus is absent
- Test: After dispose(), handler ignores new HOOK_EXECUTION_REQUEST messages

**Test Group 2: Correlated responses (DELTA-HEVT-002)**
- Test: Response correlationId matches request correlationId exactly
- Test: Successful execution produces response with success=true
- Test: Failed execution produces response with success=false and error details
- PROPERTY: for any correlationId string, it is echoed verbatim in response

**Test Group 3: Unsupported event name (DELTA-HEVT-003)**
- Test: Unknown eventName produces failed response with code 'unsupported_event'
- Test: Unknown eventName does NOT throw from handler
- Test: Failed response still contains the original correlationId

**Test Group 4: Bus-absent fallback (DELTA-HBUS-002)**
- Test: fire*Event() works normally when constructed without MessageBus
- Test: No subscription-related errors when no MessageBus provided

**Test Group 5: correlationId generation (DELTA-HBUS-003)**
- Test: Missing correlationId in request generates a UUID in response
- Test: Generated UUID is non-empty and matches UUID format
- PROPERTY: for any request without correlationId, response always has non-empty correlationId

**Test Group 6: Model translation both paths (DELTA-HPAY-003)**
- Test: fireBeforeModelEvent triggers hookTranslator.translateBeforeModelRequest
- Test: BeforeModel via bus triggers model translation before execution
- Test: Translation failure produces structured failure response

**Property-Based Tests (30% = ~5 of 17 tests)**:

Each property test encodes a metamorphic invariant with domain-constrained generators.

```typescript
import * as fc from 'fast-check';

// METAMORPHIC INVARIANT 1: correlationId is echoed VERBATIM for any non-empty string
// Domain: non-empty alphanumeric strings (realistic correlation ID domain)
test.prop([
  fc.string({ minLength: 1, maxLength: 128 }).filter(s => s.trim().length > 0)
])(
  'METAMORPHIC: correlationId echoed verbatim in response @plan:PLAN-20250218-HOOKSYSTEM.P07',
  async (correlationId) => {
    // Invariant: f(correlationId) → response.correlationId === correlationId (echo property)
    const response = await publishAndCapture({
      eventName: 'BeforeTool',
      input: { tool_name: 'test_tool', tool_input: { path: '/tmp/x' } },
      correlationId
    });
    expect(response.correlationId).toBe(correlationId);
  }
);

// METAMORPHIC INVARIANT 2: exactly one response per request (cardinality invariant)
// Domain: all valid HookEventNames (enum values, not arbitrary strings)
test.prop([
  fc.constantFrom(...Object.values(HookEventName)),  // domain = valid enum values only
  fc.string({ minLength: 1, maxLength: 64 })         // non-empty correlationId
])(
  'METAMORPHIC: exactly one response per request for any valid event name @plan:PLAN-20250218-HOOKSYSTEM.P07',
  async (eventName, correlationId) => {
    // Invariant: |responses| === 1 regardless of event type
    const responses: HookExecutionResponse[] = [];
    const unsubscribe = bus.subscribe(HOOK_EXECUTION_RESPONSE, (msg) => responses.push(msg));
    await bus.publish(HOOK_EXECUTION_REQUEST, {
      eventName,
      input: buildValidInputFor(eventName),
      correlationId
    });
    await waitForResponse();
    unsubscribe();
    expect(responses).toHaveLength(1);
  }
);

// METAMORPHIC INVARIANT 3: invalid event names always produce failure response (uniform failure shape)
// Domain: strings that are NOT valid HookEventName values
test.prop([
  fc.string({ minLength: 1, maxLength: 64 }).filter(
    s => !Object.values(HookEventName).includes(s as HookEventName)
  ),
  fc.string({ minLength: 1, maxLength: 64 })  // correlationId
])(
  'METAMORPHIC: invalid event name always produces success=false response @plan:PLAN-20250218-HOOKSYSTEM.P07',
  async (invalidEventName, correlationId) => {
    // Invariant: ∀ invalid name → response.success === false (uniform failure mapping)
    const response = await publishAndCapture({
      eventName: invalidEventName,
      input: {},
      correlationId
    });
    expect(response.success).toBe(false);
    expect(response.correlationId).toBe(correlationId);
  }
);
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P07
 * @requirement DELTA-HEVT-002
 * @scenario correlationId echoed in response
 * @given HOOK_EXECUTION_REQUEST with correlationId 'abc-123'
 * @when handler processes the message
 * @then response.correlationId === 'abc-123'
 */
```

## Verification Commands

### Test Existence and Quality

```bash
# Test file exists
ls packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts

# Test count
grep -c "^\s*it(\|test\.prop(" packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 15+

# Property test count
grep -cE "test\.prop|fc\.assert|fc\.property" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 5+

# All requirements tagged
for req in "DELTA-HEVT-001" "DELTA-HEVT-002" "DELTA-HEVT-003" "DELTA-HBUS-002" "DELTA-HBUS-003" "DELTA-HPAY-003"; do
  grep -q "$req" packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts || \
    echo "FAIL: $req not covered"
done

# RED/GREEN EVIDENCE: run tests and capture failure output BEFORE P08
npm test -- --testPathPattern="hookEventHandler-messagebus" 2>&1 | tee /tmp/p07-red-evidence.txt
grep -E "FAIL|● " /tmp/p07-red-evidence.txt | head -20
# Expected: multiple ● failure lines — stubs haven't implemented bus subscription yet
# REQUIREMENT: paste this output into .completed/P07.md — INVALID without RED evidence

# Tests fail naturally (not NotYetImplemented)
grep "NotYetImplemented" /tmp/p07-red-evidence.txt && echo "FAIL: NYI in failures" || echo "PASS: Natural failures"
```

### Property Test Quality

```bash
# No vacuous generators in property tests
grep -E "\bfc\.object\(\)|\bfc\.anything\(\)" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 0 (banned generators absent)

# Metamorphic invariant comments present
grep -c "METAMORPHIC\|metamorphic\|Invariant\|invariant" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 3+ (one per property test)

# Domain-constrained generators used
grep -E "minLength|maxLength|min:|max:|constantFrom\(|filter\(" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 5+ constraint applications
```

### AST / Static Checks

```bash
# No placeholder empty returns in test helpers
grep -E "return \[\]|return \{\}|return null" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 0

# Behavioral assertions on actual bus message content (not mock calls only)
grep -cE "toBe\(|toEqual\(|toStrictEqual\(|toHaveLength\(" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 12+ concrete value assertions on response message fields
```

### Anti-Fraud Checks

```bash
# No mock theater (checking BEHAVIOR via real bus messages, not mock calls)
grep -rn "toHaveBeenCalled\b" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts | head -5
# Note: some mock/spy usage acceptable for hookTranslator verification
# but response content verification should use actual bus message capture

# No reverse testing
grep -E "NotYetImplemented|\.not\.toThrow\(\)" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 0 matches

# Behavioral assertions present
grep -c "toBe(\|toEqual(\|toStrictEqual(\|toMatch(\|toContain(" \
  packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts
# Expected: 12+
```

## Success Criteria

- 15+ behavioral tests
- 5+ property-based tests (30%+)
- Tests fail naturally on stubs
- No mock theater for core bus behavior
- All requirements tagged
- TypeScript compiles

## Failure Recovery

1. `git checkout -- packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts`
2. Re-read specification sections DELTA-HEVT and DELTA-HBUS
3. Rewrite tests to verify actual bus message contents, not mock calls

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P07.md`
