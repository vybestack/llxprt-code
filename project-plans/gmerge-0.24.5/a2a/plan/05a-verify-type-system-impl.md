# Phase 05a: Verify Type System Evolution - Implementation

## Phase ID

`PLAN-20260302-A2A.P05a`

## Prerequisites

- Required: Phase 05 completed
- Verification: Validation utilities and tests exist in types.ts and types.test.ts

## Purpose

Verify that Phase 05 correctly implemented validation utilities and type guards for the discriminated union type system. All validation functions must throw appropriate errors, and all tests must pass.

## Verification Commands

### Structural Verification

```bash
# Check plan markers in implementation
grep -c "@plan PLAN-20260302-A2A.P05" packages/core/src/agents/types.ts
# Expected: 5 (isLocalAgent, isRemoteAgent, 3 validate functions)

# Check requirement markers (total including P03)
grep -c "@requirement A2A-REG-001" packages/core/src/agents/types.ts
# Expected: 9+ (4 from P03 + 5 from P05)

# Check exports exist
grep "export function isLocalAgent" packages/core/src/agents/types.ts
grep "export function isRemoteAgent" packages/core/src/agents/types.ts
grep "export function validateLocalAgentDefinition" packages/core/src/agents/types.ts
grep "export function validateRemoteAgentDefinition" packages/core/src/agents/types.ts
grep "export function validateAgentDefinition" packages/core/src/agents/types.ts
# Expected: All return results

# Run ALL tests
npm test -- packages/core/src/agents/__tests__/types.test.ts
# Expected: 19+ tests, all PASS

# Check test markers
grep -c "@plan PLAN-20260302-A2A.P05" packages/core/src/agents/__tests__/types.test.ts
# Expected: 7+ (new describe block with validation tests)

# Check for TODO/FIXME
grep -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/agents/types.ts
grep -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/agents/__tests__/types.test.ts
# Expected: No matches
```

### Semantic Verification

**Answer ALL questions before proceeding:**

#### 1. Does the code DO what the requirement says?

- [ ] **I READ the actual implementation** in types.ts (functions at end of file)
- [ ] **isLocalAgent works**: Returns true for local agents, false for remote agents, provides type narrowing
- [ ] **isRemoteAgent works**: Returns true for remote agents, false for local agents, provides type narrowing
- [ ] **validateLocalAgentDefinition works**: Throws descriptive errors for missing fields (name, promptConfig, modelConfig, runConfig, inputConfig)
- [ ] **validateRemoteAgentDefinition works**: Throws descriptive errors for missing fields (name, agentCardUrl, inputConfig) and enforces HTTPS
- [ ] **validateAgentDefinition works**: Dispatches to correct validator based on kind
- [ ] **All tests PASS**: Ran `npm test -- types.test.ts` successfully

**How I verified:**
```
Read types.ts lines [X-Y] (validation functions at end):
- isLocalAgent: checks definition.kind === 'local', returns type predicate
- isRemoteAgent: checks definition.kind === 'remote', returns type predicate
- validateLocalAgentDefinition: throws if missing name/promptConfig/modelConfig/runConfig/inputConfig
- validateRemoteAgentDefinition: throws if missing name/agentCardUrl/inputConfig, enforces HTTPS
- validateAgentDefinition: uses isLocalAgent/isRemoteAgent to dispatch

npm test output: 19 tests passing
```

#### 2. Is this REAL implementation, not placeholder?

- [ ] **No TODO/STUB comments** in implementation
- [ ] **Validation functions throw**: Tested by calling with invalid data (missing fields, http:// URL)
- [ ] **Type guards return boolean**: Not hardcoded true/false, actually check kind field
- [ ] **Error messages include agent name**: e.g., `"Local agent 'test' must have promptConfig"`

**How I verified:**
```
grep "TODO\|STUB" types.ts returned no matches
Validation tests verify that functions throw on invalid input
Type guard tests verify correct boolean return values
Error messages in code include `${definition.name}` template
```

#### 3. Would tests FAIL if implementation was broken?

**Type Guards:**
- [ ] If isLocalAgent returned true for remote agents, test "isLocalAgent returns true for local agents" would fail (expect(isLocalAgent(remoteDef)).toBe(false) would fail)
- [ ] If isRemoteAgent didn't provide type narrowing, TypeScript would fail to compile code using it

**Validation:**
- [ ] If validateLocalAgentDefinition didn't check promptConfig, test "rejects missing promptConfig" would fail (expect().toThrow() wouldn't throw)
- [ ] If validateRemoteAgentDefinition didn't enforce HTTPS, test "rejects http URLs" would fail (http:// would be accepted)
- [ ] If validateAgentDefinition didn't dispatch correctly, tests would fail (wrong validator called)

**How I verified:**
```
Mentally removed promptConfig check from validateLocalAgentDefinition:
  - Test "rejects missing promptConfig" would fail (no error thrown)
Changed validateRemoteAgentDefinition to accept http://:
  - Test "rejects http URLs (requires HTTPS)" would fail (no error on http://)
Tests are coupled to actual implementation behavior
```

#### 4. Is the feature REACHABLE by consuming code?

- [ ] **All functions exported**: `export function isLocalAgent`, etc.
- [ ] **Tests import and call functions**: Verified in types.test.ts imports
- [ ] **Type predicates work**: TypeScript recognizes `is` return type for narrowing
- [ ] **Validation functions will be called by registry**: (P18-P20 will use these)

**How I verified:**
```
grep "^export function" types.ts shows all 5 functions exported
types.test.ts imports: isLocalAgent, isRemoteAgent, validate* functions
Tests successfully call all functions (no import errors)
Type predicates provide narrowing (verified by TypeScript compilation)
```

#### 5. What's MISSING?

**Acceptable for implementation phase:**
- [ ] Integration with AgentRegistry (scheduled for P18-P20)
- [ ] Usage in executor/invocation (scheduled for P30-P31)
- [ ] TOML loader validation (scheduled for P27-P29)

**Blockers (should NOT be present):**
- [ ] None identified

**How I verified:**
```
This phase implements UTILITIES only
Integration with registry/executor is in later phases
No blockers preventing progression to next phases
```

### HTTPS Enforcement Verification

**Critical Security Check (A2A-SEC-001):**

```bash
# Verify HTTPS enforcement in code
grep -A 3 "validateRemoteAgentDefinition" packages/core/src/agents/types.ts | grep "https://"
# Expected: Code checks for https:// prefix

# Verify HTTPS test exists
grep -A 5 "rejects http" packages/core/src/agents/__tests__/types.test.ts
# Expected: Test with http:// URL expects error

# Run HTTPS test specifically
npm test -- packages/core/src/agents/__tests__/types.test.ts -t "rejects http"
# Expected: Test PASSES (http:// is rejected)
```

**Manual verification:**
- [ ] Read validateRemoteAgentDefinition code: confirms check for `agentCardUrl.startsWith('https://')`
- [ ] Read test code: confirms http:// URL expects error with /HTTPS/ message
- [ ] Test passes: http:// URLs are rejected at validation time

## Test Coverage Matrix

Verify all validation scenarios covered:

| Scenario | Test Exists | Test Passes |
|----------|-------------|-------------|
| isLocalAgent returns true for local | [ ] | [ ] |
| isLocalAgent returns false for remote | [ ] | [ ] |
| isRemoteAgent returns true for remote | [ ] | [ ] |
| isRemoteAgent returns false for local | [ ] | [ ] |
| validateLocal accepts valid | [ ] | [ ] |
| validateLocal rejects missing promptConfig | [ ] | [ ] |
| validateRemote accepts valid HTTPS | [ ] | [ ] |
| validateRemote rejects HTTP | [ ] | [ ] |
| validateRemote rejects missing agentCardUrl | [ ] | [ ] |
| validateAgent dispatches correctly | [ ] | [ ] |
| **Total** | **10** | **10** |

All cells must be checked before proceeding.

## Success Criteria

- [ ] All structural checks PASS
- [ ] All semantic verification questions answered YES
- [ ] 5 new functions implemented (2 type guards + 3 validators)
- [ ] 7+ new tests added (validation scenarios)
- [ ] ALL tests PASS (19+ total: 12 from P04 + 7+ from P05)
- [ ] HTTPS enforcement works (rejects http:// URLs)
- [ ] Type guards provide TypeScript type narrowing
- [ ] All functions have @plan and @requirement markers
- [ ] No TODO comments
- [ ] Ready to proceed to P06 (A2A Utils Stub)

## Failure Recovery

If verification fails:

1. **Structural failures** (missing functions, wrong signatures):
   - Return to P05
   - Add missing functions or fix signatures
   - Re-run verification

2. **Semantic failures** (validation doesn't work, type guards wrong):
   - Return to P05
   - Fix implementation logic
   - Ensure all error cases throw correctly
   - Re-run verification

3. **Test failures** (tests don't pass):
   - Return to P05
   - Debug failing tests
   - Fix implementation or test expectations
   - Re-run verification

4. **HTTPS enforcement failure**:
   - Return to P05
   - Add/fix `agentCardUrl.startsWith('https://')` check
   - Add test for http:// rejection
   - Re-run verification

## Verification Report Template

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P05a-report.md`

```markdown
# Phase 05 Verification Report

**Verified by:** [subagent/human name]
**Date:** [YYYY-MM-DD HH:MM]

## Structural Checks
- [ ] Plan markers: 5/5 found (isLocalAgent, isRemoteAgent, 3 validators)
- [ ] Requirement markers: 9+/9+ found (4 from P03 + 5 from P05)
- [ ] Exports: All 5 functions exported
- [ ] Tests: 7+ new tests added
- [ ] Total tests: 19+ (12 from P04 + 7+ from P05)
- [ ] No TODO/STUB comments

## Semantic Checks
- [ ] isLocalAgent works correctly (true for local, false for remote)
- [ ] isRemoteAgent works correctly (true for remote, false for local)
- [ ] validateLocalAgentDefinition throws on missing fields
- [ ] validateRemoteAgentDefinition throws on missing fields
- [ ] HTTPS enforcement works (rejects http:// URLs)
- [ ] validateAgentDefinition dispatches to correct validator
- [ ] All tests PASS

## Test Coverage Matrix
- [ ] All 10 validation scenarios have tests
- [ ] All tests PASS

## HTTPS Enforcement Check
- [ ] Code checks for https:// prefix: YES
- [ ] Test exists for http:// rejection: YES
- [ ] Test passes: YES

## Issues Found
- [List any issues, or "None"]

## Verification Result
[PASS/FAIL] - [Ready for P06 / Must remediate issues]

**Test execution output:**
```
[paste npm test output showing 19+ tests passing]
```

**HTTPS test output:**
```
[paste specific test output for http:// rejection]
```
```

## Next Phase

After successful verification:
- **Proceed to Phase 06**: A2A Utilities - Stub
- Phase 06 will create utility functions for extracting text from A2A Message/Task responses
- Type system foundation (P03-P05a) is now complete
