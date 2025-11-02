# Phase 04: SubagentManager TDD (RED)

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P04`

## Prerequisites
- P03 / P03a completed (SubagentManager stub + verification)
- P02 pseudocode reviewed (`analysis/pseudocode/SubagentManager.md`)

## Implementation Tasks

### Goal
Author comprehensive failing tests that express the desired SubagentManager behavior. No production code changes are permitted in this phase.

### Files to Create / Modify
- `packages/core/src/config/test/subagentManager.test.ts`
  - Create new Vitest suite exercising SubagentManager behavior using real filesystem temp directories (no mocks).
  - Every `it` block must include `@plan:PLAN-20250117-SUBAGENTCONFIG.P04` and appropriate `@requirement` markers.
  - Reference pseudocode sections explicitly inside comments (see breakdown below).
- Do **not** modify `subagentManager.ts` in this phase.

### Required Test Coverage
1. **Setup/Teardown** (Pseudocode lines 9-60)
   - Fixture creates temp dirs and ProfileManager.
   - Tests ensure directories cleaned afterward.
2. **saveSubagent happy path** (Lines 61-127)
   - Creates new subagent and validates JSON structure.
   - Updates existing subagent preserving `createdAt`.
3. **Input validation** (Lines 66-78, 70-72, 74-78, 118-126)
   - Fails for empty/invalid name, missing profile, empty prompt.
4. **Filesystem error handling** (Lines 105-126)
   - Simulate permission/disk space errors using real fs when possible (e.g., read-only dir) or skip with clear TODO for later phases.
5. **loadSubagent** (Lines 129 onwards) – Expect errors for missing file, happy path for existing file.
6. **Property-based testing requirement (≥30%)**
   - Use `test.prop` from `fast-check` to generate random valid/invalid names and ensure validation holds without mutating inputs.

### Anti-Fraud Rules
- No `toHaveBeenCalled`, `toHaveProperty`, or reverse-testing assertions.
- Tests must assert on observable behavior (file contents, thrown message fragments).
- No `NotYetImplemented` checks.
- Use Arrange/Act/Assert comments for clarity.

## Verification Commands (expect failures / RED)

```bash
npm test -- packages/core/src/config/test/subagentManager.test.ts || true

# Anti-fraud checks
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith" packages/core/src/config/test && echo "FAIL: mock theater detected"
grep -r "NotYetImplemented" packages/core/src/config/test && echo "FAIL: reverse testing detected"
grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/core/src/config/test | grep -v "specific value" && echo "FAIL: structural test detected"

# Property-test ratio (≥30%)
TOTAL=$(rg -c "test\\(" packages/core/src/config/test/subagentManager.test.ts | awk -F: '{s+=$2} END {print s}')
PROP=$(rg -c "test\\.prop" packages/core/src/config/test/subagentManager.test.ts | awk -F: '{s+=$2} END {print s}')
[ "$TOTAL" -gt 0 ] && [ $((PROP * 100 / TOTAL)) -lt 30 ] && echo "FAIL: Property tests below 30%"
```

## Manual Verification Checklist
- [ ] Tests reference pseudocode line numbers in comments.
- [ ] Property-based tests present and count documented.
- [ ] All tests fail because `SubagentManager` is not yet implemented (RED state).
- [ ] No production files touched.

## Success Criteria
- Failing test suite committed with traceable plan / requirement markers.

## Failure Recovery
- If tests accidentally pass, broaden assertions or remove implementation.
- If coverage insufficient, add missing scenarios referencing pseudocode lines.

## Phase Completion Marker
- Create `project-plans/subagentconfig/.completed/P04.md` capturing test output, anti-fraud command results, and property ratio.
