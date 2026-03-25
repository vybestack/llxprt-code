# Phase 08a: Migration Implementation Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P08a`

## Prerequisites

- Required: Phase 08 completed
- Verification: `grep -r "@plan:PLAN-20260325-HOOKSPLIT.P08" packages/cli/src/config/settings.ts`

## Verification Tasks

### 1. Pseudocode Compliance

Compare implementation with `analysis/pseudocode/migration.md`:

- [ ] Lines 01-04: Early return for null/undefined hooks
- [ ] Lines 06-08: needsMigration check for enabled/disabled/notifications in hooks
- [ ] Lines 10-12: hooksConfig initialization with existing values
- [ ] Lines 14-21: Iteration separating config keys from event keys
- [ ] Lines 17-18: Precedence check (don't overwrite existing hooksConfig keys)
- [ ] Lines 23-27: Return new settings object

### 2. All Tests Pass

```bash
npm test -- packages/cli/src/config/settings.test.ts
# Expected: All pass including migration tests
```

### 3. No Test Modifications

```bash
git diff packages/cli/src/config/settings.test.ts | wc -l
# Expected: 0
```

### 4. TypeScript Compiles

```bash
npm run typecheck
```

### 5. Call Site Verification

```bash
# Verify migration called before merge for all scopes
grep -n "migrateHooksConfig\|LoadedSettings\|mergeSettings" packages/cli/src/config/settings.ts | sort -t: -k1 -n
# Expected: migrateHooksConfig calls appear before LoadedSettings construction
```

### 6. Idempotency Spot Check

```bash
# Manual verification: Read the implementation and trace through twice
# Input: { hooks: { enabled: true, BeforeTool: [{...}] } }
# First call: { hooksConfig: { enabled: true }, hooks: { BeforeTool: [{...}] } }
# Second call: Same as first (no 'enabled' in hooks, so needsMigration=false, early return)
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/config/settings.ts | grep -iv "loading of hooks based on workspace"
# Expected: No new deferred work markers

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/config/settings.ts
# Expected: No cop-out comments
```

## Success Criteria

- Pseudocode compliance confirmed
- All tests pass
- No test modifications
- TypeScript compiles
- Migration called for all scopes before merge
- No deferred implementation

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
# Expected behavior: TypeScript compiles, ALL migration tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] migrateHooksConfig separates config keys from event keys correctly (verified by reading impl)
- [ ] Precedence: existing hooksConfig values NOT overwritten (verified by test + code reading)
- [ ] Migration called for all 4 scopes before merge (verified by reading loadSettings)
- [ ] Return type is Settings-compatible (verified by typecheck)

### Edge Cases Verified

- [ ] Empty hooks object returns input unchanged
- [ ] Settings with no hooks key returns input unchanged
- [ ] Double migration produces identical results (idempotency)
- [ ] Mixed old+new format preserves hooksConfig values

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P08a.md`
