# Phase 05a: Schema Split Verification + Cleanup Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P05a`

## Prerequisites

- Required: Phase 05 completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P05.md`

## Verification Tasks

### 1. Pseudocode Compliance

Compare implementation with `analysis/pseudocode/schema-split.md`:

- [ ] Lines 01-27 (hooksConfig definition): All properties present with correct types and defaults
- [ ] Lines 28-37 (hooks modification): Config fields removed from properties; default type cleaned
- [ ] Lines 39-42 (getEnableHooks): Reads `hooksConfig?.enabled`
- [ ] Lines 44-46 (getEnableHooksUI): Unchanged

### 2. Comprehensive Verification

```bash
# Schema structure
npm run typecheck

# All tests pass
npm test -- packages/cli/src/config/settingsSchema.test.ts

# No old-format reads
grep "settings\.hooks\?\.\(enabled\|disabled\|notifications\)" packages/cli/src/config/settingsSchema.ts
# Expected: No matches (getEnableHooks now reads hooksConfig)
```

### 3. Type Inference Verification

```bash
# Verify the inferred Settings type includes hooksConfig
# This is implicit — if typecheck passes and tests use hooksConfig, the type is correct
npm run typecheck
```

### 4. Merge Strategy Verification

```bash
# Verify both hooks and hooksConfig have SHALLOW_MERGE
grep -B 5 "SHALLOW_MERGE" packages/cli/src/config/settingsSchema.ts | grep -E "hooks|hooksConfig"
# Expected: Both hooks and hooksConfig sections reference SHALLOW_MERGE
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/config/settingsSchema.ts | grep -v "loading of hooks"
# Expected: No new deferred work

grep -rn "return \[\]|return \{\}|return null|return undefined" packages/cli/src/config/settingsSchema.ts
# Expected: No empty returns in implementation
```

## Success Criteria

- Pseudocode compliance confirmed for all line ranges
- TypeScript compiles
- Tests pass
- No old-format reads remain
- Both merge strategies correct

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
# Expected behavior: TypeScript compiles clean, all schema tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] hooksConfig schema definition is complete (all 3 properties, types, defaults)
- [ ] hooks schema has no config fields in properties (verified by grep)
- [ ] getEnableHooks reads hooksConfig.enabled (verified by reading function body)
- [ ] Both hooks and hooksConfig have SHALLOW_MERGE strategy (verified by grep)

### Edge Cases Verified

- [ ] Settings with only hooksConfig (no hooks key) — typecheck passes
- [ ] Settings with only hooks (no hooksConfig key) — typecheck passes
- [ ] getEnableHooks with undefined hooksConfig returns false

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P05a.md`
