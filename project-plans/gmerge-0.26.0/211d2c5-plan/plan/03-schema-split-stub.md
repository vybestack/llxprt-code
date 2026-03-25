# Phase 03: Schema Split + Helper Update

## Phase ID

`PLAN-20260325-HOOKSPLIT.P03`

## Prerequisites

- Required: Phase 02a (Pseudocode Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P02a.md`
- Expected files from previous phase: All 4 pseudocode files in `analysis/pseudocode/`
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

### REQ-211-S01: New `hooksConfig` Settings Key

**Full Text**: The settings schema shall define a top-level `hooksConfig` key of type `object` with properties: `enabled` (boolean, default `false`), `disabled` (array of strings, default `[]`), `notifications` (boolean, default `true`).
**Behavior**:
- GIVEN: A settings schema definition
- WHEN: The schema is inspected
- THEN: `SETTINGS_SCHEMA.hooksConfig` exists with the specified properties, types, and defaults
**Why This Matters**: Without a separate schema key, config fields and event definitions are conflated in the same object.

### REQ-211-S02: `hooks` Contains Only Event Definitions

**Full Text**: The `hooks` settings schema shall not define `enabled`, `disabled`, or `notifications` as properties. The `hooks` object shall contain only hook event definitions.
**Behavior**:
- GIVEN: The updated settings schema
- WHEN: `SETTINGS_SCHEMA.hooks.properties` is inspected
- THEN: It does not contain `enabled`, `disabled`, or `notifications`
**Why This Matters**: Mixed objects cause type confusion and require runtime hacks to separate concerns.

### REQ-211-S03: `hooksConfig` Merge Strategy

**Full Text**: The `hooksConfig` settings key shall use `SHALLOW_MERGE` strategy.
**Behavior**:
- GIVEN: Settings from multiple scopes with different `hooksConfig` values
- WHEN: Settings are merged
- THEN: Individual fields from higher-priority scopes override lower-priority ones
**Why This Matters**: Allows workspace to override `enabled` while inheriting `disabled` from user settings.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/config/settingsSchema.ts`
  - ADD `hooksConfig` schema entry before `hooks` entry (around line 1857)
    - Stub: Define the schema structure with correct types, defaults, properties
    - This is NOT a stub in the traditional sense — the schema definition IS the implementation for this phase
  - MODIFY `hooks` schema entry (lines 1858-1901)
    - Remove `enabled`, `disabled`, `notifications` from `properties`
    - Update default type to remove the config field union
    - Keep `mergeStrategy: SHALLOW_MERGE`
  - ADD `@plan:PLAN-20260325-HOOKSPLIT.P03` marker
  - ADD `@requirement:REQ-211-S01`, `@requirement:REQ-211-S02`, `@requirement:REQ-211-S03` markers

### Why This Phase Does Both Schema AND Helper Update

This phase is titled "Schema Split + Helper Update" because it does more than a typical stub:

1. **Schema change** (declarative — the definition IS the implementation): Add `hooksConfig` entry, remove config fields from `hooks`
2. **`getEnableHooks()` update** (behavioral change): Switch from reading `hooks?.enabled` to `hooksConfig?.enabled`

Both changes are made in this phase because changing the schema changes the inferred Settings type, which would cause TypeScript errors in `getEnableHooks()` if it still read `hooks?.enabled`. Updating `getEnableHooks()` here keeps `npm run typecheck` green and avoids fragile temporary casts.

**This means P03 implements REQ-211-C01 (`enableHooks` reads from `hooksConfig`)**, not just the schema requirements. P05 then becomes a verification/cleanup phase rather than a primary implementation phase.

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P03
 * @requirement:REQ-211-S01, REQ-211-S02, REQ-211-S03
 * @pseudocode schema-split.md lines 01-46
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -r "@plan:PLAN-20260325-HOOKSPLIT.P03" packages/cli/src/config/settingsSchema.ts | wc -l
# Expected: 1+

# Check hooksConfig exists in schema
grep "hooksConfig" packages/cli/src/config/settingsSchema.ts | wc -l
# Expected: 1+

# Check hooks no longer has enabled/disabled/notifications in properties
# This should find hooksConfig properties but NOT hooks properties
grep -A 30 "^  hooks:" packages/cli/src/config/settingsSchema.ts | grep -c "enabled:\|disabled:\|notifications:"
# Expected: 0 (these are now in hooksConfig)

# TypeScript compiles
npm run typecheck

# Verify no TODO/FIXME in modified code
grep -n "TODO\|FIXME" packages/cli/src/config/settingsSchema.ts | grep -v "loading of hooks based on workspace"
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
   - [ ] `SETTINGS_SCHEMA.hooksConfig` exists with `enabled`, `disabled`, `notifications` properties
   - [ ] `SETTINGS_SCHEMA.hooks.properties` no longer contains config fields
   - [ ] `hooksConfig` has `mergeStrategy: SHALLOW_MERGE`

2. **Is this REAL implementation, not placeholder?**
   - [ ] Schema definition is complete (not a stub)
   - [ ] Types, defaults, descriptions all populated

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests in P04 will verify schema structure — not yet written

4. **Is the feature REACHABLE?**
   - [ ] Settings type is inferred from schema — changing schema changes the type
   - [ ] `getEnableHooks()` reads from the new location

5. **What's MISSING?** (expected — deferred to later phases)
   - [ ] Migration function (P06-P08)
   - [ ] Config constructor wiring (P09-P11)
   - [ ] CLI config loading updates (P12-P14)

## Success Criteria

- `SETTINGS_SCHEMA.hooksConfig` exists with all three properties
- `SETTINGS_SCHEMA.hooks` no longer has config fields in `properties`
- `getEnableHooks()` reads `hooksConfig?.enabled`
- `npm run typecheck` passes
- Plan markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/settingsSchema.ts`
2. Re-read pseudocode `schema-split.md` lines 01-46
3. Retry the schema changes

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P03.md`
