# Phase 11: Validation Implementation

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P11`

## Prerequisites

- Required: Phase 10a (validation TDD verification) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P10" packages/core/src/hooks/__tests__/`
- Tests from P10 MUST be failing naturally before this phase starts

## CRITICAL IMPLEMENTATION RULES

- Follow pseudocode EXACTLY — reference specific line numbers
- Do NOT modify test files from P10 or any earlier phases
- UPDATE existing files only — no V2/New/Copy versions
- No console.log, no TODO, no FIXME

## FAILURE ENVELOPE STRICTNESS (HARDENED)

ALL error classes in the validation layer MUST produce explicit typed envelopes:

| Error class | Required code | Required stage | EMPTY_SUCCESS_RESULT allowed? |
|-------------|--------------|----------------|-------------------------------|
| Validation failure (bad payload) | `'VALIDATION_FAILURE'` | `'validation'` | **NO** |
| Transport error (malformed bus message) | `'TRANSPORT_ERROR'` | `'transport'` | **NO** |
| Runtime error (thrown during processing) | `'RUNTIME_ERROR'` | `'runtime'` | **NO** |
| Translation error (model payload mapping) | `'TRANSLATION_ERROR'` | `'translation'` | **NO** |
| Output processing error (post-execution) | `'OUTPUT_PROCESSING_ERROR'` | `'output_processing'` | **NO** |

**Rule**: `return EMPTY_SUCCESS_RESULT` is BANNED in all catch blocks and failure branches.
Use `return this.buildFailureEnvelope(error, '<stage>', meta)` exclusively.
After P05, there must be ZERO occurrences of bare `return EMPTY_SUCCESS_RESULT` in hook execution paths.

## Requirements Implemented

DELTA-HPAY-001, DELTA-HPAY-002, DELTA-HPAY-005

## Implementation Tasks

### File: `packages/core/src/hooks/hookValidators.ts`

**Pseudocode Reference**: `analysis/pseudocode/validation-boundary.md` (full file)

Implement each validator with real field checks:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-005
 * @pseudocode validation-boundary.md isObject and isNonEmptyString
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 * @pseudocode validation-boundary.md BeforeTool section
 * Required fields: tool_name (non-empty string), tool_input (object)
 * Extra fields tolerated (Rule V4 from domain-model.md)
 */
export function validateBeforeToolInput(input: unknown): input is BeforeToolInput {
  if (!isObject(input)) return false;
  if (!isNonEmptyString(input['tool_name'])) return false;
  if (!isObject(input['tool_input'])) return false;
  return true;
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001
 * @pseudocode validation-boundary.md AfterTool section
 * Required fields: tool_name (non-empty string), tool_input (object), tool_response (any)
 */
export function validateAfterToolInput(input: unknown): input is AfterToolInput {
  if (!isObject(input)) return false;
  if (!isNonEmptyString(input['tool_name'])) return false;
  if (!isObject(input['tool_input'])) return false;
  if (!('tool_response' in input)) return false;
  return true;
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @pseudocode validation-boundary.md BeforeAgent section
 * BeforeAgent and AfterAgent: base fields only; accepts any object
 */
export function validateBeforeAgentInput(input: unknown): input is BeforeAgentInput {
  return isObject(input);
}

export function validateAfterAgentInput(input: unknown): input is AfterAgentInput {
  return isObject(input);
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @pseudocode validation-boundary.md BeforeModel section
 * Required fields: model_request (object)
 */
export function validateBeforeModelInput(input: unknown): input is BeforeModelInput {
  if (!isObject(input)) return false;
  if (!isObject(input['model_request'])) return false;
  return true;
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @pseudocode validation-boundary.md AfterModel section
 * Required fields: model_request (object), model_response (object)
 */
export function validateAfterModelInput(input: unknown): input is AfterModelInput {
  if (!isObject(input)) return false;
  if (!isObject(input['model_request'])) return false;
  if (!isObject(input['model_response'])) return false;
  return true;
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @pseudocode validation-boundary.md BeforeToolSelection section
 * Required fields: model_request (object), available_tools (array)
 */
export function validateBeforeToolSelectionInput(input: unknown): input is BeforeToolSelectionInput {
  if (!isObject(input)) return false;
  if (!isObject(input['model_request'])) return false;
  if (!Array.isArray(input['available_tools'])) return false;
  return true;
}

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @pseudocode validation-boundary.md Notification section
 * Required fields: message (non-empty string)
 */
export function validateNotificationInput(input: unknown): input is NotificationInput {
  if (!isObject(input)) return false;
  if (!isNonEmptyString(input['message'])) return false;
  return true;
}
```

### File: `packages/core/src/hooks/hookEventHandler.ts`

**Pseudocode Reference**: `analysis/pseudocode/hook-event-handler.md` lines 320–331

Implement the `validateEventPayload` routing switch:

```typescript
/**
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-002
 * @pseudocode hook-event-handler.md lines 320-331
 */
private validateEventPayload(eventName: HookEventName, input: unknown): boolean {
  // Line 321: SWITCH ON eventName
  switch (eventName) {
    case HookEventName.BeforeTool:
      return validateBeforeToolInput(input);           // Line 322
    case HookEventName.AfterTool:
      return validateAfterToolInput(input);            // Line 323
    case HookEventName.BeforeAgent:
      return validateBeforeAgentInput(input);          // Line 324
    case HookEventName.AfterAgent:
      return validateAfterAgentInput(input);           // Line 325
    case HookEventName.BeforeModel:
      return validateBeforeModelInput(input);          // Line 326
    case HookEventName.AfterModel:
      return validateAfterModelInput(input);           // Line 327
    case HookEventName.BeforeToolSelection:
      return validateBeforeToolSelectionInput(input);  // Line 328
    case HookEventName.Notification:
      return validateNotificationInput(input);         // Line 329
    default:
      return false;                                    // Line 330
  }
}
```

Ensure imports from hookValidators are added at top of hookEventHandler.ts:

```typescript
import {
  validateBeforeToolInput,
  validateAfterToolInput,
  validateBeforeAgentInput,
  validateAfterAgentInput,
  validateBeforeModelInput,
  validateAfterModelInput,
  validateBeforeToolSelectionInput,
  validateNotificationInput
} from './hookValidators.js';
```

## Verification Commands

### Primary: All P10 Tests Must Pass

```bash
npm test -- --testPathPattern="hookValidators"
# Expected: ALL tests pass

# Also all earlier tests
npm test -- --testPathPattern="hookSystem-lifecycle"
# Expected: ALL pass
```

### No Test Modifications

```bash
git diff packages/core/src/hooks/__tests__/
# Expected: no diff
```

### Pseudocode Compliance

```bash
# Each validator has the right required field checks
grep -A 5 "validateBeforeToolInput" packages/core/src/hooks/hookValidators.ts
# Expected: isObject check + isNonEmptyString('tool_name') + isObject('tool_input')

grep -A 5 "validateNotificationInput" packages/core/src/hooks/hookValidators.ts
# Expected: isObject check + isNonEmptyString('message')

# Switch statement wires all 8 validators
grep -A 20 "validateEventPayload" packages/core/src/hooks/hookEventHandler.ts | \
  grep -E "case HookEventName\." | wc -l
# Expected: 8

# Imports from hookValidators
grep "hookValidators" packages/core/src/hooks/hookEventHandler.ts
# Expected: import statement present
```

### TypeScript and Build

```bash
npm run typecheck && echo "PASS"
npm run build && echo "PASS"
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" \
  packages/core/src/hooks/hookValidators.ts \
  packages/core/src/hooks/hookEventHandler.ts | grep -v ".test.ts"
# Expected: 0 matches

# No empty returns
grep -n "return false; // stub" packages/core/src/hooks/hookValidators.ts
# Expected: 0 matches (stubs replaced with real checks)
```

### AST / Static Checks — Failure Envelope Strictness

```bash
# BANNED: bare EMPTY_SUCCESS_RESULT return in any catch or failure path
grep -n "return EMPTY_SUCCESS_RESULT" packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 matches — ZERO after P11

# BANNED: empty array/object placeholder returns in impl files
grep -E "return \[\]|return \{\}|return null" \
  packages/core/src/hooks/hookValidators.ts \
  packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 (null return is forbidden; empty results use makeEmptySuccessResult)

# ALL error classes produce explicit envelopes: check all catch blocks
grep -n "catch" packages/core/src/hooks/hookEventHandler.ts | while read LINE; do
  echo "Catch block at: $LINE"
done
# Manual check: every catch block must call buildFailureEnvelope, not EMPTY_SUCCESS_RESULT or {}

# Validation envelope has required fields: stage, code, message
grep -A 5 "VALIDATION_FAILURE" packages/core/src/hooks/hookEventHandler.ts | \
  grep -E "stage.*validation|code.*VALIDATION_FAILURE"
# Expected: both stage and code present in the error object

# No silent swallowing: no empty catch bodies
grep -A 2 "} catch" packages/core/src/hooks/hookEventHandler.ts | \
  grep -E "^\s*\}" | head -5
# Expected: 0 empty catch bodies (every catch block has a return or throw)
```

### Mediated Path Validation Integration

```bash
# P07 bus tests with valid payloads should pass again
npm test -- --testPathPattern="hookEventHandler-messagebus" 2>&1 | tail -10
# Expected: tests with valid payloads pass; tests with invalid payloads produce
#           failure responses (not execution errors)
```

## Success Criteria

- All P10 tests pass
- All P04 and P07 tests pass (or P07 regressions are due only to valid-payload validation now working)
- TypeScript compiles, build succeeds
- All 8 validators with real field checks
- validateEventPayload switch wired to all 8 validators
- No stubs remaining in hookValidators.ts
- No test modifications

## Failure Recovery

If tests fail:
1. Read which validator is returning wrong value
2. Check pseudocode validation-boundary.md for that event's required fields
3. Fix the field check in the validator
4. Re-run tests

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P11.md`
