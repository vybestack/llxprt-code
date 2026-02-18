# Phase 03a: Lifecycle Stub Verification

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P03a`

## Prerequisites

- Required: Phase 03 (lifecycle stub) completed
- Verification: `grep -r "PLAN-20250218-HOOKSYSTEM.P03" packages/core/src/hooks/`

## Verification Commands

### Structural Checks

```bash
# 1. Plan markers present
grep -r "PLAN-20250218-HOOKSYSTEM.P03" packages/core/src/hooks/ | wc -l
# Expected: 4+

# 2. TypeScript compiles cleanly
npm run typecheck 2>&1 | grep -E "error|warning" | head -10
# Expected: 0 errors

# 3. dispose() exists on both classes
grep -n "dispose" packages/core/src/hooks/hookSystem.ts
grep -n "dispose" packages/core/src/hooks/hookEventHandler.ts
# Expected: method definitions in both files

# 4. Management APIs on HookSystem
grep -n "setHookEnabled\|getAllHooks" packages/core/src/hooks/hookSystem.ts
# Expected: 2 method definitions

# 5. Constructor signature updated
grep -A 5 "constructor" packages/core/src/hooks/hookEventHandler.ts | head -20
# Expected: messageBus?: MessageBus and debugLogger?: DebugLogger in params

# 6. Session event enum types
grep -B1 -A3 "fireSessionStartEvent" packages/core/src/hooks/hookEventHandler.ts | head -10
# Expected: SessionStartSource in parameter type
grep -B1 -A3 "fireSessionEndEvent" packages/core/src/hooks/hookEventHandler.ts | head -10
# Expected: SessionEndReason in parameter type

# 7. makeEmptySuccessResult stub present
grep -n "makeEmptySuccessResult" packages/core/src/hooks/hookEventHandler.ts
# Expected: function definition present, returns spread of EMPTY_SUCCESS_RESULT

# 8. buildFailureEnvelope stub present
grep -n "buildFailureEnvelope" packages/core/src/hooks/hookEventHandler.ts
# Expected: function definition present, returns failure-shaped object

# 9. No V2/New/Copy files
find packages/core/src/hooks -name "*V2*" -o -name "*New*" -o -name "*Copy*" | wc -l
# Expected: 0

# 10. No TODO/FIXME in modified files
grep -rn "TODO\|FIXME\|HACK\|STUB" \
  packages/core/src/hooks/hookSystem.ts \
  packages/core/src/hooks/hookEventHandler.ts
# Expected: 0 matches
```

### Existing Tests Must Pass

```bash
# Run full hook test suite
npm test -- --testPathPattern="hooks" 2>&1 | tail -20
# Expected: all pre-existing tests still pass
# Note: NEW tests for P03 features will be written in P04 (TDD phase)

# Run typecheck on whole packages/core
cd packages/core && npm run typecheck
# Expected: 0 TypeScript errors
```

### Anti-Fraud Checks

```bash
# No reverse testing (tests expecting stub behavior)
grep -rn "NotYetImplemented\|expect.*not.*implement" \
  packages/core/src/hooks/*.test.ts 2>/dev/null
# Expected: 0 matches

# No duplicate file versions created
ls packages/core/src/hooks/ | grep -E "V2|New|Copy"
# Expected: 0 results
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" \
  packages/core/src/hooks/hookSystem.ts \
  packages/core/src/hooks/hookEventHandler.ts | grep -v ".test.ts"
# Expected: 0 matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet)" \
  packages/core/src/hooks/hookSystem.ts \
  packages/core/src/hooks/hookEventHandler.ts | grep -v ".test.ts"
# Expected: 0 matches
```

### Semantic Verification Checklist

1. **Do the stubs compile and have correct signatures?**
   - [ ] I read the constructor signature of HookEventHandler
   - [ ] I can confirm messageBus? and debugLogger? are in the signature
   - [ ] I can confirm dispose() returns void on both classes

2. **Are stubs truly minimal (not implementing behavior yet)?**
   - [ ] dispose() body is empty (no subscription logic in P03)
   - [ ] setHookEnabled delegates or is no-op
   - [ ] getAllHooks returns [] or delegates

3. **Would tests fail naturally (not on NotYetImplemented)?**
   - [ ] Phase 04 TDD tests will write tests expecting REAL behavior
   - [ ] Stubs return empty values of correct types, not throw

4. **Is the feature reachable by users after this phase?**
   - [ ] HookSystem constructor accepts new params (users can start passing them)
   - [ ] dispose() callable from HookSystem teardown
   - [ ] Management APIs callable

5. **What's missing (expected — implemented in P05)?**
   - dispose() does not yet unsubscribe (no subscription exists yet)
   - buildFailureEnvelope is minimal (full impl in P14)
   - makeEmptySuccessResult is minimal (full impl in P14)

#### Holistic Assessment

**What was implemented?**
Minimal skeletons on HookSystem and HookEventHandler that compile and expose
the correct API surface for lifecycle management (dispose, management APIs)
and type-safe parameter signatures.

**Does it satisfy the Phase A stub requirements?**
Yes — stubs exist with correct types, TypeScript compiles, existing tests pass.
Behavior will be implemented in P05 after TDD tests are written in P04.

**Verdict**: PASS if all structural checks pass, TypeScript compiles, existing tests pass,
and no TODO/FIXME markers found.

## Success Criteria

- All structural checks green
- npm run typecheck passes
- Existing hook tests pass
- No TODO/FIXME in modified files
- Plan markers on all changes

## Failure Recovery

1. `git diff packages/core/src/hooks/` — identify what changed
2. `git checkout -- packages/core/src/hooks/hookSystem.ts` — revert if needed
3. Re-run P03 with corrections
4. Cannot proceed to P04 until this verification passes

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P03a.md`

```markdown
Phase: P03a
Completed: YYYY-MM-DD HH:MM
TypeScript: PASS
Existing Tests: PASS
Plan Markers: PASS
No TODO/FIXME: PASS
Verdict: PASS/FAIL
```
