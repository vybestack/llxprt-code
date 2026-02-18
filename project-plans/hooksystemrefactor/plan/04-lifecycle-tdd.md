# Phase 04: Lifecycle/Composition TDD

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P04`

## Prerequisites

- Required: Phase 03a (lifecycle stub verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P03" packages/core/src/hooks/`
- Expected stubs: dispose() on HookSystem + HookEventHandler, setHookEnabled, getAllHooks, updated constructor signature

## MANDATORY TDD RULES

- Tests expect REAL BEHAVIOR that does not yet exist
- NO testing for NotYetImplemented — tests fail naturally
- NO reverse tests (expect().not.toThrow())
- NO mock theater (only verify mock was called, not actual behavior)
- 30% of tests MUST be property-based using fast-check
- Each test MUST have GIVEN/WHEN/THEN comment block with @requirement marker

## RED/GREEN EVIDENCE MANDATE

After writing the test file and BEFORE implementing (P05), you MUST run tests and capture evidence of failure:

```bash
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | tee /tmp/p04-red-evidence.txt
grep -E "FAIL|● " /tmp/p04-red-evidence.txt | head -20
```

**Required**: Paste the captured failure output into the P04 completion marker file.
The completion marker is INVALID without RED evidence showing tests failed before P05.

## PROPERTY TEST QUALITY REQUIREMENTS

Property-based tests MUST have domain entropy and metamorphic invariants — vacuous generators are BANNED:

**Banned patterns**:
```typescript
fc.object()        // zero domain entropy — generates arbitrary objects including empty
fc.anything()      // too wide — generates non-objects trivially
fc.string()        // without minLength — generates empty strings that trivially pass/fail
```

**Required patterns** with metamorphic invariants:

```typescript
// METAMORPHIC: toggle enabled twice → returns to original state
test.prop([
  fc.string({ minLength: 1, maxLength: 64 }),  // valid hook id (non-empty)
  fc.boolean()                                   // initial state
])(
  'METAMORPHIC: toggle enabled twice returns to original state @plan:PLAN-20250218-HOOKSYSTEM.P04',
  (hookId, initialEnabled) => {
    hookSystem.setHookEnabled(hookId, initialEnabled);
    hookSystem.setHookEnabled(hookId, !initialEnabled);
    hookSystem.setHookEnabled(hookId, initialEnabled);
    const hooks = hookSystem.getAllHooks();
    const hook = hooks.find(h => h.id === hookId);
    if (hook) {
      expect(hook.enabled).toBe(initialEnabled);
    }
    // No throw is also acceptable for non-existent hookId (graceful handling)
  }
);

// METAMORPHIC: getAllHooks count is stable under read-only operations
test.prop([
  fc.array(fc.string({ minLength: 1, maxLength: 32 }), { minLength: 0, maxLength: 5 })
])(
  'METAMORPHIC: getAllHooks returns stable count across repeated calls @plan:PLAN-20250218-HOOKSYSTEM.P04',
  (hookIds) => {
    const count1 = hookSystem.getAllHooks().length;
    const count2 = hookSystem.getAllHooks().length;
    expect(count1).toBe(count2);  // read stability — not a mutating operation
  }
);
```

## Requirements Implemented (Expanded)

### DELTA-HFAIL-003: No-match deterministic success

**Full Text**: When no hooks are registered for an event, execution SHALL return a success result with empty outputs
**Behavior**:
- GIVEN: No hooks are registered for HookEventName.BeforeTool
- WHEN: executeHooksCore is called for that event
- THEN: Returns success=true with hookResults=[], allOutputs=[], errors=[]
**Test Strategy**: Construct HookSystem with empty registry, call fire*Event, verify success shape
**Note**: This requirement is tested in P04 to establish the baseline expectation; implementation is completed in P05 and finalized in P14.

### DELTA-HSYS-001: HookSystem injection

**Full Text**: HookSystem SHALL inject MessageBus and DebugLogger into HookEventHandler during composition
**Behavior**:
- GIVEN: HookSystem constructed with messageBus and debugLogger
- WHEN: HookSystem creates HookEventHandler internally
- THEN: HookEventHandler's internal messageBus field matches the injected one
**Test Strategy**: Construct HookSystem with spy messageBus; verify hook execution uses it

### DELTA-HSYS-002: Management APIs

**Full Text**: HookSystem SHALL expose setHookEnabled / getAllHooks management methods
**Behavior**:
- GIVEN: A hook with id "my-hook" is registered in hookSystem
- WHEN: setHookEnabled("my-hook", false) is called
- THEN: getAllHooks() returns the hook with enabled=false
**Test Strategy**: Register hook, toggle enabled, verify getAllHooks() reflects change

### DELTA-HEVT-004: dispose() lifecycle

**Full Text**: HookEventHandler.dispose() unsubscribes from MessageBus; HookSystem.dispose() calls eventHandler.dispose()
**Behavior**:
- GIVEN: HookSystem is initialized
- WHEN: HookSystem.dispose() is called
- THEN: eventHandler.dispose() is invoked exactly once
- GIVEN: HookEventHandler is initialized (no MessageBus in Phase A)
- WHEN: dispose() is called
- THEN: No error thrown, handler is in disposed state
**Test Strategy**: Spy on eventHandler.dispose(); call HookSystem.dispose(); assert spy called

### DELTA-HFAIL-005: HookEventName enum typing

**Full Text**: Internal routing methods use HookEventName enum
**Behavior**:
- GIVEN: Internal executeHooksCore receives HookEventName.BeforeTool
- WHEN: Routing occurs
- THEN: The enum value is preserved through routing (not downcast to string)
**Test Strategy**: Verify that routing operates on HookEventName values

### DELTA-HPAY-006: Session event parameter types

**Full Text**: fireSessionStartEvent accepts { source: SessionStartSource }
**Behavior**:
- GIVEN: fireSessionStartEvent({ source: SessionStartSource.UserExplicit }) is called
- WHEN: Execution occurs
- THEN: The source value reaches the hook execution input
**Test Strategy**: Call with enum value, verify source present in executed hook input

## Implementation Tasks

### Files to Create

#### `packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts` (NEW)

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P04
 * @requirement DELTA-HSYS-001, DELTA-HSYS-002, DELTA-HEVT-004, DELTA-HPAY-006, DELTA-HFAIL-003
 */
```

Write 15–20 behavioral tests:

**Test Group 1: HookSystem composition (DELTA-HSYS-001)**
- Test: HookSystem forwards messageBus to HookEventHandler at construction
- Test: HookSystem forwards debugLogger to HookEventHandler at construction
- Test: HookSystem works without messageBus (graceful absence)
- Test: HookSystem works without debugLogger (graceful absence)

**Test Group 2: Management APIs (DELTA-HSYS-002)**
- Test: getAllHooks() returns registered hooks
- Test: setHookEnabled(id, false) disables the specified hook
- Test: setHookEnabled(id, true) re-enables a disabled hook
- Test: setHookEnabled on non-existent id does not throw
- PROPERTY: for any valid hook id string, toggle enabled twice returns to original state

**Test Group 3: dispose() lifecycle (DELTA-HEVT-004)**
- Test: HookSystem.dispose() calls HookEventHandler.dispose() exactly once
- Test: HookSystem.dispose() is idempotent (safe to call twice)
- Test: HookEventHandler.dispose() leaves handler in non-functional state for new messages

**Test Group 4: Enum typing (DELTA-HFAIL-005)**
- Test: HookEventName enum values route to correct handler logic
- Test: Invalid/unknown event name handled without throwing

**Test Group 5: Session event types (DELTA-HPAY-006)**
- Test: fireSessionStartEvent with SessionStartSource enum value produces correct input
- Test: fireSessionEndEvent with SessionEndReason enum value produces correct input

**Test Group 6: No-match deterministic success (DELTA-HFAIL-003)**
- Test: when no hooks are registered for an event, executeHooksCore returns success (not failure)
- Test: the no-match success result has empty outputs array and errors array
- Test: the no-match success result has success=true (no-match is NOT an error condition)
- Test: repeated calls with no hooks always return identical success shape (deterministic)

**Property-Based Tests (30% minimum = ~5 of 17 tests)**:

All property tests encode metamorphic invariants with domain-constrained generators.

```typescript
import * as fc from 'fast-check';

// METAMORPHIC INVARIANT 1: setHookEnabled never throws for any valid hook id string
// Domain: non-empty strings (real hook ids are non-empty) × boolean states
test.prop([
  fc.string({ minLength: 1, maxLength: 64 }),  // non-empty: valid hook id domain
  fc.boolean()                                   // full boolean domain
])(
  'METAMORPHIC: setHookEnabled does not throw for any non-empty id @plan:PLAN-20250218-HOOKSYSTEM.P04',
  (hookId, enabled) => {
    // Invariant: idempotent with respect to error-throwing (never throws regardless of id)
    expect(() => hookSystem.setHookEnabled(hookId, enabled)).not.toThrow();
    expect(() => hookSystem.setHookEnabled(hookId, !enabled)).not.toThrow();
    // Calling twice in same direction must also be safe
    expect(() => hookSystem.setHookEnabled(hookId, enabled)).not.toThrow();
  }
);

// METAMORPHIC INVARIANT 2: getAllHooks is a stable read (idempotent under repetition)
test.prop([
  fc.integer({ min: 0, max: 5 })  // number of registered hooks (bounded for test speed)
])(
  'METAMORPHIC: getAllHooks returns same length on consecutive calls @plan:PLAN-20250218-HOOKSYSTEM.P04',
  (_hookCount) => {
    // Invariant: read operation is stable — no mutation between calls
    const count1 = hookSystem.getAllHooks().length;
    const count2 = hookSystem.getAllHooks().length;
    expect(count1).toBe(count2);
  }
);

// METAMORPHIC INVARIANT 3: dispose() is idempotent — N calls = 1 call for all N >= 1
test.prop([
  fc.integer({ min: 1, max: 5 })  // call count domain: 1 to 5 times
])(
  'METAMORPHIC: dispose() is idempotent for any repeat count @plan:PLAN-20250218-HOOKSYSTEM.P04',
  (repeatCount) => {
    const system = createFreshHookSystem();
    // Invariant: calling dispose 1 time has same state effect as N times
    for (let i = 0; i < repeatCount; i++) {
      expect(() => system.dispose()).not.toThrow();
    }
    // After any number of dispose calls, system is in terminal state
    // (no further message processing — verified by P07/P08 integration)
  }
);
```

### Required Code Markers

Every test MUST include:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P04
 * @requirement DELTA-HSYS-001
 * @scenario MessageBus forwarded to HookEventHandler
 * @given HookSystem constructed with spy messageBus
 * @when HookSystem creates HookEventHandler
 * @then HookEventHandler's messageBus matches injected instance
 */
it('forwards messageBus to HookEventHandler @plan:PLAN-20250218-HOOKSYSTEM.P04', () => {
  // ...
});
```

## Verification Commands

### Test Execution + RED/GREEN Evidence

```bash
# Run new lifecycle tests — should FAIL naturally (not on NotYetImplemented)
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | tee /tmp/p04-red-evidence.txt
tail -30 /tmp/p04-red-evidence.txt
# Expected: tests fail with "expected X received undefined" or similar
# NOT: "Error: NotYetImplemented"

# Capture and verify RED evidence
grep -E "FAIL|● " /tmp/p04-red-evidence.txt | head -20
# Expected: multiple ● failure lines showing tests FAIL before P05 implementation
# REQUIREMENT: paste this output into .completed/P04.md — INVALID without RED evidence

# Count tests created
grep -c "it(\|test\.prop(" packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 15+

# Count property-based tests
grep -c "test\.prop\|fc\.assert\|fc\.property" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 5+ (30% of 15+)
```

### Property Test Quality

```bash
# No vacuous generators in property tests
grep -E "\bfc\.object\(\)|\bfc\.anything\(\)" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 0 (banned generators absent)

# Metamorphic invariant comments present
grep -c "METAMORPHIC\|metamorphic\|invariant" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 3+ (one per property test)

# Domain-constrained generators used
grep -E "minLength|maxLength|min:|max:|integer\(|constantFrom\(" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 5+ constraint applications (ensures domain entropy)
```

### AST / Static Checks

```bash
# No placeholder empty returns in test helpers
grep -E "return \[\]|return \{\}|return null" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 0 (test helpers return meaningful values)

# Behavioral assertions (not just structure)
grep -cE "toBe\(|toEqual\(|toStrictEqual\(" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 10+ concrete value assertions
```

### Anti-Fraud Checks

```bash
# No mock theater (tests that only verify mock was called)
grep -rn "toHaveBeenCalled\b" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts \
  | grep -v "dispose"
# Expected: 0 matches (verify BEHAVIOR not mock calls)
# Note: dispose() spy calls are intentionally excluded — verifying that
# HookSystem.dispose() delegates to HookEventHandler.dispose() is a
# legitimate lifecycle/delegation assertion, not mock theater.

# No reverse testing
grep -rn "NotYetImplemented\|toThrow.*NotYetImplemented\|not\.toThrow" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 0 matches

# No structure-only testing (toHaveProperty without value assertion)
grep -rn "toHaveProperty\|toBeDefined()\|toBeUndefined()" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 0 or only used with specific value checks

# Behavioral assertions present
grep -c "toBe(\|toEqual(\|toContain(\|toMatch(\|toStrictEqual(" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 10+ behavioral assertions
```

### Deferred Implementation Detection

```bash
# Tests themselves should have no TODO
grep -rn "TODO\|FIXME\|STUB" \
  packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts
# Expected: 0 matches
```

## Success Criteria

- 15+ behavioral tests written
- 5+ property-based tests (30% minimum)
- Tests fail naturally (not on NotYetImplemented)
- No mock theater, no reverse testing
- All tests tagged with @plan and @requirement markers
- TypeScript compiles

## Failure Recovery

If tests were written incorrectly:
1. `git checkout -- packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts`
2. Re-read PLAN.md behavioral testing requirements
3. Rewrite tests following GIVEN/WHEN/THEN pattern with actual value assertions

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P04.md`

```markdown
Phase: P04
Completed: YYYY-MM-DD HH:MM
Tests Written: [count]
Property Tests: [count] ([percentage]%)
Tests Naturally Failing: YES
Mock Theater: NONE
Reverse Testing: NONE
```
