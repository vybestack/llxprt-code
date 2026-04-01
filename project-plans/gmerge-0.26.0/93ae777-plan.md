# REIMPLEMENT Playbook: 93ae777 — Fix System scopes migration (migrateDeprecatedSettings)

## Upstream Change Summary

**Commit:** 93ae7772fdd3e6e94fd81bfb0e7a01c6be3ce37a
**Author:** Jacob Richman
**PR:** #17174

### Problem
The `migrateDeprecatedSettings()` function only processed `User` and `Workspace` scopes, but not `System` and `SystemDefaults` scopes. This meant deprecated settings in system-level config files would never be migrated.

### Solution
Added two lines to process additional scopes:
```typescript
processScope(SettingScope.System);
processScope(SettingScope.SystemDefaults);
```

### Files Changed (Upstream)
- `packages/cli/src/config/settings.test.ts` — Added test for system scope migration
- `packages/cli/src/config/settings.ts` — Added scope processing calls

---

## Status

**Not directly applicable yet — depends on 608da23 (disable→enable rename)**

This commit is a follow-up to upstream commit 608da23, which renames `disableAutoUpdate` → `enableAutoUpdate` and `disableUpdateNag` → `enableAutoUpdateNotification`. Until that rename lands in LLxprt (tracked as R21/608da23), this commit cannot be fully implemented.

## LLxprt Current State

### File: `packages/cli/src/config/settings.ts`

LLxprt does NOT have an upstream-style `migrateDeprecatedSettings` function. However, LLxprt **does** have scope-wide migration via `migrateLegacyInteractiveShellSetting` in `loadSettings()`. This function iterates all four scopes (System, SystemDefaults, User, Workspace) and migrates the legacy `usePty`/`shell.enableInteractiveShell` settings.

### Key Differences

| Upstream | LLxprt |
|----------|--------|
| Has `migrateDeprecatedSettings()` | No upstream-style `migrateDeprecatedSettings`, but has `migrateLegacyInteractiveShellSetting` |
| Migrates `disableAutoUpdate` → `enableAutoUpdate` | Rename not yet applied (depends on 608da23) |
| Migrates `disableUpdateNag` → `enableAutoUpdateNotification` | Same — depends on 608da23 |
| Processes User + Workspace scopes only | LLxprt's `migrateLegacyInteractiveShellSetting` already processes all 4 scopes |

---

## Adaptation Plan

### Gating Rule

**Do not implement `migrateDeprecatedSettings` until commit 608da23 (disable→enable rename) has been adapted for LLxprt.** Once `enableAutoUpdateNotification` and other renamed settings land via R21/608da23, ensure the migration logic processes ALL four scopes: User, Workspace, System, and SystemDefaults — consistent with how `migrateLegacyInteractiveShellSetting` already works.

### When 608da23 lands: Add migrateDeprecatedSettings

1. **Check what settings were renamed in 608da23:**
   - Look at `settingsSchema.ts` for current vs. deprecated setting names
   - Map each rename to a migration entry

2. **Add `migrateDeprecatedSettings` function:**
   ```typescript
   export function migrateDeprecatedSettings(
     loadedSettings: LoadedSettings,
     removeDeprecated = false,
   ): boolean {
     let anyModified = false;

     const processScope = (scope: LoadableSettingScope) => {
       const settings = loadedSettings.forScope(scope).settings;
       // Add migration entries for each renamed setting
       // e.g., disableAutoUpdate → enableAutoUpdate (inverted)
     };

     // Must process ALL scopes — not just User + Workspace
     processScope(SettingScope.User);
     processScope(SettingScope.Workspace);
     processScope(SettingScope.System);
     processScope(SettingScope.SystemDefaults);

     return anyModified;
   }
   ```

3. **Call from `loadSettings()`** alongside the existing `migrateLegacyInteractiveShellSetting` loop.

---

## Files to Read

| File | Purpose |
|------|---------|
| `packages/cli/src/config/settings.ts` | Check for migration function |
| `packages/cli/src/config/settingsSchema.ts` | Check current setting names |
| `packages/cli/src/config/settings.test.ts` | Check for migration tests |

## Files to Modify (if needed)

| File | Changes |
|------|---------|
| `packages/cli/src/config/settings.ts` | Add/update migrateDeprecatedSettings |
| `packages/cli/src/config/settings.test.ts` | Add migration tests |

---

## Decision Point

**Before implementing, determine:**

1. Does LLxprt have any deprecated settings that need migration?
2. Has commit 608da23 (disable* → enable* rename) been applied to LLxprt?
3. What are the current LLxprt setting names in settingsSchema.ts?

**If 608da23 has NOT been applied:**
- This commit (93ae777) is a dependency/follow-up to the settings rename
- Implement both together or skip both

**If 608da23 HAS been applied:**
- Implement the migration function with all four scopes
- Add comprehensive tests

---

## Specific Verification

```bash
# 1. Confirm migrateLegacyInteractiveShellSetting covers all scopes
grep -A 15 "for.*scopeSettings.*of" packages/cli/src/config/settings.ts

# 2. Confirm 608da23 (disable→enable rename) has NOT yet landed
grep -n "enableAutoUpdateNotification\|enableAutoUpdate\b" packages/cli/src/config/settingsSchema.ts

# 3. When 608da23 lands, run settings tests to verify migration
npm run test -- packages/cli/src/config/settings.test.ts
```

---

## LLxprt-Specific Notes

- LLxprt already has scope-wide migration via `migrateLegacyInteractiveShellSetting` — it processes System, SystemDefaults, User, and Workspace in that order
- `AccessibilitySettings` still has `disableLoadingPhrases` (not yet renamed) — confirms 608da23 is not yet in LLxprt
- **Do NOT add `migrateDeprecatedSettings` prematurely** — the settings it would migrate do not yet exist under their new names in LLxprt
- When implementing, follow the same 4-scope loop pattern already used in `loadSettings()`
