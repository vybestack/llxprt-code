# Phase 06a: Verify A2A Utilities - Stub

## Phase ID

`PLAN-20260302-A2A.P06a`

## Prerequisites

- Required: Phase 06 completed
- Verification: File `packages/core/src/agents/a2a-utils.ts` exists with stub functions

## Purpose

Verify that Phase 06 correctly implemented stub utility functions for A2A response processing. This verification phase checks both structural correctness (files, markers, exports) and semantic correctness (function signatures match design).

## Verification Commands

### Structural Verification

```bash
# Check file exists
ls packages/core/src/agents/a2a-utils.ts
# Expected: File exists

# Check plan markers
grep -c "@plan:PLAN-20260302-A2A.P06" packages/core/src/agents/a2a-utils.ts
# Expected: 3 (extractMessageText, extractTaskText, extractIdsFromResponse)

# Check requirement markers
grep -c "@requirement:A2A-EXEC" packages/core/src/agents/a2a-utils.ts
# Expected: 4+ (A2A-EXEC-003, A2A-EXEC-004 appears twice, A2A-EXEC-008)

# Verify exports
grep "^export function" packages/core/src/agents/a2a-utils.ts
# Expected: extractMessageText, extractTaskText, extractIdsFromResponse (3 functions)

# Check for TODO/FIXME in function bodies (should only be at file top for SDK note)
grep -E "(TODO|FIXME|HACK|STUB)" packages/core/src/agents/a2a-utils.ts | grep -v "NOTE:"
# Expected: No matches (file-level comment is OK, function bodies should be clean)

# TypeScript compile (will fail on missing @a2a-js/sdk, acceptable)
npx tsc --noEmit packages/core/src/agents/a2a-utils.ts 2>&1 | grep -E "(Cannot find module '@a2a-js/sdk'|error TS2307)"
# Expected: Module not found error (acceptable for stub phase, SDK added in P15)
```

### Semantic Verification

**Answer ALL questions before proceeding:**

#### 1. Does the code DO what the requirement says?

- [ ] **I READ the actual a2a-utils.ts file** (lines 1-60 for all functions)
- [ ] **extractMessageText exists** with signature: `export function extractMessageText(message: Message): string`
- [ ] **extractTaskText exists** with signature: `export function extractTaskText(task: Task): string`
- [ ] **extractIdsFromResponse exists** with signature: `export function extractIdsFromResponse(result: Message | Task): { contextId?: string; taskId?: string }`
- [ ] **All functions have JSDoc** with @plan PLAN-20260302-A2A.P06 marker
- [ ] **Requirements documented**: extractMessageText has A2A-EXEC-004 and A2A-EXEC-008, extractTaskText has A2A-EXEC-004, extractIdsFromResponse has A2A-EXEC-003

**How I verified:**
```
Read a2a-utils.ts lines 1-60. Confirmed:
- extractMessageText(message: Message): string exists with JSDoc @plan and @requirement markers
- extractTaskText(task: Task): string exists with JSDoc @plan and @requirement markers
- extractIdsFromResponse(result: Message | Task): { contextId?: string; taskId?: string } exists with JSDoc @plan and @requirement markers
All functions exported with 'export function' keyword
```

#### 2. Is this REAL stub implementation, not placeholder?

- [ ] **Stub returns are valid**: Functions return correct types (string for extract*Text, object for extractIds)
- [ ] **No empty implementations**: Functions have actual return statements (even if returning minimal values like '' or {})
- [ ] **No TODO/HACK in bodies**: Function bodies are clean (only file-level comment about SDK)
- [ ] **Type imports documented**: Import statement has comment explaining SDK will be added in P15

**How I verified:**
```
Checked function bodies:
- extractMessageText returns '' (string type, valid stub)
- extractTaskText returns '' (string type, valid stub)
- extractIdsFromResponse returns {} (object type, valid stub)
No TODO comments in function bodies
File-level comment: "// NOTE: @a2a-js/sdk dependency will be added in Phase 15"
```

#### 3. Would stub prevent P07 tests from compiling?

- [ ] **Function signatures correct**: Tests can import and call these functions with correct types
- [ ] **Return types match**: Tests expecting string or object will get correct types from stubs
- [ ] **Exports accessible**: All functions are exported so tests can import them

**How I verified:**
```
Function signatures match design.md §5.5:
- extractMessageText(message: Message): string [OK]
- extractTaskText(task: Task): string [OK]
- extractIdsFromResponse(result: Message | Task): { contextId?: string; taskId?: string } [OK]
All exported, tests can import them
```

#### 4. Are imports and dependencies handled correctly?

- [ ] **SDK import present**: `import type { Message, Task, Part } from '@a2a-js/sdk';`
- [ ] **Import is type-only**: Uses `import type` (not runtime import, so no bundling issues)
- [ ] **Comment explains missing SDK**: File has explanatory comment about SDK added in P15
- [ ] **TypeScript error expected**: Module not found error is documented and acceptable

**How I verified:**
```
Checked imports:
- import type { Message, Task, Part } from '@a2a-js/sdk'; [OK] (type-only import)
- File has comment explaining SDK added in P15 [OK]
- TypeScript error: "Cannot find module '@a2a-js/sdk'" is expected [OK]
```

#### 5. What's MISSING?

**Acceptable for stub phase:**
- [ ] Actual text extraction logic (scheduled for P08)
- [ ] Terminal state detection logic (scheduled for P08)
- [ ] Part type handling (TextPart, DataPart, FilePart) (scheduled for P08)
- [ ] Tests (scheduled for P07)
- [ ] SDK dependency (scheduled for P15)

**Blockers (should NOT be present):**
- [ ] None identified

**How I verified:**
```
This is a stub phase, so missing implementation logic is expected
No blockers found that would prevent P07 from proceeding
Stubs have correct types and return values for tests to compile against
```

### Expected Behavior After P06

**What WORKS:**
- [ ] Functions export correctly
- [ ] Function signatures are correct
- [ ] Return types match TypeScript expectations
- [ ] Markers present (@plan, @requirement)

**What DOESN'T WORK (expected):**
- [ ] TypeScript import error for @a2a-js/sdk (module not found) — acceptable
- [ ] Functions return minimal values (empty strings, empty objects) — expected for stubs
- [ ] No actual text extraction (tests will fail in P07, proving they test real behavior)

**Verification:**
```bash
# SDK import fails (expected)
npx tsc --noEmit packages/core/src/agents/a2a-utils.ts 2>&1 | grep -i "cannot find module"
# Expected: Error about @a2a-js/sdk not found
```

## Success Criteria

- [ ] All structural checks PASS
- [ ] All semantic verification questions answered YES
- [ ] 3 @plan markers and 4+ @requirement markers found
- [ ] 3 functions exported
- [ ] SDK import documented as expected to fail
- [ ] No TODO/STUB in function bodies
- [ ] Ready to proceed to P07 (TDD phase)

## Failure Recovery

If verification fails:

1. **Structural failures** (missing markers, wrong exports):
   - Return to P06
   - Fix function definitions and markers
   - Re-run verification

2. **Semantic failures** (wrong signatures, missing functions):
   - Return to P06
   - Correct function signatures based on design.md §5.5
   - Re-run verification

3. **Unexpected blockers**:
   - Document in verification report
   - Escalate to plan reviewer

## Verification Report Template

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P06a-report.md`

```markdown
# Phase 06 Verification Report

**Verified by:** [subagent/human name]
**Date:** [YYYY-MM-DD HH:MM]

## Structural Checks
- [x] File exists: packages/core/src/agents/a2a-utils.ts
- [x] Plan markers: 3/3 found
- [x] Requirement markers: 4+/4+ found
- [x] Exports: extractMessageText, extractTaskText, extractIdsFromResponse
- [x] No TODO/STUB in function bodies

## Semantic Checks
- [x] extractMessageText signature: (message: Message): string
- [x] extractTaskText signature: (task: Task): string
- [x] extractIdsFromResponse signature: (result: Message | Task): { contextId?: string; taskId?: string }
- [x] SDK import documented (type-only, comment explains P15)
- [x] Stub returns valid types (empty string, empty object)

## TypeScript Status
- [x] Import error expected: "Cannot find module '@a2a-js/sdk'" [OK]
- [x] Comment explains SDK added in P15 [OK]

## Issues Found
- None (or list any issues)

## Verification Result
[OK] PASS - Ready for P07

**Verification commands executed:**
```
[paste actual command outputs here]
```
```

## Next Phase

After successful verification:
- **Proceed to Phase 07**: A2A Utilities - TDD
- Phase 07 will create behavioral tests for the utility functions
