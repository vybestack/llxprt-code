# Phase 03a: Type Extension Verification

## Phase ID
`PLAN-20251118-ISSUE533.P03a`

## Prerequisites
- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20251118-ISSUE533.P03" packages/cli/src/config/profileBootstrap.ts`
- Expected files from previous phase:
  - `packages/cli/src/config/profileBootstrap.ts` with `profileJson` field

## Verification Tasks

### Automated Verification

```bash
# 1. Verify TypeScript compilation
npm run typecheck
# Expected: Exit code 0, no errors

# 2. Verify field exists in interface
grep -A 8 "export interface BootstrapProfileArgs" packages/cli/src/config/profileBootstrap.ts | \
  grep "profileJson: string | null"
# Expected: 1 match

# 3. Verify plan marker present
grep "@plan:PLAN-20251118-ISSUE533.P03" packages/cli/src/config/profileBootstrap.ts
# Expected: 1 match

# 4. Verify requirement marker present
grep "@requirement:REQ-PROF-001.1" packages/cli/src/config/profileBootstrap.ts
# Expected: 1 match

# 5. Verify no unintended changes
git diff packages/cli/src/config/profileBootstrap.ts | grep "^+" | wc -l
# Expected: ~3 lines (field + comments)

# 6. Verify exports still work
npm run build
# Expected: Exit code 0
```

### Manual Verification Checklist

- [ ] Phase 03 completion marker exists
- [ ] `profileJson` field type is exactly `string | null`
- [ ] Field positioned logically (after `profileName`)
- [ ] No other code modified in file
- [ ] No test files created or modified
- [ ] TypeScript compilation succeeds
- [ ] Build succeeds

## Success Criteria

- All verification commands pass
- No TypeScript errors
- No build errors
- Plan markers traceable
- Only expected changes in git diff

## Failure Recovery

If this phase fails:

1. Check TypeScript errors: `npm run typecheck`
2. Verify exact field syntax: `string | null` (not `string | null | undefined`)
3. Ensure comment format: `// @plan:PLAN-20251118-ISSUE533.P03`
4. Rollback if needed: `git checkout -- packages/cli/src/config/profileBootstrap.ts`
5. Re-run Phase 03

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P03a.md`

```markdown
Phase: P03a
Completed: [YYYY-MM-DD HH:MM]
Verification Results:
  - TypeScript compiles: [OK]
  - Plan markers found: [OK]
  - Requirement markers found: [OK]
  - Build succeeds: [OK]
  - No unintended changes: [OK]
All Checks: PASS
```
