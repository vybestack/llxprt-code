# Plan Template for Multi-Phase Features

## Plan Header

```markdown
# Plan: [FEATURE NAME]

Plan ID: PLAN-YYYYMMDD-[FEATURE]
Generated: YYYY-MM-DD
Total Phases: [N]
Requirements: [List of REQ-IDs this plan implements]

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 0.5)
2. Defined integration contracts for multi-component features
3. Written integration tests BEFORE unit tests
4. Verified all dependencies and types exist as assumed
```

## Phase Template

Each phase MUST follow this structure:

````markdown
# Phase [NN]: [Phase Title]

## Phase ID

`PLAN-YYYYMMDD-[FEATURE].P[NN]`

## Prerequisites

- Required: Phase [NN-1] completed
- Verification: `grep -r "@plan:PLAN-YYYYMMDD-[FEATURE].P[NN-1]" .`
- Expected files from previous phase: [list]
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Requirements Implemented (Expanded)

For EACH requirement this phase implements, provide:

### REQ-XXX: [Requirement Title]

**Full Text**: [Copy the complete requirement text here - DO NOT just reference]
**Behavior**:

- GIVEN: [precondition]
- WHEN: [action]
- THEN: [expected outcome]
  **Why This Matters**: [1-2 sentences explaining the user value]

## Implementation Tasks

### Files to Create

- `path/to/file.ts` - [description]
  - MUST include: `@plan:PLAN-YYYYMMDD-[FEATURE].P[NN]`
  - MUST include: `@requirement:REQ-XXX`

### Files to Modify

- `path/to/existing.ts`
  - Line [N]: [change description]
  - ADD comment: `@plan:PLAN-YYYYMMDD-[FEATURE].P[NN]`
  - Implements: `@requirement:REQ-XXX`

### Required Code Markers

Every function/class/test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-YYYYMMDD-[FEATURE].P[NN]
 * @requirement REQ-XXX
 * @pseudocode lines X-Y (if applicable)
 */
```
````

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -r "@plan:PLAN-YYYYMMDD-[FEATURE].P[NN]" . | wc -l
# Expected: [N] occurrences

# Check requirements covered
grep -r "@requirement:REQ-XXX" . | wc -l
# Expected: [N] occurrences

# Run phase-specific tests
npm test -- --grep "@plan:.*P[NN]"
# Expected: All pass
```

### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases (P[NN-1] exists)
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Deferred Implementation Detection (MANDATORY after impl phases)

```bash
# Run ALL of these checks - if ANY match, phase FAILS:

# Check for TODO/FIXME/HACK markers left in implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" [modified-files] | grep -v ".test.ts"
# Expected: No matches (or only in comments explaining WHY, not WHAT to do)

# Check for "cop-out" comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" [modified-files] | grep -v ".test.ts"
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" [modified-files] | grep -v ".test.ts"
# Expected: No matches in implementation code (stubs are OK in stub phases)
```

### Semantic Verification Checklist (MANDATORY)

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read the requirement text
   - [ ] I read the implementation code (not just checked file exists)
   - [ ] I can explain HOW the requirement is fulfilled
2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Test verifies actual outputs, not just that code ran
   - [ ] Test would catch a broken implementation

4. **Is the feature REACHABLE by users?**
   - [ ] Code is called from existing code paths
   - [ ] There's a path from UI/CLI/API to this code

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

#### Feature Actually Works

```bash
# Manual test command (RUN THIS and paste actual output):
[insert feature-specific test command]
# Expected behavior: [describe what should happen]
# Actual behavior: [paste what actually happens]
```

#### Integration Points Verified

- [ ] Caller passes correct data type to callee (verified by reading both files)
- [ ] Callee processes data correctly (verified by tracing execution)
- [ ] Return value used correctly by caller (verified by checking usage site)
- [ ] Error handling works at component boundaries (verified by inducing error)

#### Lifecycle Verified

- [ ] Components initialize in documented order
- [ ] Async operations are awaited (no fire-and-forget)
- [ ] Resources are cleaned up on failure/success
- [ ] No race conditions in concurrent scenarios

#### Edge Cases Verified

- [ ] Empty/null input handled
- [ ] Invalid input rejected with clear error
- [ ] Boundary values work correctly
- [ ] Resource limits respected

## Success Criteria

- All verification commands return expected results
- No phases skipped in sequence
- Plan markers traceable in codebase

## Failure Recovery

If this phase fails:

1. Rollback commands: [specific git commands]
2. Files to revert: [list]
3. Cannot proceed to Phase [NN+1] until fixed

## Phase Completion Marker

Create: `project-plans/[feature]/.completed/P[NN].md`
Contents:

```markdown
Phase: P[NN]
Completed: YYYY-MM-DD HH:MM
Files Created: [list with line counts]
Files Modified: [list with diff stats]
Tests Added: [count]
Verification: [paste of verification command outputs]
```

````

## Example Phase (Filled Out)

```markdown
# Phase 07: Configuration Integration TDD

## Phase ID
`PLAN-20250113-EMOJIFILTER.P07`

## Prerequisites
- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20250113-EMOJIFILTER.P06" .`
- Expected files from previous phase:
  - `packages/core/src/filters/ConfigurationManager.ts`
  - `packages/core/src/filters/ConfigurationManager.test.ts`
- Preflight verification: Phase 0.5 completed

## Requirements Implemented (Expanded)

### REQ-003.1: Emoji Filter Mode Configuration
**Full Text**: Users MUST be able to configure emoji filtering via the /set command with modes: off, strip, replace
**Behavior**:
- GIVEN: User is in an active CLI session
- WHEN: User executes `/set emojifilter strip`
- THEN: All subsequent AI responses have emojis removed
**Why This Matters**: Some terminals don't render emojis correctly, causing display corruption

## Implementation Tasks

### Files to Create
- `packages/cli/src/ui/commands/test/setCommand.emojifilter.test.ts`
  - MUST include: `@plan:PLAN-20250113-EMOJIFILTER.P07`
  - MUST include: `@requirement:REQ-003.1`
  - Test: `/set emojifilter [mode]` command
  - Test: `/set unset emojifilter` command
  - Test: Invalid mode rejection
  - Test: Completion suggestions

### Files to Modify
- `packages/core/src/config/test/config.test.ts`
  - Line 450: Add test suite for emoji filter configuration
  - ADD comment: `@plan:PLAN-20250113-EMOJIFILTER.P07`
  - Implements: `@requirement:REQ-003.4` (hierarchy testing)

### Required Code Markers
Every test MUST include:
```typescript
it('should handle /set emojifilter command @plan:PLAN-20250113-EMOJIFILTER.P07 @requirement:REQ-003.1', () => {
  // test implementation
});
````

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250113-EMOJIFILTER.P07" . | wc -l
# Expected: 8+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-003.1" packages/cli/src/ui/commands/test/ | wc -l
# Expected: 3+ occurrences

# Run phase-specific tests (will fail until P08)
npm test -- --grep "@plan:.*P07"
# Expected: Tests exist but fail naturally
```

### Manual Verification Checklist

- [ ] Phase 06 markers present (ConfigurationManager)
- [ ] Test file created for setCommand emoji filter
- [ ] Tests follow behavioral pattern (no mocks)
- [ ] Tests will fail naturally until implementation
- [ ] All tests tagged with plan and requirement IDs

## Success Criteria

- 8+ tests created for /set emojifilter functionality
- All tests tagged with P07 marker
- Tests fail with "not implemented" not "cannot find"

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/cli/src/ui/commands/test/`
2. `git checkout -- packages/core/src/config/test/`
3. Re-run Phase 07 with corrected requirements

## Phase Completion Marker

Create: `project-plans/emojifilter/.completed/P07.md`

````

## Preflight Verification Phase Template (Phase 0.5)

Before implementation begins, create this mandatory phase:

```markdown
# Phase 0.5: Preflight Verification

## Purpose
Verify ALL assumptions before writing any code.

## Dependency Verification
| Dependency | npm ls Output | Status |
|------------|---------------|--------|
| [dep1] | [paste output] | OK/MISSING |
| [dep2] | [paste output] | OK/MISSING |

## Type/Interface Verification
| Type Name | Expected Definition | Actual Definition | Match? |
|-----------|---------------------|-------------------|--------|
| [Type1] | [what plan assumes] | [what code shows] | YES/NO |

## Call Path Verification
| Function | Expected Caller | Actual Caller | Evidence |
|----------|-----------------|---------------|----------|
| [func1] | [where plan says] | [grep output] | [file:line] |

## Test Infrastructure Verification
| Component | Test File Exists? | Test Patterns Work? |
|-----------|-------------------|---------------------|
| [comp1] | YES/NO | YES/NO |

## Blocking Issues Found
[List any issues that MUST be resolved before proceeding]

## Verification Gate
- [ ] All dependencies verified
- [ ] All types match expectations
- [ ] All call paths are possible
- [ ] Test infrastructure ready

IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.
```

---

## Inline Requirement Expansion Template

When referencing requirements, ALWAYS expand them inline:

```markdown
### Scenario: Profile JSON Parsing

**Requirement ID**: REQ-PROF-001.1
**Requirement Text**: The CLI MUST recognize --profile flag followed by a JSON string
**Behavior Specification**:
- GIVEN: User runs `llxprt --profile '{"provider":"openai"}'`
- WHEN: CLI parses arguments
- THEN: `bootstrapArgs.profileJson` equals the exact JSON string

**Why This Matters**: Without this, CI/CD automation cannot pass inline profiles

**Test Case**:
```typescript
it('parses --profile JSON argument', () => {
  const result = parseBootstrapArgs(['--profile', '{"provider":"openai"}']);
  expect(result.profileJson).toBe('{"provider":"openai"}');
});
```
```

This forces planners to UNDERSTAND the requirement, not just reference it.

---

## Plan Execution Tracking

At the start of the plan, create:

```markdown
# project-plans/[feature]/execution-tracker.md

## Execution Status

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 0.5 | P0.5 | [ ] | - | - | - | N/A | Preflight verification |
| 03 | P03 | [ ] | - | - | - | [ ] | Create stub |
| 04 | P04 | [ ] | - | - | - | [ ] | Write TDD tests |
| 05 | P05 | [ ] | - | - | - | [ ] | Implementation |
| 06 | P06 | [ ] | - | - | - | [ ] | Config stub |
| 07 | P07 | [ ] | - | - | - | [ ] | Config TDD |
| 08 | P08 | [ ] | - | - | - | [ ] | Config impl |
| 09 | P09 | [ ] | - | - | - | [ ] | Stream stub |
| 10 | P10 | [ ] | - | - | - | [ ] | Stream TDD |
| 11 | P11 | [ ] | - | - | - | [ ] | Stream impl |

Note: "Semantic?" column tracks whether semantic verification (feature actually works) was performed, not just structural verification (files exist).
| 12 | P12 | ⬜ | - | - | - | Tool stub |
| 13 | P13 | ⬜ | - | - | - | Tool TDD |
| 14 | P14 | ⬜ | - | - | - | Tool impl |
| 15 | P15 | ⬜ | - | - | - | Integration |
| 16 | P16 | ⬜ | - | - | - | E2E tests |

## Completion Markers

- [ ] All phases have @plan markers in code
- [ ] All requirements have @requirement markers
- [ ] Verification script passes
- [ ] No phases skipped
````

This must be updated after EACH phase.
