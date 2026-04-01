# Phase 06a: Migration Stub Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P06a`

## Prerequisites

- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20260325-HOOKSPLIT.P06" packages/cli/src/config/settings.ts`

## Verification Tasks

### 1. Function Signature

```bash
# Verify function exists with correct name and return type
grep -A 2 "function migrateHooksConfig" packages/cli/src/config/settings.ts
# Expected: function migrateHooksConfig(settings: Settings): Settings (or similar)
```

### 2. Call Site Placement

```bash
# Verify migration is called BEFORE LoadedSettings construction
# The loadSettings function should call migrateHooksConfig before 'new LoadedSettings'
grep -n "migrateHooksConfig\|new LoadedSettings\|mergeSettings" packages/cli/src/config/settings.ts | sort -t: -k1 -n
# Expected: migrateHooksConfig calls appear BEFORE LoadedSettings/mergeSettings
```

### 3. All Scopes Covered

```bash
# Verify all 4 scopes are migrated
grep -B 2 -A 2 "migrateHooksConfig" packages/cli/src/config/settings.ts | grep -c "system\|user\|workspace\|scopeSettings"
# Expected: References to all 4 scopes (or loop over all 4)
```

### 4. TypeScript Compiles

```bash
npm run typecheck
```

### 5. Existing Tests Pass

```bash
npm test -- packages/cli/src/config/settings.test.ts
```

### 6. No Duplicate Files

```bash
find packages -name "*settingsV2*" -o -name "*settingsNew*"
# Expected: No results
```

## Success Criteria

- Function exists with correct signature
- Called for all 4 scopes
- Called before merge
- TypeScript compiles
- Existing tests pass

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
npm run typecheck && npm test -- packages/cli/src/config/settings.test.ts
# Expected behavior: TypeScript compiles, existing tests pass (stub is no-op)
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] migrateHooksConfig function exists with correct signature (verified by grep)
- [ ] Called for all 4 scopes in loadSettings (verified by reading call sites)
- [ ] Called BEFORE mergeSettings/LoadedSettings construction (verified by line ordering)
- [ ] Return type matches Settings type (verified by typecheck)

### Edge Cases Verified

- [ ] Stub returns settings unchanged (no-op behavior verified)
- [ ] Existing settings loading behavior unchanged (existing tests pass)
- [ ] Stub does not mutate the input object

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P06a.md`
