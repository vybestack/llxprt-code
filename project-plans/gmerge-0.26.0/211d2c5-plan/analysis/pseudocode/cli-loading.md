# Pseudocode: CLI Config Loading Updates

## Interface Contracts

```typescript
// INPUT: effectiveSettings (merged Settings with hooksConfig split)
// OUTPUT: Config instance with correctly wired hooks + disabledHooks

// Files affected:
//   packages/cli/src/config/config.ts (CLI config loading)
//   packages/cli/src/ui/commands/hooksCommand.ts (user-facing messages)
//   packages/cli/src/commands/hooks/migrate.ts (migrate command)
//   packages/core/src/hooks/hookRegistry.ts (trust scan)
```

## Pseudocode — CLI Config Loading (cli/config.ts)

```
01: // === SIMPLIFY hooks parameter (no more destructuring hack) ===
02: // OLD (lines 1519-1527):
03: //   const hooksConfig = effectiveSettings.hooks || {};
04: //   const { disabled: _disabled, ...eventHooks } = hooksConfig as { disabled?: string[]; ... };
05: //   return eventHooks;
06: // NEW:
07: REPLACE hooks parameter with:
08:   hooks: effectiveSettings.hooks || {}
09:   // No destructuring needed — hooks is now a pure event map after migration
10:
11: // === ADD disabledHooks parameter ===
12: ADD to Config constructor call:
13:   disabledHooks: effectiveSettings.hooksConfig?.disabled ?? []
14:
15: // === REMOVE post-construction setDisabledHooks() hack ===
16: // OLD (lines 1540-1546):
17: //   if (effectiveSettings.hooks && 'disabled' in effectiveSettings.hooks) {
18: //     const disabledHooks = (effectiveSettings.hooks as { disabled?: unknown }).disabled;
19: //     if (Array.isArray(disabledHooks)) {
20: //       enhancedConfig.setDisabledHooks(disabledHooks as string[]);
21: //     }
22: //   }
23: // NEW: DELETE this block entirely — constructor now wires disabledHooks from params
24:
25: // === enableHooks already uses getEnableHooks() which reads hooksConfig.enabled ===
26: // (Changed in schema-split pseudocode, line 40-42)
27: // No additional change needed here — getEnableHooks() is already called at line 1517
```

## Pseudocode — Hooks Command (hooksCommand.ts)

```
30: // === UPDATE user-facing message ===
31: CHANGE line 36 message from:
32:   'Hooks system is not enabled. Enable it in settings with hooks.enabled.'
33: TO:
34:   'Hooks system is not enabled. Enable it in settings with hooksConfig.enabled.'
35:
36: // === No other changes needed ===
37: // hooksCommand uses config.getDisabledHooks() / config.setDisabledHooks()
38: // These APIs are updated in config-types pseudocode (lines 21-32)
39: // The command does NOT directly access settings objects
```

## Pseudocode — Migration Command (migrate.ts)

```
40: // === REMOVE stale disabled-key guard ===
41: // OLD (line 87):
42: //   if (eventName === 'disabled' || !Array.isArray(definitions)) continue;
43: // NEW:
44: CHANGE to:
45:   if (!Array.isArray(definitions)) continue;
46: // The 'disabled' key no longer exists in hooks after schema migration
```

## Pseudocode — Hook Registry Trust Scan (hookRegistry.ts)

```
50: // === REMOVE stale disabled-key filtering ===
51: // OLD (line 126-127):
52: //   // Skip the 'disabled' key
53: //   if (key === 'disabled') continue;
54: // NEW:
55: DELETE these two lines
56: // getProjectHooks() now returns a pure event map — no non-event keys exist
```

## Integration Points

```
Line 08: hooks is now settings.hooks directly (pure event map after migration)
         - migrateHooksConfig() runs in loadSettings() BEFORE this code
         - No config fields remain in hooks

Line 13: disabledHooks flows from hooksConfig.disabled to Config constructor
         - Replaces the post-construction hack at lines 1540-1546
         - Config constructor wires this in config-types pseudocode line 11

Line 55: Trust scan cleanup depends on getProjectHooks() return type fix
         - config-types pseudocode lines 14-19 change the return type
         - Without the type fix, TypeScript would still allow .disabled access
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Keep the destructuring hack alongside the new clean path
[OK] DO: Replace the entire IIFE with a simple property access

[ERROR] DO NOT: Keep the post-construction setDisabledHooks() call
[OK] DO: Delete it entirely — constructor handles it

[ERROR] DO NOT: Add hooksConfig references in hooksCommand.ts beyond the message string
[OK] DO: The command already uses config API (getDisabledHooks/setDisabledHooks)

[ERROR] DO NOT: Leave the 'disabled' key guard in hookRegistry trust scan
[OK] DO: Remove it — getProjectHooks() returns pure event map
```
