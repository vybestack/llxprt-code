# Phase 16a: Integration Implementation Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P16a`

## Prerequisites

- Required: Phase 16 completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P16.md`

## Verification Tasks

### 1. Full Pipeline Trace

Manually trace the settings → hooks pipeline by reading each file in sequence:

- [ ] `loadSettings()` / `loadSettingsFromPath()` reads raw settings from disk
- [ ] `migrateHooksConfig()` is called on the raw settings before merge
- [ ] `mergeSettings()` merges `hooksConfig` across scopes with shallow merge
- [ ] CLI config loading extracts `hooksConfig.disabled` and passes as `disabledHooks`
- [ ] CLI config loading passes `hooks` directly (no destructuring)
- [ ] `Config` constructor stores `disabledHooks` from parameter
- [ ] `getEnableHooks()` reads `hooksConfig.enabled` from settings service
- [ ] `getDisabledHooks()` reads `hooksConfig.disabled` from settings service
- [ ] `getProjectHooks()` returns pure event map (no `disabled`, `enabled`, `notifications`)

### 2. Integration Tests Pass

```bash
# Run integration tests
npm test -- integration-tests/hooks/
# Expected: All pass

# Run full test suite
npm test
# Expected: All pass
```

### 3. Old-Format Pattern Sweep

```bash
# Production code: no old-format hooks access
grep -rn "settings\.hooks\.\(enabled\|disabled\|notifications\)" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "\.test\." | grep -v "\.spec\."
# Expected: 0 matches

# Production code: no bare hooks.enabled (should be hooksConfig.enabled)
grep -rn "hooks\.enabled\b" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "\.test\." | grep -v "\.spec\." | grep -v hooksConfig | grep -v "// old format" | grep -v "migrateHooksConfig"
# Expected: 0 matches

# No destructuring workaround
grep -rn "disabled: _disabled\|{ disabled," packages/cli/src/config/config.ts | grep -v hooksConfig
# Expected: 0 matches

# No post-construction setDisabledHooks hack
grep -rn "enhancedConfig\.setDisabledHooks\|\.setDisabledHooks(" packages/cli/src/config/config.ts
# Expected: 0 matches
```

### 4. TypeScript and Lint

```bash
npm run typecheck
# Expected: Clean

npm run lint
# Expected: Clean
```

### 5. StatusDisplay Verification

```bash
# StatusDisplay must not reference hooksConfig directly
grep -rn "hooksConfig" packages/cli/src/ui/statusDisplay.ts packages/cli/src/ui/StatusDisplay.ts 2>/dev/null
# Expected: 0 matches (StatusDisplay uses Config API, not raw settings)

# StatusDisplay must not reference hooks.enabled or hooks.disabled
grep -rn "hooks\.\(enabled\|disabled\|notifications\)" packages/cli/src/ui/statusDisplay.ts packages/cli/src/ui/StatusDisplay.ts 2>/dev/null
# Expected: 0 matches
```

### 6. Plan Markers

```bash
grep -rc "@plan:PLAN-20260325-HOOKSPLIT.P16" packages/ --include="*.ts" --include="*.tsx" | grep -v ":0$"
# Expected: 1+ files
```

### Deferred Implementation Detection

```bash
for f in packages/cli/src/config/config.ts packages/core/src/config/config.ts packages/core/src/settings/settingsSchema.ts packages/core/src/settings/migrateHooksConfig.ts; do
  grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" "$f" | grep -iv "loading of hooks based on workspace"
done
# Expected: No new deferred work

for f in packages/cli/src/config/config.ts packages/core/src/config/config.ts packages/core/src/settings/settingsSchema.ts packages/core/src/settings/migrateHooksConfig.ts; do
  grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be)" "$f"
done
# Expected: No cop-out comments

for f in packages/cli/src/config/config.ts packages/core/src/config/config.ts packages/core/src/settings/settingsSchema.ts packages/core/src/settings/migrateHooksConfig.ts; do
  grep -rn -E "return \[\]|return \{\}|return null|return undefined" "$f" | grep -v "\.test\."
done
# Expected: No empty returns in implementation paths (defaults OK if intentional)
```

### Edge Case Spot Checks

- [ ] Empty settings file loads without error
- [ ] Settings with only old-format hooks → migration produces `hooksConfig` + pure `hooks`
- [ ] Settings with only new-format → passes through unchanged
- [ ] Settings with both old and new format → `hooksConfig` preserved (not overwritten by migration)
- [ ] Settings with `hooksConfig` but no `hooks` key → works correctly

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
npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
# Expected behavior: Full verification suite passes, smoke test produces a haiku
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] loadSettings() → migrateHooksConfig() call exists and is in the right position
- [ ] migrateHooksConfig() output → mergeSettings() input types match
- [ ] mergeSettings() output → CLI config extraction → Config constructor input types match
- [ ] Config.getEnableHooks() reads hooksConfig.enabled from settings service
- [ ] Config.getDisabledHooks() reads hooksConfig.disabled from settings service
- [ ] Config.getProjectHooks() returns pure event map (no config keys)
- [ ] Hook registry reads disabled list from Config.getDisabledHooks()
- [ ] StatusDisplay uses only Config API (no direct settings access)

### Edge Cases Verified

- [ ] Empty settings file → defaults work (hooks disabled, no disabled list, no events)
- [ ] Settings with only hooksConfig and no hooks → works
- [ ] Settings with only hooks (old format) → migration produces correct split
- [ ] Settings with both hooksConfig and old-format hooks → hooksConfig not overwritten

## Success Criteria

- Full pipeline trace verified (all 9 checkpoints)
- All integration tests pass
- Full test suite passes
- No old-format patterns in production code
- TypeScript compiles
- Lint passes
- StatusDisplay has no regressions
- No deferred implementation
- All edge cases verified

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P16a.md`
