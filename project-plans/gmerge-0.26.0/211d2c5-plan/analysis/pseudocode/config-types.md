# Pseudocode: Core Config Type Changes (core/config/config.ts)

## Interface Contracts

```typescript
// ConfigParameters interface (already mostly correct):
interface ConfigParameters {
  hooks?: { [K in HookEventName]?: HookDefinition[] };     // Already event-only
  projectHooks?: { [K in HookEventName]?: HookDefinition[] }; // Already event-only
  disabledHooks?: string[];  // Already declared as separate param
  enableHooks?: boolean;
  enableHooksUI?: boolean;
}

// CHANGE TARGETS:
// 1. Private field projectHooks type: drop & { disabled?: string[] }
// 2. Constructor: wire params.disabledHooks
// 3. getProjectHooks() return type: drop & { disabled?: string[] }
// 4. getDisabledHooks(): change settings key from 'hooks.disabled' to 'hooksConfig.disabled'
// 5. setDisabledHooks(): change settings key from 'hooks.disabled' to 'hooksConfig.disabled'
```

## Pseudocode

```
01: // === FIX private projectHooks field type ===
02: CHANGE private field projectHooks from:
03:   ({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] }) | undefined
04: TO:
05:   { [K in HookEventName]?: HookDefinition[] } | undefined
06:
07: // === FIX constructor to wire disabledHooks param ===
08: IN Config constructor:
09:   EXISTING: this.hooks = params.hooks
10:   EXISTING: this.projectHooks = params.projectHooks
11:   ADD: this.disabledHooks = params.disabledHooks ?? []
12:   // This replaces the post-construction setDisabledHooks() call in CLI config loader
13:
14: // === FIX getProjectHooks() return type ===
15: CHANGE getProjectHooks() return type from:
16:   ({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] }) | undefined
17: TO:
18:   { [K in HookEventName]?: HookDefinition[] } | undefined
19: BODY: return this.projectHooks (no change to body)
20:
21: // === UPDATE getDisabledHooks() persistence key ===
22: MODIFY getDisabledHooks():
23:   IF this.disabledHooks.length === 0:
24:     LET persisted = this.settingsService.get('hooksConfig.disabled')
25:     IF persisted AND persisted.length > 0:
26:       this.disabledHooks = persisted
27:   RETURN this.disabledHooks
28:
29: // === UPDATE setDisabledHooks() persistence key ===
30: MODIFY setDisabledHooks(hooks):
31:   this.disabledHooks = hooks
32:   this.settingsService.set('hooksConfig.disabled', hooks)
```

## Integration Points

```
Line 11: Constructor wiring eliminates need for post-construction setDisabledHooks() call
         - CLI config loader (cli/config.ts lines 1540-1546) can remove that code
         - disabledHooks param passed explicitly from hooksConfig.disabled

Line 24: Settings key change from 'hooks.disabled' to 'hooksConfig.disabled'
         - Must match the new schema path for hooksConfig.disabled
         - SettingsService.get() uses dot-path notation

Line 32: Settings key change from 'hooks.disabled' to 'hooksConfig.disabled'
         - Must match line 24 for consistency
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Change ConfigParameters interface (already correct)
[OK] DO: Only change private field, constructor, getters/setters, return types

[ERROR] DO NOT: Leave 'hooks.disabled' as the persistence key
[OK] DO: Change both get and set to use 'hooksConfig.disabled'

[ERROR] DO NOT: Remove the settingsService fallback in getDisabledHooks
[OK] DO: Keep the fallback but change the key
```
