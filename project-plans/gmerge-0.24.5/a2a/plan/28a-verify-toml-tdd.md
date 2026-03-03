# Phase 28a: TOML Integration TDD - Verification

## Phase ID

`PLAN-20260302-A2A.P28a`

## Prerequisites

- Required: Phase 28 (TOML Integration TDD) completed
- Expected: agent-toml-loader.test.ts exists with 12 tests

## Verification Tasks

### 1. Structural Verification

```bash
# Test file exists
test -f packages/core/src/agents/__tests__/agent-toml-loader.test.ts && echo "FOUND" || echo "MISSING"

# Test count
grep -c "^[[:space:]]*it('should" packages/core/src/agents/__tests__/agent-toml-loader.test.ts
# Expected: 12

# Plan markers
grep -c "@plan:PLAN-20260302-A2A.P28" packages/core/src/agents/__tests__/agent-toml-loader.test.ts
# Expected: 12+

# Requirement markers
grep -c "@requirement:A2A-" packages/core/src/agents/__tests__/agent-toml-loader.test.ts
# Expected: 12+
```

### 2. Test Execution (Against Stub)

```bash
# Run TOML tests
npm test -- packages/core/src/agents/__tests__/agent-toml-loader.test.ts
# Expected: Most FAIL (stub returns empty arrays, always infers 'local')
```

### 3. Expected Failure Analysis

**Tests that should FAIL against stub:**
- Remote agent parsing (stub returns empty array)
- Local agent parsing (stub returns empty array)
- Kind inference → remote (stub always returns 'local')
- Multiple agents (stub returns empty arrays)

**Tests that might PASS:**
- Kind inference → local (stub returns 'local')
- Validation tests (if they check parsing, not just schema definition)

### 4. Manual Review

**Check test structure:**
- [ ] 12 tests organized in 5 describe blocks
- [ ] Tests use temp TOML files (createTempToml helper)
- [ ] Tests clean up temp files (unlink)
- [ ] All tests have @plan and @requirement markers
- [ ] Validation tests check for thrown errors
- [ ] HTTPS enforcement test checks for http:// rejection

## Checklist

**Structural:**
- [ ] Test file exists
- [ ] 12 tests present
- [ ] @plan markers: 12+
- [ ] @requirement markers: 12+

**Test Quality:**
- [ ] Helper function createTempToml defined
- [ ] Temp file cleanup in all tests
- [ ] Tests cover all TOML scenarios (remote, local, validation)
- [ ] HTTPS enforcement test present

**Expected Results:**
- [ ] ~10-11 tests FAIL (stub doesn't parse)
- [ ] ~1-2 tests might PASS (local kind inference)

## Success Criteria

- Test file exists with 12 tests
- All markers present
- Tests compile and run
- Expected failure pattern matches (most fail, stub-related)

## Report Template

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P28a-report.md`

```markdown
# Phase 28a Verification Report

**Date**: [YYYY-MM-DD HH:MM]
**Verifier**: [Your name/agent ID]

## Verification Results

### Structural Checks
- Test file: FOUND
- Test count: [X] tests
- @plan markers: [Y]
- @requirement markers: [Z]

### Test Execution
- Tests run: YES
- Passed: [N] tests
- Failed: [M] tests (expected against stub)

### Failure Analysis
**Expected failures (stub returns empty/local):**
- Remote agent parsing: FAIL (stub returns [])
- Kind inference → remote: FAIL (stub returns 'local')
- Multiple agents: FAIL (stub returns [])

**Unexpected failures:**
[List any test failures not due to stub behavior]

## Test Output

\`\`\`
[paste npm test output]
\`\`\`

## Status

PASS: Tests exist and behave as expected against stub. Ready for Phase 29 implementation.

## Next Steps

Proceed to Phase 29: TOML Integration - Implementation
```

## Phase Completion

After creating report:

```bash
echo "P28a" >> project-plans/gmerge-0.24.5/a2a/plan/.completed/phases.log
```

Proceed to Phase 29 (TOML Integration Implementation).
