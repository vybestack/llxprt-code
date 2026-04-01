# Phase 09a: Config Types Stub Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P09a`

## Prerequisites

- Required: Phase 09 completed
- Verification: `grep -r "@plan:PLAN-20260325-HOOKSPLIT.P09" packages/core/src/config/config.ts`

## Verification Tasks

### 1. Type Safety

```bash
# Verify projectHooks private field type is clean
grep -A 3 "private.*projectHooks" packages/core/src/config/config.ts | grep "disabled"
# Expected: No matches

# Verify getProjectHooks return type is clean
grep -B 1 -A 3 "getProjectHooks" packages/core/src/config/config.ts | grep "disabled"
# Expected: No matches
```

### 2. Constructor Wiring

```bash
# Verify disabledHooks is set from params in constructor
grep -A 20 "this.hooks = params.hooks" packages/core/src/config/config.ts | grep "disabledHooks"
# Expected: this.disabledHooks = params.disabledHooks ?? []
```

### 3. Persistence Key

```bash
# Verify new key used in getDisabledHooks
grep -A 5 "getDisabledHooks" packages/core/src/config/config.ts | grep "hooksConfig.disabled"
# Expected: 1 match

# Verify new key used in setDisabledHooks
grep -A 5 "setDisabledHooks" packages/core/src/config/config.ts | grep "hooksConfig.disabled"
# Expected: 1 match

# Verify old key not used
grep "'hooks.disabled'" packages/core/src/config/config.ts
# Expected: 0 matches
```

### 4. TypeScript Compiles

```bash
npm run typecheck
# Expected: Exit code 0 (type changes may initially break consumers — fix if needed)
```

### 5. Hook Registry Type Compatibility

```bash
# If getProjectHooks() type changed, verify hookRegistry.ts still compiles
# The 'if (key === "disabled") continue;' guard in hookRegistry.ts
# should still compile even though the type no longer includes disabled
npm run typecheck
```

### 6. No Duplicate Files

```bash
find packages -name "*configV2*" -o -name "*configNew*"
# Expected: No results
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/config/config.ts | grep -i "disabled\|hooks\|project"
# Expected: No deferred work in modified areas
```

## Success Criteria

- Private field type is pure event map
- Return type is pure event map
- Constructor wires disabledHooks
- Persistence key is 'hooksConfig.disabled'
- TypeScript compiles
- No duplicate files

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
npm run typecheck && npm test -- packages/core/src/hooks/
# Expected behavior: TypeScript compiles with updated types, hook tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] projectHooks private field type is pure event map (verified by reading code)
- [ ] getProjectHooks return type matches private field (verified by reading code)
- [ ] Constructor wires disabledHooks from params (verified by reading constructor)
- [ ] Persistence key changed in both get and set (verified by grep)

### Edge Cases Verified

- [ ] Config constructed without disabledHooks param defaults to empty array
- [ ] Config constructed with empty disabledHooks works correctly
- [ ] hookRegistry compiles without the disabled key in projectHooks type

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P09a.md`
