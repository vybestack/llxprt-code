# Phase 12a: CLI Loading Stub Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P12a`

## Prerequisites

- Required: Phase 12 completed
- Verification: `grep -r "@plan:PLAN-20260325-HOOKSPLIT.P12" packages/cli/src/config/config.ts`

## Verification Tasks

### 1. Destructuring Hack Removed

```bash
# No more destructuring of disabled from hooks
grep "disabled: _disabled" packages/cli/src/config/config.ts
# Expected: 0

# No more IIFE for hooks parameter
grep "hooks: (() =>" packages/cli/src/config/config.ts
# Expected: 0

# Clean hooks parameter
grep "hooks: effectiveSettings.hooks" packages/cli/src/config/config.ts
# Expected: 1 match
```

### 2. disabledHooks Parameter

```bash
# disabledHooks passed from hooksConfig
grep "disabledHooks.*hooksConfig\|hooksConfig.*disabled" packages/cli/src/config/config.ts
# Expected: 1+ match
```

### 3. Post-Construction Hack Removed

```bash
# No setDisabledHooks call after config construction
grep -A 30 "const enhancedConfig" packages/cli/src/config/config.ts | grep "setDisabledHooks"
# Expected: 0 matches
```

### 4. Message Update

```bash
grep "hooksConfig.enabled" packages/cli/src/ui/commands/hooksCommand.ts
# Expected: 1

grep "hooks.enabled" packages/cli/src/ui/commands/hooksCommand.ts
# Expected: 0
```

### 5. Guard Removals

```bash
grep "eventName === 'disabled'" packages/cli/src/commands/hooks/migrate.ts
# Expected: 0

grep "key === 'disabled'" packages/core/src/hooks/hookRegistry.ts
# Expected: 0
```

### 6. TypeScript Compiles

```bash
npm run typecheck
```

### 7. No Duplicate Files

```bash
find packages -name "*configV2*" -o -name "*hooksCommandV2*"
# Expected: No results
```

### Deferred Implementation Detection

```bash
for f in packages/cli/src/config/config.ts packages/cli/src/ui/commands/hooksCommand.ts packages/cli/src/commands/hooks/migrate.ts packages/core/src/hooks/hookRegistry.ts; do
  grep -rn -E "(TODO|FIXME|HACK|STUB)" "$f" | grep -iv "loading of hooks based on workspace"
done
# Expected: No new deferred work markers
```

## Success Criteria

- All four files updated correctly
- TypeScript compiles
- No old patterns remain
- No duplicate files
- No deferred work

## Semantic Verification Checklist (MANDATORY)

### Behavioral Verification Questions (answer ALL before proceeding)

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

### Feature Actually Works

```bash
# Manual test command (RUN THIS and paste actual output):
npm run typecheck && npm test -- packages/cli/src/config/ packages/cli/src/ui/commands/hooksCommand.test.ts packages/core/src/hooks/
# Expected behavior: TypeScript compiles, all affected tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] CLI config loading passes hooks directly (no destructuring — verified by reading code)
- [ ] disabledHooks extracted from hooksConfig.disabled (verified by reading code)
- [ ] No post-construction setDisabledHooks call (verified by grep)
- [ ] hooksCommand message references hooksConfig.enabled (verified by grep)
- [ ] migrate command has no eventName === 'disabled' guard (verified by grep)
- [ ] hookRegistry has no key === 'disabled' guard (verified by grep)

### Edge Cases Verified

- [ ] Missing hooksConfig in settings — disabledHooks defaults to []
- [ ] Missing hooks in settings — hooks defaults to {}
- [ ] hooksCommand shows correct guidance when hooks disabled

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P12a.md`
