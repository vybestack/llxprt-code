# Phase 24a: /stats Session Section — Stub Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P24a`

## Prerequisites

- Required: Phase 24 completed
- Verification: `test -f project-plans/issue1385/.completed/P24.md`

## Verification Commands

### Automated Checks

```bash
# 1. Plan markers present
grep -r "@plan PLAN-20260214-SESSIONBROWSER.P24" packages/cli/src/ | wc -l
# Expected: 2+ occurrences

# 2. Stub file exists with correct export
grep "export.*formatSessionSection" packages/cli/src/ui/commands/formatSessionSection.ts
# Expected: 1 match

# 3. Function signature correct
grep "SessionRecordingMetadata.*null" packages/cli/src/ui/commands/formatSessionSection.ts
# Expected: Present in the function parameter

# 4. statsCommand imports it
grep "formatSessionSection" packages/cli/src/ui/commands/statsCommand.ts
# Expected: import present

# 5. TypeScript compiles
npm run typecheck
# Expected: Pass

# 6. No TODO markers
grep -rn "TODO\|FIXME\|HACK" packages/cli/src/ui/commands/formatSessionSection.ts | grep -v test
# Expected: 0 matches
```

### Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] REQ-ST-001: `formatSessionSection` stub exists and is callable from `statsCommand`
   - [ ] REQ-ST-006: The null parameter path exists in the type signature

2. **Is this REAL stub, not placeholder?**
   - [ ] Either throws NotYetImplemented or returns empty array
   - [ ] Type signature is complete and final

3. **Is the feature REACHABLE?**
   - [ ] `statsCommand.ts` calls `formatSessionSection`
   - [ ] The import path is correct

4. **What's MISSING?** (expected for stub)
   - [ ] Actual formatting logic (P26)
   - [ ] Tests (P25)

### Feature Actually Works

```bash
# Manual test: Run stats command (session section will be empty/stub)
# Just verify it doesn't crash
npm run typecheck && echo "Typecheck passed"
```

### Pass/Fail Criteria

- **PASS**: All checks green, TypeScript compiles, stub has correct signature
- **FAIL**: Any compilation error, missing file, or wrong signature

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P24a.md`
