# Phase P06a: Confirmation Bus TDD Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P06 (confirmation bus RED tests written)

## Purpose

Verify RED tests for the confirmation bus are properly structured — they fail because skeleton stubs return wrong behavioral values (not import-resolution failures). Verify source review was performed, observable-behavior test patterns are used, and all message type fields are covered.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies RED test quality)
- **Verifier**: deepthinker (confirms source review completeness and semantic correctness)

## Exact File Tasks

None (verification only).

## @plan / @requirement Marker Verification

```bash
# Check @plan markers
rg "@plan.*PLAN-20260609-ISSUE1591\.P06" packages/policy/src/confirmation-bus -g '*.test.ts' --count
# Expected: 1+ files

# Check @requirement markers
rg "@requirement:REQ-003" packages/policy/src/confirmation-bus -g '*.test.ts' --count
# Expected: 1+ files
```

## Verification Commands

```bash
# 1. Tests must fail (RED state)
npm run test --workspace @vybestack/llxprt-code-policy 2>&1
# Expected: assertion failures (wrong enum values, no-op methods, empty results)

# 2. Verify failure reason — must be assertion failures, not import resolution
npm run test --workspace @vybestack/llxprt-code-policy 2>&1 | rg -i "AssertionError|expected|received"
# Expected: assertion failures
# NOT: "cannot find module" (skeleton stubs resolve imports)

# 3. Verify skeleton stubs exist (imports should resolve)
ls packages/policy/src/confirmation-bus/types.ts packages/policy/src/confirmation-bus/message-bus.ts 2>&1
# Expected: files exist (P03b skeletons)

# 4. Verify no forbidden imports
rg "@vybestack/llxprt-code-core|@google/genai|@vybestack/llxprt-code-telemetry" packages/policy/src/confirmation-bus -g '*.test.ts'
# Expected: zero matches

# 5. Verify use of policy-owned types
rg "PolicyFunctionCall|PolicyToolCallState|ConfirmationOutcome" packages/policy/src/confirmation-bus -g '*.test.ts'
# Expected: present

# 6. Verify no legacy type references
rg "ToolConfirmationOutcome|ToolCall.*scheduler|FunctionCall.*@google" packages/policy/src/confirmation-bus -g '*.test.ts'
# Expected: zero matches

# 7. Verify PolicyLogger test coverage
rg "PolicyLogger" packages/policy/src/confirmation-bus -g '*.test.ts'
# Expected: at least 2 test cases (default no-op and custom logger)

# 8. Verify ToolCallsUpdateMessage generic test
rg "ToolCallsUpdateMessage" packages/policy/src/confirmation-bus -g '*.test.ts'
# Expected: at least 1 test case verifying generic usage

# 9. Verify source review comments present
rg "source review|Source-Review|reviewed.*types" packages/policy/src/confirmation-bus -g '*.test.ts'
# Expected: comments documenting source review of existing types

# 10. Verify all 8 ConfirmationOutcome values tested
rg -c "ProceedOnce|ProceedAlways|ProceedAlwaysAndSave|ProceedAlwaysServer|ProceedAlwaysTool|ModifyWithEditor|SuggestEdit|Cancel" packages/policy/src/confirmation-bus -g '*.test.ts'
# Expected: 8+ matches (one per enum value)
```

## Success Criteria

- [ ] Tests fail due to wrong behavioral values from skeleton stubs (assertion failures)
- [ ] RED failure is NOT import-resolution failure (skeletons make imports resolve)
- [ ] Tests contain behavioral assertions (observable outcomes: subscriber messages, return values, collected log output)
- [ ] Zero forbidden imports
- [ ] Tests use PolicyFunctionCall, PolicyToolCallState, ConfirmationOutcome
- [ ] No legacy type references (ToolConfirmationOutcome, ToolCall from scheduler, FunctionCall from @google/genai)
- [ ] PolicyLogger injection tested (default no-op + custom)
- [ ] ToolCallsUpdateMessage<T> generic behavior tested
- [ ] All 8 ConfirmationOutcome enum values tested by name
- [ ] Source review documented in test file comments
- [ ] Test count matches coverage requirements (15+ test cases)
- [ ] @plan markers present
- [ ] @requirement markers map to REQ-003

## Failure Recovery

1. If tests fail for wrong reason (import errors instead of behavioral assertions) — check that P03b skeletons exist and resolve
2. If legacy types found — replace with policy-owned types
3. If PolicyLogger not tested — add injection tests
4. If source review comments missing — add documentation of reviewed types
5. Do NOT proceed to P07 until RED state is clean and confirmed
