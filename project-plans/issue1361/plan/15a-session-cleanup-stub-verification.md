# Phase 15a: Session Cleanup Stub Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P15a`

## Prerequisites
- Required: Phase 15 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P15" packages/`

## Verification Commands

```bash
# TypeScript compiles
npm run typecheck

# New function stubs exist
grep -rq "cleanupStaleLocks" packages/ || echo "FAIL: cleanupStaleLocks not found"
grep -rq "shouldDeleteSession" packages/ || echo "FAIL: shouldDeleteSession not found"

# Existing tests still pass
npm run test -- --grep "cleanup\|sessionCleanup" 2>&1 | tail -10

# No TODO comments in new code
grep -rn "TODO" packages/cli/src/utils/sessionCleanup.ts | grep -i "P15" && echo "FAIL"

# Plan markers present
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P15" packages/cli/src/utils/sessionCleanup.ts packages/core/src/recording/sessionCleanupUtils.ts 2>/dev/null
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do function signatures match the pseudocode?** — [ ]
   - [ ] cleanupStaleLocks, shouldDeleteSession, getAllSessionFiles signatures correct
2. **Does the stub preserve existing cleanup behavior?** — [ ]
   - [ ] Existing tests still pass
   - [ ] No breaking changes to current session cleanup
3. **Is .jsonl pattern recognition present?** — [ ]
   - [ ] Scanner recognizes session-*.jsonl files
4. **Are imports prepared for SessionLockManager?** — [ ]
   - [ ] Import paths ready for Phase 17 implementation
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## What was created?
[Describe: New function stubs added to session cleanup module]

## Are signatures correct?
[Verify against pseudocode session-cleanup.md]

## Does existing behavior still work?
[Verify existing cleanup tests pass]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify stubs compile and existing cleanup still works
npm run typecheck
npm run test -- --grep "cleanup\|sessionCleanup" 2>&1 | tail -10
```

- [ ] Function signatures match pseudocode (session-cleanup.md lines 13-46, 50-80, 85-130)
- [ ] Stub doesn't break existing session cleanup behavior
- [ ] .jsonl file pattern recognition present in scanning logic
- [ ] SessionLockManager import path ready

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sessionCleanup.ts
# Re-implement Phase 15 stub
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P15a.md`
