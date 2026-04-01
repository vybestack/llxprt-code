# Phase 03a: Schema Split + Helper Update Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P03a`

## Prerequisites

- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20260325-HOOKSPLIT.P03" packages/cli/src/config/settingsSchema.ts`

## Verification Tasks

### 1. Schema Structure Verification

```bash
# Verify hooksConfig exists in SETTINGS_SCHEMA
grep -c "hooksConfig:" packages/cli/src/config/settingsSchema.ts
# Expected: 1

# Verify hooksConfig has enabled property
grep -A 40 "hooksConfig:" packages/cli/src/config/settingsSchema.ts | grep -c "enabled:"
# Expected: 1

# Verify hooksConfig has disabled property
grep -A 40 "hooksConfig:" packages/cli/src/config/settingsSchema.ts | grep -c "disabled:"
# Expected: 1

# Verify hooksConfig has notifications property
grep -A 40 "hooksConfig:" packages/cli/src/config/settingsSchema.ts | grep -c "notifications:"
# Expected: 1

# Verify hooksConfig has SHALLOW_MERGE
grep -A 15 "hooksConfig:" packages/cli/src/config/settingsSchema.ts | grep -c "SHALLOW_MERGE"
# Expected: 1
```

### 2. Hooks Schema Cleanup

```bash
# Verify hooks properties no longer contain config fields
# Find the hooks: entry and check its properties block
grep -A 20 "^  hooks:" packages/cli/src/config/settingsSchema.ts | grep -cE "^\s+(enabled|disabled|notifications):"
# Expected: 0

# Verify hooks default type no longer includes config fields
grep -A 5 "default:.*HookEventName" packages/cli/src/config/settingsSchema.ts | grep -c "enabled\|disabled\|notifications"
# Expected: 0
```

### 3. getEnableHooks Update

```bash
# Verify getEnableHooks reads from hooksConfig
grep "hooksConfig.*enabled" packages/cli/src/config/settingsSchema.ts
# Expected: 1 match in getEnableHooks function
```

### 4. TypeScript Compilation

```bash
npm run typecheck
# Expected: Exit code 0
```

### 5. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P03" packages/cli/src/config/settingsSchema.ts
# Expected: 1+

grep -c "@requirement:REQ-211-S0" packages/cli/src/config/settingsSchema.ts
# Expected: 1+
```

### 6. No Duplicate Versions

```bash
find packages -name "*settingsSchemaV2*" -o -name "*settingsSchemaNew*"
# Expected: No results
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/cli/src/config/settingsSchema.ts | grep -v "loading of hooks based on workspace"
# Expected: No new TODO/FIXME/HACK/STUB markers
```

## Success Criteria

- hooksConfig schema entry exists with all 3 properties
- hooks schema entry has no config fields
- getEnableHooks reads hooksConfig.enabled
- TypeScript compiles
- Plan markers present

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
npm run typecheck && npm test -- packages/cli/src/config/settingsSchema.test.ts
# Expected behavior: TypeScript compiles, schema tests pass with hooksConfig
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] hooksConfig schema entry has correct type, defaults, and mergeStrategy
- [ ] hooks schema entry no longer has enabled/disabled/notifications in properties
- [ ] getEnableHooks reads from hooksConfig.enabled (verified by reading function body)
- [ ] Settings type inference includes hooksConfig (verified by typecheck)

### Edge Cases Verified

- [ ] Empty hooksConfig object uses correct defaults (enabled: false, disabled: [], notifications: true)
- [ ] Missing hooksConfig key handled (undefined access via optional chaining)
- [ ] hooks with only event definitions compiles correctly

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P03a.md`
