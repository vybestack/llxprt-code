# Phase 08a: Profile Parsing Implementation Verification

## Phase ID
`PLAN-20251118-ISSUE533.P08a`

## Prerequisites
- Required: Phase 08 completed (implementation done)
- Verification: All Phase 07 tests should pass

## Verification Tasks

### Automated Verification

```bash
# 1. Verify implementation exists (not stub)
grep -A 3 "function parseInlineProfile" packages/cli/src/config/profileBootstrap.ts | grep -v "STUB"
# Expected: Real implementation visible

# 2. Verify schema file exists
test -f packages/core/src/types/profileSchemas.ts && echo "PASS" || echo "FAIL"
# Expected: PASS

# 3. Verify all Phase 07 tests pass
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P07"
# Expected: 20/20 tests pass

# 4. Verify TypeScript compilation
npm run typecheck
# Expected: Exit code 0

# 5. Verify build succeeds
npm run build
# Expected: Exit code 0

# 6. Verify plan markers
grep -c "@plan.*P08" packages/cli/src/config/profileBootstrap.ts
# Expected: 3+ (one per function/section)

# 7. Verify no broken tests
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: All tests pass (including P04, P05, P07)
```

### Manual Verification Checklist

- [ ] Phase 08 completion marker exists
- [ ] `parseInlineProfile()` fully implemented
- [ ] `getMaxNestingDepth()` helper implemented
- [ ] `formatValidationErrors()` helper implemented
- [ ] `ProfileSchema` file created in packages/core/src/types/
- [ ] All 20 Phase 07 tests pass
- [ ] No test files modified
- [ ] TypeScript compiles with no errors
- [ ] Build completes successfully
- [ ] Plan markers present on all changes
- [ ] Pseudocode references included

## Exit Criteria

- All verification commands pass
- 20/20 tests pass
- Implementation matches pseudocode
- Ready for Phase 09 (bootstrap integration)

## Failure Recovery

If verification fails:

1. **Tests failing**: Review error messages, check Zod schema matches tests
2. **Schema file missing**: Create packages/core/src/types/profileSchemas.ts
3. **TypeScript errors**: Check imports, Profile interface compatibility
4. **Build fails**: Check for syntax errors, missing dependencies

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P08a.md`

```markdown
Phase: P08a
Completed: [YYYY-MM-DD HH:MM]
Verification Results:
  - Implementation exists: [OK]
  - Schema file exists: [OK]
  - Phase 07 tests (20): PASS [OK]
  - TypeScript compiles: [OK]
  - Build succeeds: [OK]
  - Plan markers: [OK]
All Checks: PASS
```
