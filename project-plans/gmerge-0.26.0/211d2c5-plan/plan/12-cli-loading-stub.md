# Phase 12: CLI Loading + Commands Stub

## Phase ID

`PLAN-20260325-HOOKSPLIT.P12`

## Prerequisites

- Required: Phase 11a (Config Types Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P11a.md`
- Expected files from previous phase: Updated `Config` class with correct types, constructor wiring, persistence keys
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

### REQ-211-C02: `hooks` Passed to Config Is Pure Event Map

**Full Text**: The `hooks` parameter passed to `Config` constructor shall be a pure event map containing no `enabled`, `disabled`, or `notifications` keys. The destructuring workaround is removed.
**Behavior**:
- GIVEN: Settings with `hooks` as pure event map (after migration)
- WHEN: Config is constructed
- THEN: `hooks` parameter has no config fields
**Why This Matters**: Eliminates the destructuring hack in CLI config loading.

### REQ-211-C03: `disabledHooks` Is Explicit Config Parameter

**Full Text**: `disabledHooks` is passed explicitly from `settings.hooksConfig?.disabled`.
**Behavior**:
- GIVEN: Settings with `hooksConfig: { disabled: ['x'] }`
- WHEN: Config is constructed
- THEN: `disabledHooks` parameter is `['x']`
**Why This Matters**: Clean parameter passing instead of post-construction hack.

### REQ-211-CMD02: User-Facing Messages Reference `hooksConfig.enabled`

**Full Text**: The message displayed when hooks are not enabled contains `hooksConfig.enabled` instead of `hooks.enabled`.
**Behavior**:
- GIVEN: Hooks system is not enabled
- WHEN: `/hooks list` command is invoked
- THEN: Message says "Enable it in settings with hooksConfig.enabled"
**Why This Matters**: Users need correct guidance on which setting to change.

### REQ-211-HD03: Trust Scan Treats Project Hooks as Pure Event Map

**Full Text**: `checkProjectHooksTrust()` shall not filter out a `disabled` pseudo-key.
**Behavior**:
- GIVEN: Updated hook registry
- WHEN: Trust scan iterates project hooks
- THEN: No `if (key === 'disabled') continue;` guard exists
**Why This Matters**: Dead code removal — reflects clean contract.

### REQ-211-MIG01: `hooks migrate` Operates on Pure Event Map

**Full Text**: The migrate command no longer needs to filter `disabled` from event iteration.
**Behavior**:
- GIVEN: Updated migrate command
- WHEN: Iterating hooks entries
- THEN: No `eventName === 'disabled'` guard
**Why This Matters**: Dead code removal — hooks is now a pure event map.

## Implementation Tasks

### Files to Modify

1. **`packages/cli/src/config/config.ts`** (CLI config loading)
   - REPLACE the destructuring IIFE (lines 1519-1527):
     - FROM: `const hooksConfig = effectiveSettings.hooks || {}; const { disabled: _disabled, ...eventHooks } = ...`
     - TO: `hooks: effectiveSettings.hooks || {}`
   - ADD `disabledHooks` parameter:
     - `disabledHooks: effectiveSettings.hooksConfig?.disabled ?? []`
   - REMOVE post-construction `setDisabledHooks()` call (lines 1540-1547)
   - ADD `@plan:PLAN-20260325-HOOKSPLIT.P12` marker

2. **`packages/cli/src/ui/commands/hooksCommand.ts`** (user-facing message)
   - CHANGE line 36 message:
     - FROM: `'Hooks system is not enabled. Enable it in settings with hooks.enabled.'`
     - TO: `'Hooks system is not enabled. Enable it in settings with hooksConfig.enabled.'`
   - ADD `@plan:PLAN-20260325-HOOKSPLIT.P12` marker
   - ADD `@requirement:REQ-211-CMD02` marker

3. **`packages/cli/src/commands/hooks/migrate.ts`** (migrate command)
   - CHANGE line 87:
     - FROM: `if (eventName === 'disabled' || !Array.isArray(definitions)) continue;`
     - TO: `if (!Array.isArray(definitions)) continue;`
   - ADD `@plan:PLAN-20260325-HOOKSPLIT.P12` marker
   - ADD `@requirement:REQ-211-MIG01` marker

4. **`packages/core/src/hooks/hookRegistry.ts`** (trust scan)
   - REMOVE lines 126-127:
     - `// Skip the 'disabled' key`
     - `if (key === 'disabled') continue;`
   - ADD `@plan:PLAN-20260325-HOOKSPLIT.P12` marker
   - ADD `@requirement:REQ-211-HD03` marker

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P12
 * @requirement:REQ-211-C02, REQ-211-C03, REQ-211-CMD02, REQ-211-HD03, REQ-211-MIG01
 * @pseudocode cli-loading.md lines 01-56
 */
```

## Verification Commands

### Automated Checks

```bash
# TypeScript compiles
npm run typecheck

# Verify destructuring hack removed
grep "disabled: _disabled" packages/cli/src/config/config.ts
# Expected: 0 matches

# Verify post-construction setDisabledHooks removed
grep "enhancedConfig.setDisabledHooks\|setDisabledHooks.*effectiveSettings" packages/cli/src/config/config.ts
# Expected: 0 matches

# Verify disabledHooks parameter added
grep "disabledHooks.*hooksConfig\|hooksConfig.*disabled" packages/cli/src/config/config.ts
# Expected: 1+ match

# Verify hooksCommand message updated
grep "hooksConfig.enabled" packages/cli/src/ui/commands/hooksCommand.ts
# Expected: 1 match

# Verify old message removed
grep "hooks.enabled" packages/cli/src/ui/commands/hooksCommand.ts
# Expected: 0 matches

# Verify migrate command guard updated
grep "eventName === 'disabled'" packages/cli/src/commands/hooks/migrate.ts
# Expected: 0 matches

# Verify trust scan guard removed
grep "key === 'disabled'" packages/core/src/hooks/hookRegistry.ts
# Expected: 0 matches

# Plan markers
for f in packages/cli/src/config/config.ts packages/cli/src/ui/commands/hooksCommand.ts packages/cli/src/commands/hooks/migrate.ts packages/core/src/hooks/hookRegistry.ts; do
  grep -c "@plan:PLAN-20260325-HOOKSPLIT.P12" "$f" && echo "OK: $f" || echo "FAIL: $f"
done
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
   - [ ] hooks parameter is now a direct property access (no destructuring)
   - [ ] disabledHooks parameter explicitly passed from hooksConfig.disabled
   - [ ] No post-construction setDisabledHooks hack
   - [ ] hooksCommand message references hooksConfig.enabled
   - [ ] migrate command doesn't filter 'disabled' key
   - [ ] trust scan doesn't skip 'disabled' key

2. **Is this REAL implementation, not placeholder?**
   - [ ] All four files have real changes (not stubs)

3. **Would the test FAIL if implementation was removed?**
   - [ ] P13 tests will verify the changes

4. **Is the feature REACHABLE?**
   - [ ] CLI config loading is the primary Config construction path
   - [ ] hooksCommand is user-accessible via `/hooks`

## Success Criteria

- Destructuring hack removed from CLI config loading
- disabledHooks passed explicitly
- Post-construction setDisabledHooks removed
- hooksCommand message updated
- migrate command guard updated
- hookRegistry trust scan guard removed
- TypeScript compiles
- Plan markers present in all 4 files

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/config.ts packages/cli/src/ui/commands/hooksCommand.ts packages/cli/src/commands/hooks/migrate.ts packages/core/src/hooks/hookRegistry.ts`
2. Re-read pseudocode `cli-loading.md`
3. Apply changes one file at a time, running typecheck after each

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P12.md`
