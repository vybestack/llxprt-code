# Phase 06: Migration Function Stub

## Phase ID

`PLAN-20260325-HOOKSPLIT.P06`

## Prerequisites

- Required: Phase 05a (Schema Split Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P05a.md`
- Expected files from previous phase: Updated `settingsSchema.ts` with hooksConfig schema
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

### REQ-211-M01: Automatic Migration on Load

**Full Text**: When settings are loaded from disk, if the `hooks` object contains any of the keys `enabled`, `disabled`, or `notifications`, then those keys shall be moved to the `hooksConfig` object and removed from `hooks`.
**Behavior**:
- GIVEN: Settings with `hooks: { enabled: true, disabled: ["foo"], BeforeTool: [...] }`
- WHEN: `migrateHooksConfig()` is called
- THEN: `hooksConfig.enabled === true`, `hooksConfig.disabled` contains `"foo"`, `hooks` contains only `{ BeforeTool: [...] }`
**Why This Matters**: Without migration, existing user settings files silently break.

### REQ-211-M02: Migration Applies to All Scopes

**Full Text**: The migration shall execute for every loadable settings scope independently, before the settings merge step.
**Behavior**:
- GIVEN: System settings with `hooks.enabled: true` and user settings with `hooks.disabled: ["x"]`
- WHEN: Both are migrated before merge
- THEN: Merged result has `hooksConfig.enabled === true` and `hooksConfig.disabled` containing `"x"`
**Why This Matters**: Missing a scope silently drops that scope's hooks configuration.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/config/settings.ts`
  - ADD `migrateHooksConfig(settings: Settings): Settings` function
    - Stub: Function exists, returns settings unchanged (or throws NotYetImplemented)
    - Signature and return type must be correct
  - ADD call sites in `loadSettings()` for all 4 scope settings objects
    - Follow the existing pattern of `migrateLegacyInteractiveShellSetting()` (line 798)
    - Call BEFORE `mergeSettings()` / `new LoadedSettings()` (lines 801+)
  - ADD `@plan:PLAN-20260325-HOOKSPLIT.P06` marker
  - ADD `@requirement:REQ-211-M01`, `@requirement:REQ-211-M02` markers

### Stub Implementation

The stub should be a function with the correct signature that initially returns the input unchanged. This is a valid stub because it's a no-op (idempotent) and won't break existing behavior:

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P06
 * @requirement:REQ-211-M01, REQ-211-M02
 * @pseudocode migration.md lines 01-39
 */
function migrateHooksConfig(settings: Settings): Settings {
  // Stub: returns settings unchanged — will be implemented in P08
  return settings;
}
```

**Note**: Unlike most stubs that throw `NotYetImplemented`, this stub returns a valid no-op result. This is intentional: the migration is additive, and returning unchanged settings preserves existing behavior. The P07 TDD tests will fail because they expect the migration to actually move fields.

### Call Sites

Add after the existing `migrateLegacyInteractiveShellSetting` loop (around line 799):

```typescript
for (const scopeSettings of [
  systemSettings,
  systemDefaultSettings,
  userSettings,
  workspaceSettings,
]) {
  // Note: migrateHooksConfig returns a new object; we need to handle reassignment
  const migrated = migrateHooksConfig(scopeSettings);
  Object.assign(scopeSettings, migrated);
}
```

Or alternatively, since `migrateLegacyInteractiveShellSetting` mutates in place, migrateHooksConfig could also mutate in place for consistency. Decision: **return new object** — cleaner, follows functional pattern, and the `Object.assign` pattern is safe for shallow properties.

## Verification Commands

### Automated Checks

```bash
# Check function exists
grep -c "migrateHooksConfig" packages/cli/src/config/settings.ts
# Expected: 2+ (definition + call sites)

# Check plan markers
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P06" packages/cli/src/config/settings.ts
# Expected: 1+

# Check it's called for all scopes
grep -A 10 "migrateHooksConfig" packages/cli/src/config/settings.ts | grep -c "Settings\|scopeSettings\|system\|user\|workspace"
# Expected: 4+ (one call per scope)

# TypeScript compiles
npm run typecheck

# Existing tests still pass (stub is no-op)
npm test -- packages/cli/src/config/settings.test.ts
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
   - [ ] `migrateHooksConfig` function exists with correct signature
   - [ ] Called for all 4 scope settings objects
   - [ ] Called BEFORE `mergeSettings()` / `new LoadedSettings()`

2. **Is this REAL implementation, not placeholder?**
   - [ ] This IS a stub — body returns unchanged (acceptable for migration stub)
   - [ ] Call sites are real and correctly placed

3. **Would the test FAIL if implementation was removed?**
   - [ ] P07 TDD tests will verify actual migration behavior

4. **Is the feature REACHABLE?**
   - [ ] Called from `loadSettings()` which is the entry point for all settings loading

### Deferred Implementation Detection

```bash
# Stub is expected to have minimal implementation — verify it's marked as stub
grep -n "Stub\|stub\|will be implemented" packages/cli/src/config/settings.ts | head -5
# Expected: Comment noting this is a stub for P08 implementation
```

## Success Criteria

- `migrateHooksConfig` function exists with correct signature
- Called for all 4 scope settings in `loadSettings()`
- Called before merge step
- TypeScript compiles
- Existing tests pass (stub is no-op)

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/settings.ts`
2. Re-read pseudocode `migration.md` lines 01-39
3. Retry stub creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P06.md`
