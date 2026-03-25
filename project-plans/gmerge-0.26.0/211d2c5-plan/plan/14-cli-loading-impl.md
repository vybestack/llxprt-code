# Phase 14: CLI Loading + Commands Implementation

## Phase ID

`PLAN-20260325-HOOKSPLIT.P14`

## Prerequisites

- Required: Phase 13a (CLI Loading TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P13a.md`
- Expected files from previous phase: Tests updated for CLI loading changes

## Requirements Implemented (Expanded)

### REQ-211-C02: `hooks` Passed to Config Is Pure Event Map

**Full Text**: Destructuring workaround removed, hooks is passed directly.
**Why This Matters**: Clean code, no workaround.

### REQ-211-C03: `disabledHooks` Is Explicit Config Parameter

**Full Text**: `disabledHooks` passed from `hooksConfig.disabled`.
**Why This Matters**: Eliminates post-construction hack.

### REQ-211-CMD02: User-Facing Messages Reference `hooksConfig.enabled`

**Full Text**: Message says `hooksConfig.enabled` instead of `hooks.enabled`.
**Why This Matters**: Correct user guidance.

### REQ-211-HD03: Trust Scan Treats Project Hooks as Pure Event Map

**Full Text**: `if (key === 'disabled') continue;` guard removed.
**Why This Matters**: Dead code removal.

### REQ-211-MIG01: `hooks migrate` Operates on Pure Event Map

**Full Text**: `eventName === 'disabled'` guard removed from migrate command.
**Why This Matters**: Dead code removal.

## Implementation Tasks

### Verification That P12 Changes Are Complete

The CLI loading changes were already made in P12 (stub phase), because these are straightforward code changes (not complex stubs). This phase:

1. Verifies all P13 tests pass with P12 changes
2. Fixes any issues found during TDD
3. Ensures complete pseudocode compliance

### Files to Verify/Fix

- `packages/cli/src/config/config.ts` — Verify from P12
- `packages/cli/src/ui/commands/hooksCommand.ts` — Verify from P12
- `packages/cli/src/commands/hooks/migrate.ts` — Verify from P12
- `packages/core/src/hooks/hookRegistry.ts` — Verify from P12

### Pseudocode Compliance Check

From `analysis/pseudocode/cli-loading.md`:
- Lines 01-09: Hooks parameter simplification — verify no destructuring
- Lines 11-13: disabledHooks parameter — verify `hooksConfig?.disabled ?? []`
- Lines 15-23: Post-construction hack removal — verify deleted
- Lines 30-34: hooksCommand message — verify `hooksConfig.enabled`
- Lines 40-45: Migrate command — verify no `disabled` guard
- Lines 50-55: Trust scan — verify no `disabled` guard

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P14
 * @pseudocode cli-loading.md lines 01-56
 */
```

## Verification Commands

### Automated Checks

```bash
# All CLI tests pass
npm test -- packages/cli/src/ui/commands/hooksCommand.test.ts
npm test -- packages/cli/src/config/

# Hook system tests pass
npm test -- packages/core/src/hooks/

# TypeScript compiles
npm run typecheck

# Comprehensive old-pattern search
grep -rn "hooks\.enabled\|hooks\.disabled\|hooks\.notifications" packages/cli/src/config/config.ts packages/cli/src/ui/commands/hooksCommand.ts packages/cli/src/commands/hooks/migrate.ts
# Expected: 0 matches (all should reference hooksConfig)

# Verify no destructuring hack
grep "disabled: _disabled" packages/cli/src/config/config.ts
# Expected: 0

# Verify no post-construction hack
grep "enhancedConfig.setDisabledHooks" packages/cli/src/config/config.ts
# Expected: 0
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
   - [ ] hooks passed directly (no destructuring)
   - [ ] disabledHooks from hooksConfig.disabled
   - [ ] No post-construction setDisabledHooks
   - [ ] hooksCommand message references hooksConfig.enabled
   - [ ] No disabled-key guards in migrate or trust scan

2. **Is this REAL implementation, not placeholder?**
   - [ ] No TODO/FIXME in modified areas

3. **Would the test FAIL if implementation was removed?**
   - [ ] P13 tests verify message content and parameter flow

4. **Is the feature REACHABLE?**
   - [ ] CLI config loading is the main Config construction path
   - [ ] /hooks command is user-accessible

### Deferred Implementation Detection

```bash
for f in packages/cli/src/config/config.ts packages/cli/src/ui/commands/hooksCommand.ts packages/cli/src/commands/hooks/migrate.ts packages/core/src/hooks/hookRegistry.ts; do
  grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" "$f" | grep -iv "loading of hooks based on workspace"
done
# Expected: No new deferred work
```

## Success Criteria

- All P13 tests pass
- TypeScript compiles
- Pseudocode compliance confirmed for all line ranges
- No old-format patterns remain
- No deferred implementation

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/config.ts packages/cli/src/ui/commands/hooksCommand.ts packages/cli/src/commands/hooks/migrate.ts packages/core/src/hooks/hookRegistry.ts`
2. Re-read pseudocode `cli-loading.md`
3. Fix issues identified by failing tests

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P14.md`
