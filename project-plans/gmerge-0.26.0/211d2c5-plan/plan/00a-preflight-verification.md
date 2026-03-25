# Phase 0.5: Preflight Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P00a`

## Prerequisites

- Required: f7f38e2 (non-nullable settings) must be merged into the working branch
- Verification: `git log --oneline | grep f7f38e2` or verify non-nullable settings types exist
- Expected: Settings types are non-nullable (no `| undefined` on top-level settings fields)
- This phase MUST pass before ANY implementation phase begins

## Requirements Implemented (Expanded)

This phase does not implement requirements directly. It verifies all assumptions needed for implementation.

## Preflight Verification Tasks

### 1. Prerequisite Commit Verification

```bash
# Verify f7f38e2 (non-nullable settings) is in the branch
git log --oneline --all | grep f7f38e2 || echo "WARNING: f7f38e2 not found in history"

# Alternatively, verify the non-nullable settings behavior exists
grep -c "Settings = " packages/cli/src/config/settingsSchema.ts
```

### 2. Dependency Verification

| Dependency | Verification Command | Expected Status |
|------------|---------------------|-----------------|
| vitest | `npm ls vitest` | Installed |
| typescript | `npm ls typescript` | Installed |

```bash
# Verify the project builds cleanly before any changes
npm run typecheck
```

### 3. Type/Interface Verification

| Type Name | File | Expected | Verification Command |
|-----------|------|----------|---------------------|
| `ConfigParameters.hooks` | `packages/core/src/config/config.ts:525-527` | `{ [K in HookEventName]?: HookDefinition[] }` (event-only) | `grep -A 3 "hooks?:" packages/core/src/config/config.ts \| head -6` |
| `ConfigParameters.disabledHooks` | `packages/core/src/config/config.ts:531` | `string[]` (separate param) | `grep "disabledHooks" packages/core/src/config/config.ts` |
| `ConfigParameters.projectHooks` | `packages/core/src/config/config.ts:528-530` | `{ [K in HookEventName]?: HookDefinition[] }` (event-only) | `grep -A 3 "projectHooks?:" packages/core/src/config/config.ts \| head -6` |
| `Config.projectHooks` (private) | `packages/core/src/config/config.ts:765-767` | Has stale `& { disabled?: string[] }` | `grep -A 3 "private.*projectHooks" packages/core/src/config/config.ts` |
| `SETTINGS_SCHEMA.hooks` | `packages/cli/src/config/settingsSchema.ts:1858-1901` | Mixed object with enabled/disabled/notifications in properties | `grep -A 5 "hooks:" packages/cli/src/config/settingsSchema.ts \| head -10` |
| `Settings` type | Inferred from schema | Has `hooks` with mixed type | Verify via typecheck |

### 4. Call Path Verification

| Function | Expected Location | Verification Command |
|----------|-------------------|---------------------|
| `getEnableHooks()` | `packages/cli/src/config/settingsSchema.ts:2359` | `grep -n "getEnableHooks" packages/cli/src/config/settingsSchema.ts` |
| `getEnableHooksUI()` | `packages/cli/src/config/settingsSchema.ts:2351` | `grep -n "getEnableHooksUI" packages/cli/src/config/settingsSchema.ts` |
| `getDisabledHooks()` | `packages/core/src/config/config.ts:2737` | `grep -n "getDisabledHooks" packages/core/src/config/config.ts` |
| `setDisabledHooks()` | `packages/core/src/config/config.ts:2753` | `grep -n "setDisabledHooks" packages/core/src/config/config.ts` |
| `getProjectHooks()` | `packages/core/src/config/config.ts:2794` | `grep -n "getProjectHooks" packages/core/src/config/config.ts` |
| `checkProjectHooksTrust()` | `packages/core/src/hooks/hookRegistry.ts:119` | `grep -n "checkProjectHooksTrust" packages/core/src/hooks/hookRegistry.ts` |
| `loadSettings()` | `packages/cli/src/config/settings.ts:611` | `grep -n "loadSettings" packages/cli/src/config/settings.ts` |
| `migrateLegacyInteractiveShellSetting()` | `packages/cli/src/config/settings.ts:319` | `grep -n "migrateLegacy" packages/cli/src/config/settings.ts` |
| CLI config hooks loading | `packages/cli/src/config/config.ts:1519-1527` | `grep -n "hooksConfig\|disabled.*hooks\|eventHooks" packages/cli/src/config/config.ts` |

### 5. Test Infrastructure Verification

| Component | Test File | Verification Command |
|-----------|-----------|---------------------|
| Settings schema helpers | `packages/cli/src/config/settingsSchema.test.ts` | `ls -la packages/cli/src/config/settingsSchema.test.ts` |
| Settings loading | `packages/cli/src/config/settings.test.ts` | `ls -la packages/cli/src/config/settings.test.ts` |
| Core config | `packages/core/src/config/config.test.ts` (or nearby) | `find packages/core/src/config -name "*.test.ts"` |
| Hook system | `packages/core/src/hooks/hookSystem.test.ts` | `ls -la packages/core/src/hooks/hookSystem.test.ts` |
| Hook registry | `packages/core/src/hooks/__tests__/` | `ls packages/core/src/hooks/__tests__/` |
| Hooks command | `packages/cli/src/ui/commands/hooksCommand.test.ts` | `ls -la packages/cli/src/ui/commands/hooksCommand.test.ts` |
| Integration tests | `integration-tests/hooks/hooks-e2e.integration.test.ts` | `ls -la integration-tests/hooks/hooks-e2e.integration.test.ts` |

### 6. File Existence Verification

All files referenced in the plan must exist:

```bash
# Core files to modify
ls -la packages/cli/src/config/settingsSchema.ts
ls -la packages/cli/src/config/settings.ts
ls -la packages/cli/src/config/config.ts
ls -la packages/core/src/config/config.ts
ls -la packages/core/src/hooks/hookRegistry.ts
ls -la packages/cli/src/ui/commands/hooksCommand.ts
ls -la packages/cli/src/commands/hooks/migrate.ts

# Test files
ls -la packages/cli/src/config/settingsSchema.test.ts
ls -la packages/cli/src/config/settings.test.ts
ls -la packages/cli/src/ui/commands/hooksCommand.test.ts
ls -la packages/core/src/hooks/hookSystem.test.ts
ls -la integration-tests/hooks/hooks-e2e.integration.test.ts
```

### 7. Codebase Assumptions

Verify that `extension-manager.ts` does NOT exist (playbook references it but LLxprt doesn't have it):

```bash
find packages -name "extension-manager*" -type f
# Expected: no results — LLxprt does not have this file
```

Verify that `StatusDisplay.tsx` does NOT reference `hooks.notifications`:

```bash
grep "notifications" packages/cli/src/ui/components/StatusDisplay.tsx
# Expected: no results — LLxprt StatusDisplay doesn't gate on notifications
```

## Verification Commands

```bash
# Run full typecheck to ensure clean baseline
npm run typecheck

# Run full test suite to ensure clean baseline
npm run test

# Verify build works
npm run build
```

## Preflight Verification Checklist

- [ ] f7f38e2 prerequisite merged or non-nullable settings behavior verified
- [ ] All dependencies available (vitest, typescript)
- [ ] `ConfigParameters` interface matches expectations (hooks event-only, disabledHooks separate)
- [ ] Private `projectHooks` field has stale `& { disabled?: string[] }` (confirming fix is needed)
- [ ] `SETTINGS_SCHEMA.hooks` has mixed properties (confirming split is needed)
- [ ] All call paths verified and line numbers match
- [ ] All test files exist
- [ ] All source files to modify exist
- [ ] `extension-manager.ts` does NOT exist in LLxprt (skip from plan)
- [ ] `StatusDisplay.tsx` does NOT reference `hooks.notifications` (no change needed)
- [ ] Baseline typecheck passes
- [ ] Baseline test suite passes
- [ ] Baseline build succeeds

## Blocking Issues Found

[To be filled during execution — any failed verification MUST be resolved before proceeding]

## Verification Gate

**This phase MUST pass before ANY implementation phase begins.**
- If ANY verification fails, update the plan FIRST
- Do NOT proceed with "we'll fix it later" mentality

## Success Criteria

- All checklist items verified
- No blocking issues remain
- Clean baseline: typecheck, tests, and build all pass

## Failure Recovery

If this phase fails:
1. Document which verifications failed
2. Update plan phases to account for discrepancies
3. Re-run preflight after plan updates

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
npm run typecheck && npm run test && npm run build
# Expected behavior: All pass — clean baseline established
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] All source files referenced in the plan exist on disk
- [ ] All test files referenced in the plan exist on disk
- [ ] All function signatures match plan expectations
- [ ] All line number references are within reasonable range

### Edge Cases Verified

- [ ] Missing prerequisite commit handled (documented blocker, not silent failure)
- [ ] Missing test infrastructure detected (test file not found)
- [ ] Unexpected file structure detected (wrong line numbers, renamed functions)

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P00a.md`
