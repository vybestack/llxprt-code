# Phase 09: Validation Stub

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P09`

## Prerequisites

- Required: Phase 08a (MessageBus impl verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P08" packages/core/src/hooks/`
- All P07 and P04 tests must be passing

## Requirements Implemented (Expanded)

### DELTA-HPAY-001: Runtime validation at mediated boundaries — MANDATORY BLOCKING

**Full Text**: HookEventHandler SHALL perform runtime validation at mediated boundaries for all 8 event families
**Behavior**:
- GIVEN: A HOOK_EXECUTION_REQUEST arrives with BeforeTool eventName
- WHEN: Validation runs before planning
- THEN: If tool_name or tool_input missing → failure response published; planner NOT called
**Why This Matters**: Prevents malformed payloads from reaching the planner/runner

**HARDENING — Validation is MANDATORY, not advisory**:
- Validation MUST run at mediated ingress on every request — it is not optional, not skippable
- A failed validation BLOCKS execution completely — the planner/runner is never called
- There is NO fallback path that allows an invalid payload to proceed
- The validation gate sits between ingress decoding and any downstream processing

### DELTA-HPAY-002: Validation failure — DETERMINISTIC TYPED ERRORS, NO SILENT FALLBACK

**Full Text**: If mediated payload validation fails, SHALL return structured failure and SHALL NOT execute planner/runner
**Behavior**:
- GIVEN: Invalid payload
- WHEN: validateEventPayload returns false
- THEN: buildFailureEnvelope called with 'VALIDATION_FAILURE'; executeHooksCore NOT called

**HARDENING — Deterministic typed errors required**:
- On validation failure, `buildFailureEnvelope` MUST be called with code `'VALIDATION_FAILURE'`
- The returned `AggregatedHookResult` MUST have `success: false`
- The `errors` array MUST contain at least one entry with `{ stage: 'validation', code: 'VALIDATION_FAILURE', message: string }`
- Silent swallowing of validation errors is FORBIDDEN — no `return EMPTY_SUCCESS_RESULT` on invalid payload
- The typed error envelope is the ONLY permitted outcome for an invalid payload

### DELTA-HPAY-005: Type predicates (not plain boolean)

**Full Text**: Each event-specific input validator SHALL be a TypeScript type predicate (input is T)
**Behavior**:
- GIVEN: validateBeforeToolInput(input) returns true
- WHEN: TypeScript type narrowing applies
- THEN: input is narrowed to BeforeToolInput type

## Implementation Tasks

### Files to Create

#### `packages/core/src/hooks/hookValidators.ts` (NEW)

Create stub validator functions. They may return `true` for all inputs (or `false`)
as long as TypeScript compiles. Tests in P10 will fail naturally.

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P09
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 */

import type { BeforeToolInput, AfterToolInput, BeforeAgentInput, AfterAgentInput,
              BeforeModelInput, AfterModelInput, BeforeToolSelectionInput, NotificationInput } from './types.js';

// Stub validators — return false for all inputs (tests will fail naturally)
// Phase C implementation (P11) will add real field checking

export function isObject(value: unknown): value is Record<string, unknown> {
  return false; // stub
}

export function isNonEmptyString(value: unknown): value is string {
  return false; // stub
}

export function validateBeforeToolInput(input: unknown): input is BeforeToolInput {
  return false; // stub
}

export function validateAfterToolInput(input: unknown): input is AfterToolInput {
  return false; // stub
}

export function validateBeforeAgentInput(input: unknown): input is BeforeAgentInput {
  return false; // stub
}

export function validateAfterAgentInput(input: unknown): input is AfterAgentInput {
  return false; // stub
}

export function validateBeforeModelInput(input: unknown): input is BeforeModelInput {
  return false; // stub
}

export function validateAfterModelInput(input: unknown): input is AfterModelInput {
  return false; // stub
}

export function validateBeforeToolSelectionInput(input: unknown): input is BeforeToolSelectionInput {
  return false; // stub
}

export function validateNotificationInput(input: unknown): input is NotificationInput {
  return false; // stub
}
```

### Files to Modify

#### `packages/core/src/hooks/hookEventHandler.ts`

Add stub `validateEventPayload` routing switch and wire into `routeAndExecuteMediated`:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P09
 * @requirement DELTA-HPAY-001, DELTA-HPAY-002
 */
private validateEventPayload(eventName: HookEventName, input: unknown): boolean {
  return false; // stub — delegates to hookValidators in P11
}
```

Wire validation gate into `routeAndExecuteMediated` (stub: currently returns false so all mediated requests fail validation).

**HARDENING — validation failure MUST return typed envelope, NOT throw**:

```typescript
// After eventName enum check, before translation:
// Line 97-101 of message-bus-integration.md:
if (!this.validateEventPayload(eventName as HookEventName, input)) {
  // MANDATORY: return typed failure envelope — do NOT throw, do NOT return EMPTY_SUCCESS_RESULT
  return this.buildFailureEnvelope(
    { code: 'VALIDATION_FAILURE', message: `Invalid payload for event '${eventName}'` },
    'validation',
    { eventName: eventName as HookEventName }
  );
}
```

The `buildFailureEnvelope` call produces:
```typescript
{
  success: false,
  hookResults: [],
  allOutputs: [],
  errors: [{ stage: 'validation', code: 'VALIDATION_FAILURE', message: string, eventName: string }],
  totalDuration: 0
}
```

Note: At this stub stage, ALL mediated requests will fail validation (returning false).
This is intentional — P10 TDD tests will be written against this failing behavior,
and P11 will make the validators actually check fields.

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P09
 * @requirement DELTA-HPAY-001
 */
```

## Verification Commands

### Structural

```bash
# hookValidators.ts exists
ls packages/core/src/hooks/hookValidators.ts || exit 1

# All 10 validator functions exported
for fn in "isObject" "isNonEmptyString" "validateBeforeToolInput" "validateAfterToolInput" \
          "validateBeforeAgentInput" "validateAfterAgentInput" "validateBeforeModelInput" \
          "validateAfterModelInput" "validateBeforeToolSelectionInput" "validateNotificationInput"; do
  grep -q "export function $fn" packages/core/src/hooks/hookValidators.ts && \
    echo "PASS: $fn" || echo "FAIL: $fn missing"
done

# All validators use type predicate syntax (input is T)
grep -c "input is " packages/core/src/hooks/hookValidators.ts
# Expected: 8+ type predicates

# validateEventPayload stub added to hookEventHandler
grep -n "validateEventPayload" packages/core/src/hooks/hookEventHandler.ts
# Expected: method definition present

# TypeScript compiles
npm run typecheck
# Expected: 0 errors

# Plan markers
grep -rn "PLAN-20250218-HOOKSYSTEM.P09" packages/core/src/hooks/ | wc -l
# Expected: 6+

# No TODO/FIXME
grep -rn "TODO\|FIXME" packages/core/src/hooks/hookValidators.ts
# Expected: 0 matches

# Existing tests still pass (P04 lifecycle tests)
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | grep "passed"
# Expected: 15+ passing
```

### Hardening Verification: Typed Error Shape

```bash
# Validation gate returns buildFailureEnvelope (NOT throw, NOT EMPTY_SUCCESS_RESULT)
grep -A 8 "validateEventPayload" packages/core/src/hooks/hookEventHandler.ts | \
  grep "buildFailureEnvelope"
# Expected: buildFailureEnvelope call present in the false-branch

# NO silent fallback to EMPTY_SUCCESS_RESULT on invalid payload
grep -B 2 -A 2 "EMPTY_SUCCESS_RESULT" packages/core/src/hooks/hookEventHandler.ts | \
  grep -v "makeEmptySuccessResult\|const EMPTY"
# Expected: EMPTY_SUCCESS_RESULT never returned raw after a validation gate

# Error envelope shape: stage='validation', code='VALIDATION_FAILURE'
grep -A 5 "VALIDATION_FAILURE" packages/core/src/hooks/hookEventHandler.ts
# Expected: { stage: 'validation', code: 'VALIDATION_FAILURE', message: ... }

# No raw throw on validation failure
grep -B 2 "throw.*validation\|throw.*VALIDATION" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 matches (failure returns envelope, does not throw)
```

### Note on P07 Tests After Wiring Validation Gate

After wiring `validateEventPayload` into `routeAndExecuteMediated`, some P07 tests
that test mediated path behavior may now fail because the stub returns false for all
inputs. This is expected behavior:
- Direct path tests (fire*Event) should still pass (validation only on mediated path)
- Mediated path tests that require valid payloads will now fail on validation stub
- This is acceptable — they'll pass again after P11 implements real validation

Document the expected regression in the verification:

```bash
# Direct path tests should still pass
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | grep -E "passed|failed"

# Document which P07 tests are now failing due to validation stub
npm test -- --testPathPattern="hookEventHandler-messagebus" 2>&1 | grep "FAIL" | head -10
# Expected: mediated-path tests failing on validation; direct-path tests still passing
```

## Success Criteria

- hookValidators.ts created with 10 stub validator functions using type predicates
- validateEventPayload stub added to HookEventHandler
- TypeScript compiles
- P04 (lifecycle) tests still pass
- Direct-path fire*Event tests unaffected

## Failure Recovery

If TypeScript fails on type predicates:
1. Check input type interfaces are imported correctly
2. Verify type predicate syntax: `(input: unknown): input is T`
3. Fix imports and re-run typecheck

If the stub is incorrect or needs to be reset:
1. `git checkout -- packages/core/src/hooks/hookValidators.ts` (if created)
2. `git checkout -- packages/core/src/hooks/hookEventHandler.ts`
3. Re-read pseudocode lines 10–30 (isObject, isNonEmptyString, validateBeforeToolInput) and retry

If pre-existing tests regress:
1. `git checkout -- packages/core/src/hooks/hookEventHandler.ts`
2. Confirm no changes were made to existing method signatures or return types
3. Re-run pre-existing tests to confirm baseline

Cannot proceed to P10 until TypeScript compiles and existing tests pass.

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P09.md`
