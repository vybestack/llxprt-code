# Phase 09: Core Config Type Updates Stub

## Phase ID

`PLAN-20260325-HOOKSPLIT.P09`

## Prerequisites

- Required: Phase 08a (Migration Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P08a.md`
- Expected files from previous phase: Working migration function in `settings.ts`
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

### REQ-211-CC01: Config Constructor Uses `disabledHooks` Param

**Full Text**: The `Config` class shall initialize its disabled hooks list from the `disabledHooks` constructor parameter rather than leaving it as an empty array.
**Behavior**:
- GIVEN: `Config` constructed with `disabledHooks: ['x']`
- WHEN: `getDisabledHooks()` is called
- THEN: Returns list containing `'x'`
**Why This Matters**: Eliminates post-construction `setDisabledHooks()` hack.

### REQ-211-CC02: `projectHooks` Type Is Pure Event Map

**Full Text**: The `Config.projectHooks` private field type and `getProjectHooks()` return type shall be a pure event map without a `disabled` property.
**Behavior**:
- GIVEN: Updated Config class
- WHEN: TypeScript compiles
- THEN: Code attempting `config.getProjectHooks().disabled` would fail type-checking
**Why This Matters**: Eliminates type safety violation on private field.

### REQ-211-CC03: SettingsService Persistence Key Updated

**Full Text**: `getDisabledHooks()` and `setDisabledHooks()` shall persist under `'hooksConfig.disabled'` instead of `'hooks.disabled'`.
**Behavior**:
- GIVEN: `config.setDisabledHooks(['a'])`
- WHEN: Settings service is inspected
- THEN: Value `['a']` is under key `'hooksConfig.disabled'`
**Why This Matters**: Matches the new schema path.

## Implementation Tasks

### Files to Modify

- `packages/core/src/config/config.ts`
  - CHANGE private `projectHooks` field type (line 765-767):
    - FROM: `({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] }) | undefined`
    - TO: `{ [K in HookEventName]?: HookDefinition[] } | undefined`
  - ADD constructor wiring (after line 955):
    - `this.disabledHooks = params.disabledHooks ?? [];`
  - CHANGE `getProjectHooks()` return type (line 2794-2795):
    - FROM: `({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] }) | undefined`
    - TO: `{ [K in HookEventName]?: HookDefinition[] } | undefined`
  - CHANGE `getDisabledHooks()` persistence key (line 2739):
    - FROM: `this.settingsService.get('hooks.disabled')`
    - TO: `this.settingsService.get('hooksConfig.disabled')`
  - CHANGE `setDisabledHooks()` persistence key (line 2756):
    - FROM: `this.settingsService.set('hooks.disabled', hooks)`
    - TO: `this.settingsService.set('hooksConfig.disabled', hooks)`
  - ADD `@plan:PLAN-20260325-HOOKSPLIT.P09` marker
  - ADD `@requirement:REQ-211-CC01`, `@requirement:REQ-211-CC02`, `@requirement:REQ-211-CC03` markers

### Note on "Stub" for Type Changes

Type changes and persistence key changes are small, discrete modifications — they ARE the implementation. The "stub" here means making the changes and verifying typecheck passes, while TDD tests (P10) will verify the behavioral correctness.

All changes in this phase are straightforward enough that the stub IS the implementation:
1. Type change: Remove `& { disabled?: string[] }` from two locations
2. Constructor: Add one line `this.disabledHooks = params.disabledHooks ?? [];`
3. Key changes: Replace string literals in two locations

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P09
 * @requirement:REQ-211-CC01, REQ-211-CC02, REQ-211-CC03
 * @pseudocode config-types.md lines 01-32
 */
```

## Verification Commands

### Automated Checks

```bash
# TypeScript compiles (critical — type changes may break consumers)
npm run typecheck

# Verify plan markers
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P09" packages/core/src/config/config.ts
# Expected: 1+

# Verify projectHooks type no longer has disabled
grep -A 3 "private.*projectHooks" packages/core/src/config/config.ts | grep -c "disabled"
# Expected: 0

# Verify getProjectHooks return type no longer has disabled
grep -A 3 "getProjectHooks" packages/core/src/config/config.ts | grep -c "disabled"
# Expected: 0

# Verify constructor wires disabledHooks
grep "this.disabledHooks.*params.disabledHooks" packages/core/src/config/config.ts
# Expected: 1 match

# Verify persistence key changed
grep "hooksConfig.disabled" packages/core/src/config/config.ts
# Expected: 2 matches (get and set)

# Verify old key removed
grep "hooks.disabled" packages/core/src/config/config.ts
# Expected: 0 matches
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
   - [ ] `projectHooks` field typed as pure event map
   - [ ] Constructor wires `disabledHooks` from params
   - [ ] `getProjectHooks()` return type is pure event map
   - [ ] Persistence key is `'hooksConfig.disabled'`

2. **Is this REAL implementation, not placeholder?**
   - [ ] Type changes are complete (not deferred)
   - [ ] Constructor wiring is a real one-line addition
   - [ ] Key changes are complete string replacements

3. **Would the test FAIL if implementation was removed?**
   - [ ] P10 tests will verify behavioral correctness

4. **Is the feature REACHABLE?**
   - [ ] `Config` is constructed from CLI config loader — all changes flow through

## Success Criteria

- `projectHooks` field and `getProjectHooks()` return type are pure event maps
- Constructor wires `this.disabledHooks` from `params.disabledHooks`
- Persistence key changed to `'hooksConfig.disabled'`
- `npm run typecheck` passes
- Plan markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/config/config.ts`
2. Re-read pseudocode `config-types.md` lines 01-32
3. Fix type errors one at a time (type changes may cascade)

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P09.md`
