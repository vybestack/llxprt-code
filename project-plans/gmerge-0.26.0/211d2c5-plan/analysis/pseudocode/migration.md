# Pseudocode: Migration Function (settings.ts)

## Interface Contracts

```typescript
// INPUT: A single-scope Settings object (may be old or new format)
// OUTPUT: A Settings object with config fields moved from hooks to hooksConfig

interface MigrationInput {
  hooks?: {
    enabled?: boolean;
    disabled?: string[];
    notifications?: boolean;
    [eventName: string]: unknown;  // Event definitions
  };
  hooksConfig?: {
    enabled?: boolean;
    disabled?: string[];
    notifications?: boolean;
  };
  [otherSettings: string]: unknown;
}

// OUTPUT: Same shape but hooks has no config fields, hooksConfig has them
interface MigrationOutput {
  hooks?: { [eventName: string]: unknown };  // Pure event map
  hooksConfig?: {
    enabled?: boolean;
    disabled?: string[];
    notifications?: boolean;
  };
  [otherSettings: string]: unknown;
}
```

## Pseudocode

```
01: FUNCTION migrateHooksConfig(settings: Settings) -> Settings:
02:   LET hooks = settings.hooks as Record<string, unknown> | undefined
03:   IF hooks is null or undefined:
04:     RETURN settings unchanged
05:
06:   LET needsMigration = ('enabled' IN hooks) OR ('disabled' IN hooks) OR ('notifications' IN hooks)
07:   IF NOT needsMigration:
08:     RETURN settings unchanged
09:
10:   // Build new hooksConfig by merging with any existing hooksConfig
11:   LET hooksConfig = shallow-copy of (settings.hooksConfig ?? {})
12:   LET newHooks = empty Record<string, unknown>
13:
14:   FOR EACH [key, value] IN Object.entries(hooks):
15:     IF key is 'enabled' OR key is 'disabled' OR key is 'notifications':
16:       // Migrate to hooksConfig; existing hooksConfig values take precedence
17:       IF key NOT IN hooksConfig:
18:         SET hooksConfig[key] = value
19:     ELSE:
20:       // Keep event definitions in hooks
21:       SET newHooks[key] = value
22:
23:   RETURN {
24:     ...settings,
25:     hooksConfig: hooksConfig,
26:     hooks: newHooks
27:   }
28:
29: // === CALL SITES in loadSettings() ===
30: // Must be called for EVERY scope BEFORE mergeSettings()
31: // Pattern follows existing migrateLegacyInteractiveShellSetting() usage
32:
33: IN loadSettings():
34:   FOR EACH scopeSettings IN [systemSettings, systemDefaultSettings, userSettings, workspaceSettings]:
35:     CALL migrateLegacyInteractiveShellSetting(scopeSettings)  // existing
36:   FOR EACH scopeSettings IN [systemSettings, systemDefaultSettings, userSettings, workspaceSettings]:
37:     LET migrated = migrateHooksConfig(scopeSettings)
38:     ASSIGN migrated properties back to scopeSettings
39:     // Note: migrateLegacyInteractiveShellSetting mutates in place;
40:     // migrateHooksConfig returns a new object — either mutate or reassign
```

## Integration Points

```
Line 01: Called from loadSettings() in packages/cli/src/config/settings.ts
         - Called BEFORE mergeSettings() (critical ordering)
         - Called for each of 4 scope settings objects

Line 14-21: Iterates hooks object entries
         - 'enabled', 'disabled', 'notifications' are config fields → move to hooksConfig
         - All other keys are event names → keep in hooks

Line 17: Precedence rule — existing hooksConfig values NOT overwritten
         - Handles case where user has both old and new format
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Call migrateHooksConfig only on merged settings
[OK] DO: Call it on each scope individually before merge

[ERROR] DO NOT: Overwrite existing hooksConfig values with hooks values
[OK] DO: Only set hooksConfig[key] if key is NOT already in hooksConfig

[ERROR] DO NOT: Modify the settings file on disk
[OK] DO: Migration is in-memory only during load

[ERROR] DO NOT: Mutate the input object (return a new one)
[OK] DO: Return { ...settings, hooksConfig, hooks: newHooks }
```
