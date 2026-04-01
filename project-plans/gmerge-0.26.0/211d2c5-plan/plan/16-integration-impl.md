# Phase 16: Integration Wiring

## Phase ID

`PLAN-20260325-HOOKSPLIT.P16`

## Prerequisites

- Required: Phase 15a (Integration TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P15a.md`
- Expected files from previous phase: Integration tests written and verified in P15

## Requirements Implemented (Expanded)

### REQ-211-ZD01: No Breaking Change for Existing Settings Files

**Full Text**: Existing settings files using old schema format are transparently converted. All hooks behavior is preserved. Users with old-format `hooks: { enabled: true, disabled: [...], BeforeTool: [...] }` must experience zero behavioral difference after the refactor.
**Behavior**:
- GIVEN: A user has an existing settings file using old-format hooks (config keys mixed into the hooks event map)
- WHEN: The settings file is loaded through the full CLI pipeline
- THEN: All hooks behavior is preserved — `getEnableHooks()`, `getDisabledHooks()`, and hook event definitions all return correct values
**Why This Matters**: This is the paramount goal of the entire refactor — schema change must be invisible to users.

### REQ-211-UI01: StatusDisplay Does Not Regress

**Full Text**: `StatusDisplay` continues to display hook status when active hooks are present, without referencing `hooksConfig` or `hooks.notifications`.
**Behavior**:
- GIVEN: Active hooks present and hooks enabled
- WHEN: StatusDisplay renders hook status information
- THEN: Display output is identical to pre-refactor behavior
**Why This Matters**: UI behavioral preservation ensures no visible change to users.

### REQ-211-SM01: `hooksConfig` Is Merged Across Scopes

**Full Text**: `mergeSettings()` merges `hooksConfig` using shallow merge across all scopes (global, user, workspace).
**Behavior**:
- GIVEN: User settings `{ hooksConfig: { enabled: true } }` and workspace settings `{ hooksConfig: { disabled: ['x'] } }`
- WHEN: Settings are merged via `mergeSettings()`
- THEN: Result has `hooksConfig: { enabled: true, disabled: ['x'] }`
**Why This Matters**: Scope-based settings override must work correctly with the new key.

### REQ-211-HD01: Hook Registration Unaffected

**Full Text**: Hook registration system continues to use `config.getDisabledHooks()` API. Registration logic is unchanged.
**Behavior**:
- GIVEN: A hook whose name appears in the disabled hooks list
- WHEN: Hook is registered via the hook registry
- THEN: Hook is registered with `enabled: false`
**Why This Matters**: Core hooks runtime behavior must be preserved.

### REQ-211-HD02: Hook Execution Guards Unchanged

**Full Text**: `getEnableHooks()` method remains the sole runtime check for hook system activation. No new dispatch guards are introduced.
**Behavior**:
- GIVEN: All hook trigger entry points in the codebase
- WHEN: They check whether to execute hooks
- THEN: They use `config.getEnableHooks()` — no alternative paths introduced
**Why This Matters**: Single source of truth for hook enablement, no behavioral divergence.

## Implementation Tasks

### Goal

This phase wires all previously-implemented components together into a cohesive end-to-end flow and ensures P15 integration tests pass. The individual pieces (schema split P05, migration P08, config types P11, CLI loading P14) are already implemented — this phase ensures they compose correctly.

### 1. End-to-End Pipeline Verification

Trace the full settings → migration → config → hooks pipeline:

1. **Settings load** (`loadSettings()` / `loadSettingsFromPath()`) — reads file, returns raw settings
2. **Migration** (`migrateHooksConfig()`) — splits old-format hooks into `hooksConfig` + pure `hooks`
3. **Merge** (`mergeSettings()`) — merges `hooksConfig` across scopes
4. **Config construction** (`new Config({ ..., hooks, disabledHooks })`) — receives split data
5. **Runtime** — `getEnableHooks()`, `getDisabledHooks()`, `getProjectHooks()` return correct values
6. **Hook registration** — disabled list applied correctly
7. **UI** — StatusDisplay renders correctly

### 2. Files to Verify and Fix

- **`packages/cli/src/config/config.ts`** — Main CLI config loading
  - Verify migration is called at the correct point in the pipeline
  - Verify `hooksConfig` properties flow into Config constructor parameters
  - ADD `@plan:PLAN-20260325-HOOKSPLIT.P16` marker

- **`packages/core/src/config/config.ts`** — Core Config class
  - Verify constructor uses `disabledHooks` parameter
  - Verify `getEnableHooks()` reads from settings service `hooksConfig.enabled`
  - Verify `getDisabledHooks()` reads from settings service `hooksConfig.disabled`

- **`packages/cli/src/config/settingsSchema.ts`** — Schema definitions
  - Verify `hooksConfig` key exists in schema
  - Verify `hooks` schema has no config keys

- **`packages/cli/src/config/settings.ts`** — Migration function (`migrateHooksConfig`)
  - Verify it is imported and called during settings loading

- **`packages/cli/src/ui/components/StatusDisplay.tsx`** — Status display
  - Verify hook status display logic has no dependency on old-format fields
  - No `hooks.enabled`, `hooks.disabled`, or `hooks.notifications` references

### 3. Integration Gaps to Fix

If any P15 integration tests fail, fix the underlying wiring issues:

- **Gap: Migration not called during load** — Ensure `migrateHooksConfig()` is invoked after raw settings are read but before merge
- **Gap: Merge strategy missing for hooksConfig** — Ensure `mergeSettings()` handles `hooksConfig` with shallow merge
- **Gap: Config constructor not receiving disabledHooks** — Ensure CLI config loading extracts `hooksConfig.disabled` and passes as `disabledHooks` parameter
- **Gap: StatusDisplay regression** — Ensure no new references to `hooksConfig` in display code (display should use Config API only)

### 4. Trust Scan Integration Assertion

After removing the stale `if (key === 'disabled') continue;` guard in `hookRegistry.ts` (done in P12), verify that project hooks with pure event maps still register and execute correctly:

- **Assertion**: Project hooks containing only event keys (e.g., `{ BeforeTool: [{...}], AfterTool: [{...}] }`) are iterated fully by `checkProjectHooksTrust()` — no entries are skipped
- **Assertion**: A hook registered from a project hook event map is executable (the trust scan does not reject it due to unexpected key shapes)
- **Verification command**:
  ```bash
  # Verify hookRegistry no longer has the disabled guard
  grep -n "key === 'disabled'" packages/core/src/hooks/hookRegistry.ts
  # Expected: 0 matches

  # Verify checkProjectHooksTrust iterates all entries
  grep -A 20 "checkProjectHooksTrust" packages/core/src/hooks/hookRegistry.ts | grep -c "for\|forEach\|entries\|Object.entries"
  # Expected: 1+ (iteration exists without disabled filtering)
  ```

### 5. Old-Format Pattern Cleanup

Final sweep for any remaining old-format patterns in production code:

```bash
# These should all return 0 matches in production code (non-test files)
grep -rn "settings\.hooks\.\(enabled\|disabled\|notifications\)" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "\.test\." | grep -v "\.spec\."
# Expected: 0 matches

grep -rn "hooks\.enabled\b" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "\.test\." | grep -v "\.spec\." | grep -v hooksConfig | grep -v "// old format"
# Expected: 0 matches
```

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P16
 * @requirement:REQ-211-ZD01, REQ-211-UI01, REQ-211-SM01
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -rc "@plan:PLAN-20260325-HOOKSPLIT.P16" packages/ --include="*.ts" --include="*.tsx" | grep -v ":0$"
# Expected: 1+ files

# Run integration tests from P15
npm test -- integration-tests/hooks/
# Expected: All pass

# Run full test suite
npm test
# Expected: All pass

# TypeScript compiles
npm run typecheck
# Expected: Clean

# Linting passes
npm run lint
# Expected: Clean

# No old-format patterns in production code
grep -rn "settings\.hooks\.\(enabled\|disabled\|notifications\)" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "\.test\." | grep -v "\.spec\."
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
   - [ ] Old-format settings files are transparently migrated on load
   - [ ] `hooksConfig` merges correctly across scopes
   - [ ] StatusDisplay renders hook status without regression
   - [ ] Hook registration uses correct disabled list
   - [ ] Hook execution guards use `getEnableHooks()`

2. **Is this REAL implementation, not placeholder?**
   - [ ] Migration function is actually called during settings load (not just defined)
   - [ ] Config constructor actually receives disabledHooks (not just typed)
   - [ ] Merge function actually handles hooksConfig (not just has the type)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing migration call → old-format tests fail
   - [ ] Removing disabledHooks param → config construction tests fail
   - [ ] Removing hooksConfig merge → scope merge tests fail

4. **Is the feature REACHABLE by users?**
   - [ ] Settings file on disk → load → migrate → merge → Config → hooks system: full path verified
   - [ ] CLI startup invokes the complete pipeline

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] (enumerate any gaps found during wiring)

### Deferred Implementation Detection

```bash
# Run across all modified production files
for f in packages/cli/src/config/config.ts packages/core/src/config/config.ts packages/cli/src/config/settingsSchema.ts packages/cli/src/config/settings.ts; do
  grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" "$f" | grep -iv "loading of hooks based on workspace"
done
# Expected: No deferred work

for f in packages/cli/src/config/config.ts packages/core/src/config/config.ts packages/cli/src/config/settingsSchema.ts packages/cli/src/config/settings.ts; do
  grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" "$f"
done
# Expected: No cop-out comments
```

### Integration Points Verified

- [ ] `loadSettings()` → `migrateHooksConfig()` call exists and is in the right position
- [ ] `migrateHooksConfig()` output → `mergeSettings()` input types match
- [ ] `mergeSettings()` output → CLI config extraction → `Config` constructor input types match
- [ ] `Config.getEnableHooks()` reads `hooksConfig.enabled` from settings service
- [ ] `Config.getDisabledHooks()` reads `hooksConfig.disabled` from settings service
- [ ] `Config.getProjectHooks()` returns pure event map (no config keys)
- [ ] Hook registry reads disabled list from `Config.getDisabledHooks()`
- [ ] StatusDisplay uses only Config API (no direct settings access)

### Edge Cases Verified

- [ ] Empty settings file → defaults work (hooks disabled, no disabled list, no events)
- [ ] Settings with only `hooksConfig` and no `hooks` → works
- [ ] Settings with only `hooks` (old format) → migration produces correct split
- [ ] Settings with both `hooksConfig` and old-format `hooks` → `hooksConfig` not overwritten (REQ-211-M04)

## Success Criteria

- All P15 integration tests pass
- Full test suite passes (`npm test`)
- TypeScript compiles (`npm run typecheck`)
- Lint passes (`npm run lint`)
- No old-format patterns in production code
- No deferred implementation
- All integration points verified
- All edge cases verified

## Failure Recovery

If this phase fails:
1. Identify which integration point is broken from test output
2. `git stash` current changes
3. Fix the specific wiring gap
4. `git stash pop` and re-verify
5. Cannot proceed to P16a until all P15 integration tests pass

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P16.md`
