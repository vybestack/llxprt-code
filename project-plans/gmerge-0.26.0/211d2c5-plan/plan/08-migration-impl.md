# Phase 08: Migration Function Implementation

## Phase ID

`PLAN-20260325-HOOKSPLIT.P08`

## Prerequisites

- Required: Phase 07a (Migration TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P07a.md`
- Expected files from previous phase: Migration tests in `settings.test.ts`

## Requirements Implemented (Expanded)

### REQ-211-M01: Automatic Migration on Load

**Full Text**: When settings are loaded from disk, if the `hooks` object contains any of the keys `enabled`, `disabled`, or `notifications`, then those keys shall be moved to the `hooksConfig` object and removed from `hooks`.
**Behavior**: See P07 for full GIVEN/WHEN/THEN.
**Why This Matters**: Backward compatibility for existing settings files.

### REQ-211-M02: Migration Applies to All Scopes

**Full Text**: Migration executes for every loadable settings scope independently, before the merge step.
**Why This Matters**: Missing a scope drops that scope's hooks configuration.

### REQ-211-M03: Migration Is Idempotent

**Full Text**: Migration produces identical results on already-migrated input.
**Why This Matters**: Runs every time settings are loaded.

### REQ-211-M04: Migration Does Not Overwrite Existing `hooksConfig` Values

**Full Text**: Existing `hooksConfig` values take precedence over migrated values.
**Why This Matters**: Prevents data loss in mixed-format scenarios.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/config/settings.ts`
  - REPLACE stub `migrateHooksConfig` with full implementation
  - Follow pseudocode `migration.md` lines 01-27 EXACTLY
  - ADD `@plan:PLAN-20260325-HOOKSPLIT.P08` marker
  - ADD `@requirement:REQ-211-M01`, `@requirement:REQ-211-M03`, `@requirement:REQ-211-M04` markers

### Implementation Per Pseudocode

From `analysis/pseudocode/migration.md`:

- **Line 01**: Function signature: `migrateHooksConfig(settings: Settings): Settings`
- **Lines 02-04**: Early return if `settings.hooks` is null/undefined
- **Lines 06-08**: Check if migration is needed (`enabled`, `disabled`, or `notifications` in hooks)
- **Lines 10-12**: Initialize `hooksConfig` (shallow copy of existing) and `newHooks` (empty)
- **Lines 14-21**: Iterate entries:
  - Config keys (`enabled`, `disabled`, `notifications`) → move to `hooksConfig` (don't overwrite)
  - All other keys → keep in `newHooks`
- **Lines 23-27**: Return new settings object with updated `hooksConfig` and `hooks`

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P08
 * @requirement:REQ-211-M01, REQ-211-M03, REQ-211-M04
 * @pseudocode migration.md lines 01-27
 */
```

### Files to Modify — All-Scope Call-Site Verification

The migration call sites were added in P06 (stub phase). With the implementation now complete, verify each scope call is correct in `packages/cli/src/config/settings.ts`:

1. **`systemSettings`** — `migrateHooksConfig(systemSettings)` called before merge
   - File: `packages/cli/src/config/settings.ts`
   - Location: Inside `loadSettings()`, after raw system settings are loaded
2. **`systemDefaultSettings`** — `migrateHooksConfig(systemDefaultSettings)` called before merge
   - File: `packages/cli/src/config/settings.ts`
   - Location: Inside `loadSettings()`, after raw system-default settings are loaded
3. **`userSettings`** — `migrateHooksConfig(userSettings)` called before merge
   - File: `packages/cli/src/config/settings.ts`
   - Location: Inside `loadSettings()`, after raw user settings are loaded
4. **`workspaceSettings`** — `migrateHooksConfig(workspaceSettings)` called before merge
   - File: `packages/cli/src/config/settings.ts`
   - Location: Inside `loadSettings()`, after raw workspace settings are loaded

**Verify ordering**: ALL four `migrateHooksConfig()` calls MUST appear BEFORE `mergeSettings()` / `new LoadedSettings()`. This is critical because migration must happen per-scope before the merge step combines them.

### MUST NOT

- Modify any test files
- Modify the settings file on disk (in-memory migration only)
- Overwrite existing `hooksConfig` values with hooks values
- Create duplicate files

## Verification Commands

### Automated Checks

```bash
# All migration tests pass
npm test -- packages/cli/src/config/settings.test.ts
# Expected: All pass

# TypeScript compiles
npm run typecheck

# Check plan markers
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P08" packages/cli/src/config/settings.ts
# Expected: 1+

# Check no test modifications
git diff packages/cli/src/config/settings.test.ts | wc -l
# Expected: 0 (no changes to test file)
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] Config fields moved from hooks to hooksConfig
   - [ ] Event definitions remain in hooks
   - [ ] Existing hooksConfig values not overwritten
   - [ ] Called for all 4 scopes in loadSettings()

2. **Is this REAL implementation, not placeholder?**
   - [ ] Full migration logic implemented
   - [ ] No empty returns, no TODO markers

3. **Would the test FAIL if implementation was removed?**
   - [ ] All P07 tests depend on actual migration behavior

4. **Is the feature REACHABLE?**
   - [ ] Called from `loadSettings()` which is the settings entry point

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/cli/src/config/settings.ts | grep -i "migrate\|hooks"
# Expected: No deferred work markers near migration code

grep -rn "return \[\]|return \{\}|return null" packages/cli/src/config/settings.ts | grep -i "migrate"
# Expected: No empty returns in migration function
```

## Success Criteria

- All P07 migration tests pass
- TypeScript compiles
- Implementation follows pseudocode lines 01-27
- No test modifications
- No deferred work markers

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/settings.ts`
2. Re-read pseudocode `migration.md` lines 01-27
3. Fix failing tests one at a time
4. Re-run verification

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P08.md`
