# Phase 03a: Final Verification — Mandatory MessageBus Injection

## Phase ID
`PLAN-20260303-MESSAGEBUS.P03a`

## Prerequisites
- Phase 03 completed

## Verification Tasks

### 1. No service locator usage
```bash
result=$(grep -rn "config\.getMessageBus\|config\.setMessageBus" packages/ --include="*.ts" | grep -v "\.d\.ts" | wc -l)
if [ "$result" -ne 0 ]; then echo "FAIL: $result service locator references remain"; exit 1; fi
echo "PASS: No service locator usage"
```

### 2. No setMessageBus shim
```bash
result=$(grep -rn "setMessageBus" packages/core/src/ --include="*.ts" | grep -v test | grep -v "\.d\.ts" | wc -l)
if [ "$result" -ne 0 ]; then echo "FAIL: $result setMessageBus references remain"; exit 1; fi
echo "PASS: No setMessageBus shim"
```

### 3. Config class clean
```bash
result=$(grep -n "messageBus\|MessageBus" packages/core/src/config/config.ts | wc -l)
if [ "$result" -ne 0 ]; then echo "FAIL: Config still references MessageBus"; exit 1; fi
echo "PASS: Config class clean"
```

### 4. Full verification suite
```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

## Success Criteria
- All 4 structural checks pass (zero unwanted references)
- Full verification suite passes

## Failure Recovery
If structural checks fail, find remaining references and fix them. If tests fail, check that all test constructors provide MessageBus via `createMockMessageBus()`.

## Subagent Prompt

```markdown
CONTEXT: You are verifying Phase 03 of the MessageBus DI migration (PLAN-20260303-MESSAGEBUS.P03a).
This is the FINAL verification phase. All service locator patterns must be eliminated.

Run all structural and semantic verification checks below. Report PASS/FAIL for each.
Verify zero config.getMessageBus() references, zero setMessageBus() methods, mandatory injection everywhere.
```


## Structural Verification Checklist

- [ ] No `config.getMessageBus()` references (verified = 0)
- [ ] No `setMessageBus()` methods (verified = 0)
- [ ] Config class has no MessageBus code (verified = 0 references)
- [ ] All MessageBus parameters are required (no `?:` optional)
- [ ] All @plan:PLAN-20260303-MESSAGEBUS.P03 markers present
- [ ] TypeScript compiles
- [ ] All tests pass
- [ ] Lint passes
- [ ] Build succeeds

## Semantic Verification Checklist

**Behavioral Verification Questions**:

1. **Does the code DO what Phase 3 requires?**
   - [ ] Service locator pattern completely removed
   - [ ] MessageBus mandatory everywhere
   - [ ] Config class no longer manages MessageBus

2. **Would the system FAIL without proper MessageBus injection?**
   - [ ] TypeScript enforces required parameter (won't compile without it)
   - [ ] No fallback paths exist
   - [ ] System cannot function without MessageBus

3. **Is this REAL implementation, not placeholder?**
   - [ ] All fallback logic removed
   - [ ] All service locator calls replaced
   - [ ] Tests updated to always provide MessageBus

4. **Integration Points Verified** (end-to-end):
   - [ ] CLI → CoreToolScheduler → ToolRegistry → Tool → Invocation (MessageBus flows through)
   - [ ] MessageBus used for policy confirmations (tested)
   - [ ] MessageBus publish/subscribe works (tested)

5. **Lifecycle Verified**:
   - [ ] MessageBus created at session start (verified by reading CLI code)
   - [ ] MessageBus passed down dependency tree (verified)
   - [ ] MessageBus available throughout session (verified)

6. **Edge Cases Verified**:
   - [ ] TypeScript prevents missing MessageBus (compile-time check)
   - [ ] No runtime null checks needed (type system enforces)
   - [ ] Error handling preserved (MessageBus errors already handled)

7. **What was LEARNED?** (document for future migrations)
   - [ ] [Any insights about the migration process]
   - [ ] [Challenges encountered and solutions]
   - [ ] [LLxprt-specific considerations]

## Deferred Implementation Detection

```bash
# Check for any remaining TODOs related to MessageBus
grep -rn "TODO.*MessageBus\|FIXME.*MessageBus\|HACK.*MessageBus" packages/core/src/ --include="*.ts"
# Expected: 0 matches

# Check for any remaining service locator patterns
grep -rn "config\.get.*Bus\|config\.set.*Bus" packages/core/src/ --include="*.ts" | grep -v test
# Expected: 0 matches
```

## Final Verification Battery

Run ALL of these checks — if ANY fail, Phase 3 is NOT complete:

```bash
# 1. Service locator eradicated
result=$(grep -rn "config\.getMessageBus\|config\.setMessageBus" packages/ --include="*.ts" | grep -v "\.d\.ts" | wc -l)
if [ "$result" -ne 0 ]; then echo "FAIL: $result service locator references remain"; exit 1; fi
echo "PASS: No service locator usage"

# 2. setMessageBus shim eradicated
result=$(grep -rn "setMessageBus" packages/core/src/ --include="*.ts" | grep -v test | grep -v "\.d\.ts" | wc -l)
if [ "$result" -ne 0 ]; then echo "FAIL: $result setMessageBus references remain"; exit 1; fi
echo "PASS: No setMessageBus shim"

# 3. Config class clean
result=$(grep -n "messageBus\|MessageBus" packages/core/src/config/config.ts | wc -l)
if [ "$result" -ne 0 ]; then echo "FAIL: Config still references MessageBus"; exit 1; fi
echo "PASS: Config class clean"

# 4. TypeScript compiles
npm run typecheck || { echo "FAIL: TypeScript errors"; exit 1; }
echo "PASS: TypeScript compiles"

# 5. All tests pass
npm run test || { echo "FAIL: Tests failing"; exit 1; }
echo "PASS: All tests pass"

# 6. Lint passes
npm run lint || { echo "FAIL: Lint errors"; exit 1; }
echo "PASS: Lint passes"

# 7. Build succeeds
npm run build || { echo "FAIL: Build failed"; exit 1; }
echo "PASS: Build succeeds"

echo ""
echo "ALL CHECKS PASSED — MessageBus DI migration COMPLETE"
```

## Phase Completion Marker

**Create**: `project-plans/gmerge-0.24.5/messagebus/.completed/P03a.md`

**Contents**:
```markdown
# Phase 03a: Final Verification — MessageBus DI Migration COMPLETE

**Completed**: YYYY-MM-DD HH:MM
**Total Phases**: 7 (1 preflight + 3 implementation + 3 verification)
**Total Files Changed**: ~96 files (16 + 23 + 57 across all phases)

## Final Verification Results

### Service Locator Eradication
```bash
# config.getMessageBus() references: 0
grep -rn "config\.getMessageBus\|config\.setMessageBus" packages/ --include="*.ts" | grep -v "\.d\.ts" | wc -l
# Result: 0 [OK] PASS

# setMessageBus() references: 0
grep -rn "setMessageBus" packages/core/src/ --include="*.ts" | grep -v test | grep -v "\.d\.ts" | wc -l
# Result: 0 [OK] PASS

# Config class MessageBus references: 0
grep -n "messageBus\|MessageBus" packages/core/src/config/config.ts | wc -l
# Result: 0 [OK] PASS
```

### TypeScript Compilation
```
[Paste npm run typecheck output]
[OK] PASS
```

### Test Suite
```
[Paste npm run test summary]
[OK] PASS — All tests passing
```

### Lint
```
[Paste npm run lint output]
[OK] PASS
```

### Build
```
[Paste npm run build output]
[OK] PASS — Build succeeded
```

## Migration Statistics

### Phase Breakdown
- Phase 00a (Preflight): Verified 33 production files, 24 test files, 717 references
- Phase 01 (Optional Params): 16 files changed
- Phase 02 (Standardize): 23 files changed
- Phase 03 (Mandatory): 57 files changed
- **Total**: ~96 files modified across all phases

### Upstream Alignment
- Upstream Phase 1 (eec5d5ebf839): 16 files [OK] Matched
- Upstream Phase 2 (90be9c35876d): 23 files [OK] Matched
- Upstream Phase 3 (12c7c9cc426b): 57 files [OK] Matched
- LLxprt-specific adaptations: Applied for ripGrep, ast-grep, structural-analysis, etc.

## Final State Summary

### Before Migration
- Service locator: config.getMessageBus() used in 5 locations
- setMessageBus() shim: 1 dead stub in ToolRegistry
- MessageBus managed by Config class
- Optional MessageBus parameters with fallback

### After Migration
- Service locator: REMOVED
- setMessageBus() shim: REMOVED
- MessageBus NOT in Config (proper separation)
- Mandatory MessageBus parameters everywhere (constructor DI)

### Architectural Improvement
- Pure constructor dependency injection
- Explicit dependencies (no hidden service locator)
- Type-safe (TypeScript enforces MessageBus presence)
- Testable (easy to mock MessageBus)

## Lessons Learned
[Document any insights, challenges, or LLxprt-specific considerations]

## MIGRATION COMPLETE
MessageBus DI refactoring successfully completed. All phases verified. System ready for next upstream merge.
```

**Congratulations!** The MessageBus DI migration is complete. Service locator pattern eliminated, constructor injection enforced everywhere.
