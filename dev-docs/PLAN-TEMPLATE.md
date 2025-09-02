# Plan Template for Multi-Phase Features

## Plan Header

```markdown
# Plan: [FEATURE NAME]

Plan ID: PLAN-YYYYMMDD-[FEATURE]
Generated: YYYY-MM-DD
Total Phases: [N]
Requirements: [List of REQ-IDs this plan implements]
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

### Automated Checks

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

### Manual Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases (P[NN-1] exists)
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

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

## Plan Execution Tracking

At the start of the plan, create:

```markdown
# project-plans/[feature]/execution-tracker.md

## Execution Status

| Phase | ID | Status | Started | Completed | Verified | Notes |
|-------|-----|--------|---------|-----------|----------|-------|
| 03 | P03 | ⬜ | - | - | - | Create stub |
| 04 | P04 | ⬜ | - | - | - | Write TDD tests |
| 05 | P05 | ⬜ | - | - | - | Implementation |
| 06 | P06 | ⬜ | - | - | - | Config stub |
| 07 | P07 | ⬜ | - | - | - | Config TDD |
| 08 | P08 | ⬜ | - | - | - | Config impl |
| 09 | P09 | ⬜ | - | - | - | Stream stub |
| 10 | P10 | ⬜ | - | - | - | Stream TDD |
| 11 | P11 | ⬜ | - | - | - | Stream impl |
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
