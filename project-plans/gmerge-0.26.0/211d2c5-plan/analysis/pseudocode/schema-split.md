# Pseudocode: Schema Split (settingsSchema.ts)

## Interface Contracts

```typescript
// INPUT: Current SETTINGS_SCHEMA.hooks (mixed object)
// OUTPUT: Two separate schema entries — hooksConfig + hooks (event-only)

// DEPENDENCIES:
//   MergeStrategy.SHALLOW_MERGE — from settings merge infrastructure
//   HookEventName — enum/type of valid hook event names
//   HookDefinition — type for hook definition objects
```

## Pseudocode

```
01: // === ADD new hooksConfig schema entry (BEFORE hooks entry) ===
02: DEFINE SETTINGS_SCHEMA.hooksConfig as object:
03:   type: 'object'
04:   label: 'HooksConfig'
05:   category: 'Advanced'
06:   requiresRestart: false
07:   default: {} (typed as { enabled?: boolean; disabled?: string[]; notifications?: boolean })
08:   description: 'Configuration settings for the hooks system.'
09:   showInDialog: false
10:   mergeStrategy: SHALLOW_MERGE
11:   properties:
12:     enabled:
13:       type: 'boolean', label: 'Enable Hooks', category: 'Advanced'
14:       requiresRestart: false, default: false
15:       description: 'Canonical toggle for the hooks system...'
16:       showInDialog: false
17:     disabled:
18:       type: 'array', label: 'Disabled Hooks', category: 'Advanced'
19:       requiresRestart: false, default: [] as string[]
20:       description: 'List of hook names to disable'
21:       showInDialog: false
22:     notifications:
23:       type: 'boolean', label: 'Hook Notifications'
24:       default: true, category: 'Advanced'
25:       description: 'Show visual indicators when hooks are executing.'
26:       showInDialog: false, requiresRestart: false
27:
28: // === MODIFY existing hooks schema entry ===
29: MODIFY SETTINGS_SCHEMA.hooks:
30:   REMOVE 'enabled' from properties
31:   REMOVE 'disabled' from properties
32:   REMOVE 'notifications' from properties
33:   CHANGE default type to: { [K in HookEventName]?: HookDefinition[] }
34:     (remove the & { enabled?: boolean; disabled?: string[]; notifications?: boolean } union)
35:   KEEP mergeStrategy: SHALLOW_MERGE
36:   KEEP category, label, description, showInDialog, requiresRestart
37:   UPDATE description to reflect event-only content
38:
39: // === UPDATE getEnableHooks helper ===
40: MODIFY getEnableHooks(settings):
41:   OLD: return getEnableHooksUI(settings) AND (settings.hooks?.enabled ?? false)
42:   NEW: return getEnableHooksUI(settings) AND (settings.hooksConfig?.enabled ?? false)
43:
44: // === getEnableHooksUI — NO CHANGE ===
45: KEEP getEnableHooksUI(settings):
46:   return settings.tools?.enableHooks ?? true
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Leave hooks.enabled/disabled/notifications in hooks properties
[OK] DO: Move all three to hooksConfig.properties

[ERROR] DO NOT: Change getEnableHooksUI to read hooksConfig (it only reads tools.enableHooks)
[OK] DO: Only change getEnableHooks to read hooksConfig.enabled

[ERROR] DO NOT: Remove SHALLOW_MERGE from hooks
[OK] DO: Keep SHALLOW_MERGE on both hooksConfig and hooks
```
