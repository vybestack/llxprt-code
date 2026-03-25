# Hooks Schema Split — Technical and Functional Specification

**Upstream Commit:** 211d2c5fdd877c506cb38217075d1aee98245d2c
**Risk Level:** HIGH — breaking schema change affecting all hooks consumers

---

## 1. Functional Description

The `hooks` settings object currently serves a dual purpose: it stores **configuration metadata** (enabled, disabled, notifications) alongside **event hook definitions** (BeforeTool, AfterTool, etc.) in the same object. This change splits that into two distinct top-level settings:

- **`hooksConfig`** — System-level configuration: whether hooks are enabled, which hooks are disabled, whether to show notifications.
- **`hooks`** — A pure event-name-to-hook-definitions map. Every key is a `HookEventName`, every value is a `HookDefinition[]`.

Additionally, the `Config` class must initialize `disabledHooks` from its constructor parameter (which is already declared in `ConfigParameters` but currently ignored in the constructor body).

---

## 2. Why This Matters

### 2.1 Type Safety Violation — Schema Layer

The settings schema in `settingsSchema.ts` (lines 1858–1901) defines `hooks` as a mixed object:
```typescript
default: {} as { [K in HookEventName]?: HookDefinition[] } & {
  enabled?: boolean;
  disabled?: string[];
  notifications?: boolean;
},
```
with `properties` containing `enabled`, `disabled`, and `notifications` alongside implicit event-name keys.

**Note on core types:** The `ConfigParameters` interface (config.ts, lines 525–531) already has `hooks` typed as a pure event map (`{ [K in HookEventName]?: HookDefinition[] }`) and `projectHooks` also typed as event-only. `disabledHooks?: string[]` is already a first-class parameter. The type safety violation is therefore **limited to the schema definition, the private `projectHooks` field type, and runtime usage patterns** — not the core parameter interface itself.

### 2.2 Runtime Fragility — CLI Config Loading

In `cli/config.ts` (lines 1519–1527), hooks are loaded by destructuring out `disabled` from the mixed settings object:
```typescript
const hooksConfig = effectiveSettings.hooks || {};
const { disabled: _disabled, ...eventHooks } = hooksConfig as { disabled?: string[]; [key: string]: unknown };
return eventHooks;
```

Then `disabled` is read again separately (lines 1541–1545) and set via `setDisabledHooks()` post-construction. If any code path skips either extraction, the result is either:
- Event processing receives a `disabled` key as though it were an event name (silent corruption)
- Disabled hooks enforcement is lost entirely (hooks run when they should not)

### 2.3 Runtime Fragility — Hook Registry Trust Scan

In `hookRegistry.ts` (line 126), the `checkProjectHooksTrust()` function iterates over project hooks entries and explicitly skips a `disabled` pseudo-key:
```typescript
if (key === 'disabled') continue;
```
This is stale mixed-schema logic: `getProjectHooks()` returns an object whose return type includes `{ disabled?: string[] }` (the private field type on line 765–767), even though `ConfigParameters.projectHooks` is already event-only. The trust scan should not need to filter non-event keys from what should be a pure event map.

### 2.4 Constructor Does Not Wire `disabledHooks` Param

The `Config` constructor (lines 951–955) sets `hooks` and `projectHooks` from params but **does not** set `disabledHooks` from `params.disabledHooks`. The private field `disabledHooks` is initialized to `[]` (line 764) and stays empty until the CLI calls `setDisabledHooks()` post-construction (cli/config.ts, line 1545). This means any code that calls `getDisabledHooks()` between construction and the post-construction `setDisabledHooks()` call sees an empty list, falling through to read `hooks.disabled` from the SettingsService.

### 2.5 Migration Path for User Settings Files

Users and workspace configurations already have `hooks.enabled`, `hooks.disabled`, and `hooks.notifications` persisted on disk. Without an automatic migration during settings loading, these fields will be silently ignored after the schema change — hooks will either never run (if `enabled` defaults to `false`) or disabled hooks won't be enforced.

### 2.6 Upstream Alignment

This is a direct port of upstream commit 211d2c5. Keeping the schemas aligned reduces merge friction for future upstream cherry-picks and ensures documentation, schema generation, and extension authoring guides remain consistent.

---

## 3. Current LLxprt Architecture for Hooks Settings

### 3.1 Schema Definition

**File:** `packages/cli/src/config/settingsSchema.ts`, lines 1858–1901

The `hooks` key is a single top-level settings object with `properties` containing `enabled`, `notifications`, and `disabled`. The default type includes both `HookEventName` event keys and config fields in the same object:
```typescript
default: {} as { [K in HookEventName]?: HookDefinition[] } & {
  enabled?: boolean;
  disabled?: string[];
  notifications?: boolean;
},
```

The merge strategy is `SHALLOW_MERGE` (line 1871), meaning scope-level hooks objects are shallowly merged.

### 3.2 Settings Helper Functions

**File:** `packages/cli/src/config/settingsSchema.ts`, lines 2351–2361

Two functions read from the mixed `hooks` object:
- `getEnableHooksUI(settings)` — reads `settings.tools?.enableHooks ?? true` (experimental gate)
- `getEnableHooks(settings)` — combines `tools.enableHooks` AND `settings.hooks?.enabled ?? false`

Both of these currently read `hooks.enabled` directly.

### 3.3 CLI Config Loading

**File:** `packages/cli/src/config/config.ts`, lines 1517–1547

Config construction performs a manual split:
1. Line 1517: `enableHooks: getEnableHooks(effectiveSettings)` — reads `hooks.enabled`
2. Lines 1519–1527: Destructures `disabled` out of `hooks` to build a pure event map
3. Lines 1541–1545: Reads `disabled` again from `hooks` to call `setDisabledHooks()`

There is no explicit `disabledHooks` parameter passed to `Config()` — it is set post-construction.

### 3.4 Core Config Class

**File:** `packages/core/src/config/config.ts`

- **`ConfigParameters` interface** (lines 523–531): Has `enableHooks`, `enableHooksUI`, `hooks` (event-only type: `{ [K in HookEventName]?: HookDefinition[] }`), `projectHooks` (also event-only: `{ [K in HookEventName]?: HookDefinition[] }`), and `disabledHooks?: string[]`. The parameter types are already correctly split — the type violation does not exist at the interface boundary.
- **Private fields** (lines 759–767): `enableHooks`, `enableHooksUI`, `hooks` (event-only type), `disabledHooks` (defaults to `[]`), `projectHooks` (typed with `& { disabled?: string[] }` — this is the remaining type safety violation on the private field).
- **Constructor** (lines 951–955): Sets `enableHooks`, `enableHooksUI`, `hooks`, `projectHooks` from params. Does **not** set `disabledHooks` from `params.disabledHooks` — it stays at `[]`.
- `getDisabledHooks()` (lines 2737–2746): Falls back to `settingsService.get('hooks.disabled')` if the in-memory list is empty.
- `setDisabledHooks()` (lines 2753–2757): Sets in-memory and persists to `settingsService` under key `'hooks.disabled'`.
- `getProjectHooks()` (lines 2794–2798): Return type includes `{ disabled?: string[] }` — this is the type safety violation the change fixes.

### 3.5 Hook Registry

**File:** `packages/core/src/hooks/hookRegistry.ts`

- `registerHooks()` / `processHookDefinition()` (lines 230–260): Calls `this.config.getDisabledHooks()` to check if each hook should be initially enabled/disabled. This is correct and doesn't care where the disabled list comes from.
- **`checkProjectHooksTrust()`** (lines 117–165): Iterates `Object.entries(projectHooks)` and has the guard `if (key === 'disabled') continue;` (line 126). This is stale mixed-schema logic — it assumes `getProjectHooks()` may return an object with a `disabled` key, which should not be the case after the split.

### 3.6 Hooks CLI Command

**File:** `packages/cli/src/ui/commands/hooksCommand.ts`

Uses `config.getDisabledHooks()` and `config.setDisabledHooks()` to enable/disable individual hooks. This operates through the `Config` API and does not directly access settings. No changes needed to the enable/disable logic itself, but the user-facing message at line 36 references `hooks.enabled` which must be updated.

### 3.7 StatusDisplay Component

**File:** `packages/cli/src/ui/components/StatusDisplay.tsx`

The current component does **not** reference `hooks.notifications` — it unconditionally displays hook status when `activeHooks.length > 0`. The `notifications` setting is defined in the schema but is not consumed in the current LLxprt codebase. The upstream plan references it in `StatusDisplay.tsx`, but in LLxprt this component was refactored to not gate on notifications.

### 3.8 Migration Command

**File:** `packages/cli/src/commands/hooks/migrate.ts`

Migrates hooks from user settings to project-level config. Currently reads `settings.merged.hooks` (line 27) and filters out `disabled` explicitly (line 87: `if (eventName === 'disabled' || !Array.isArray(definitions)) continue`). This is the same fragile pattern the split eliminates.

### 3.9 Extension Hook Loading

**File:** `packages/cli/src/config/extension.ts`, lines 855–858

Extension configs have a `hooks` property typed as `{ [K in HookEventName]?: HookDefinition[] }` — already event-only in the `GeminiCLIExtension` interface (`core/config/config.ts` line 251). Extensions do not use `hooksConfig`. This is correctly separated already.

### 3.10 Settings Persistence via SettingsService

**File:** `packages/core/src/config/config.ts`, lines 2739, 2756

`getDisabledHooks()` and `setDisabledHooks()` persist under the key `'hooks.disabled'` in the `SettingsService`. After the split, this key must become `'hooksConfig.disabled'` to match the new schema path.

### 3.11 Settings Loading

**File:** `packages/cli/src/config/settings.ts`

The `loadSettings()` function loads settings from system, user, and workspace scopes and calls `mergeSettings()`. Currently has no hooks-specific migration step. The `migrateHooksConfig()` function must be called here on each scope's settings before `mergeSettings()` is invoked — this is where the per-scope migration call-site must be added.

---

## 4. Target Architecture After the Change

### 4.1 New Schema Structure

```
settings.json (any scope):
{
  "hooksConfig": {
    "enabled": false,         // Canonical toggle
    "disabled": ["hook-x"],   // Disabled hook names
    "notifications": true     // UI notification toggle
  },
  "hooks": {
    "BeforeTool": [...],      // Event hook definitions only
    "AfterTool": [...]
  }
}
```

### 4.2 Settings Schema

- **New** `hooksConfig` top-level key with properties: `enabled`, `disabled`, `notifications`
- **Modified** `hooks` key: no `properties` for `enabled`/`disabled`/`notifications`; only event definitions via `additionalProperties` or unstructured

### 4.3 Config Construction

- `getEnableHooks()` reads `settings.hooksConfig?.enabled ?? false` instead of `settings.hooks?.enabled ?? false`
- `hooks` passed to `Config()` is already a pure event map — no destructuring needed
- `disabledHooks` passed to `Config()` as an explicit param: `settings.hooksConfig?.disabled ?? []`
- `Config` constructor sets `this.disabledHooks` from `params.disabledHooks`

### 4.4 Config API

- `getDisabledHooks()` / `setDisabledHooks()` persist under `'hooksConfig.disabled'` key
- `getProjectHooks()` return type drops `{ disabled?: string[] }` — returns pure event map

### 4.5 Hook Registry Trust Scan

- `checkProjectHooksTrust()` in `hookRegistry.ts` removes the `if (key === 'disabled') continue;` guard. Since `getProjectHooks()` returns a pure event map, there is no `disabled` pseudo-key to skip.

### 4.6 Settings-Load Migration

A `migrateHooksConfig()` function runs on every scope (system, user, workspace) during settings loading in `packages/cli/src/config/settings.ts`, **before** the merge step. It moves `enabled`, `disabled`, `notifications` from `hooks` into `hooksConfig`, leaving `hooks` as a pure event map.

---

## 5. Cross-Package Impact Map

### 5.1 `packages/cli/src/config/` (CLI Config Package)

| File | Impact |
|------|--------|
| `settingsSchema.ts` | Add `hooksConfig` schema; strip config fields from `hooks` schema; update `getEnableHooks()` and `getEnableHooksUI()` |
| `settingsSchema.test.ts` | Update all `getEnableHooks` tests to use `hooksConfig.enabled` |
| `settings.ts` | Add `migrateHooksConfig()` migration function; call it for all scopes in `loadSettings()` before merge |
| `config.ts` | Remove destructuring hack; pass `disabledHooks` explicitly; read from `hooksConfig` |
| `extension.ts` | No change — extension hooks are already event-only |

### 5.2 `packages/core/src/config/` (Core Config Package)

| File | Impact |
|------|--------|
| `config.ts` | Fix private `projectHooks` field type (drop `& { disabled?: string[] }`); wire `params.disabledHooks` in constructor; update `getProjectHooks()` return type; update persistence key in `getDisabledHooks()`/`setDisabledHooks()` |
| `config.test.ts` | Update test settings to use new schema shape |

### 5.3 `packages/core/src/hooks/` (Core Hook System)

| File | Impact |
|------|--------|
| `hookRegistry.ts` | Remove `if (key === 'disabled') continue;` from `checkProjectHooksTrust()` — stale mixed-schema logic |
| `hookSystem.ts` | No change — already receives hooks via `config.getHooks()` API |
| `hookSystem.test.ts` | Update mock configs if they set `disabled` in hooks object |
| Various test files | Update mock `ConfigParameters` to separate `disabledHooks` from `hooks` |

### 5.4 `packages/cli/src/ui/` (CLI UI Package)

| File | Impact |
|------|--------|
| `commands/hooksCommand.ts` | Update user-facing message referencing `hooks.enabled` |
| `commands/hooksCommand.test.ts` | Update test expectations for message text |
| `components/StatusDisplay.tsx` | No code change needed (does not reference `hooks.notifications` currently) |

### 5.5 `packages/cli/src/commands/hooks/` (CLI Hooks Commands)

| File | Impact |
|------|--------|
| `migrate.ts` | Update to read from split schema; no longer filter `disabled` from event iteration |

### 5.6 `integration-tests/` (Integration Tests)

| File | Impact |
|------|--------|
| `hooks/hooks-e2e.integration.test.ts` | Update settings objects to use split schema |

### 5.7 Schema / Documentation

| File | Impact |
|------|--------|
| `schemas/settings.schema.json` | Regenerate to include `hooksConfig` definition |
| Documentation files | Update any references to `hooks.enabled`, `hooks.disabled`, `hooks.notifications` |

---

## 6. Dependency Chain

### 6.1 Must Be Done First (Prerequisites)

None — this is a self-contained schema change with no external dependencies.

### 6.2 Internal Ordering Constraints

1. **Settings schema** (`settingsSchema.ts`) must be updated first — it defines the types that all other code depends on
2. **Migration function** (`settings.ts`) must be added before any code reads `hooksConfig` — otherwise existing user settings will break
3. **Core `Config` types** (`core/config/config.ts`) must be updated before CLI config loading — the CLI constructs `Config` objects
4. **Hook registry trust scan** (`hookRegistry.ts`) must be updated after `getProjectHooks()` return type is cleaned
5. **CLI config loading** (`cli/config.ts`) updates depend on both schema and core types
6. **Tests** can be updated in any order after source changes

### 6.3 Must Be Done After (Dependents)

- JSON schema generation (if automated) must be re-run
- Documentation updates should follow schema changes
- Any downstream consumers that parse `settings.json` directly

---

## 7. Key Technical Decisions and Constraints

### 7.1 Backward Compatibility Is Mandatory

Existing settings files on disk use the old schema. The `migrateHooksConfig()` function must transparently handle old-format files at load time. Users must not need to manually edit settings files. The migration must be idempotent — running it on already-migrated files must be a no-op.

### 7.2 Migration Must Cover All Scopes

Settings are loaded from three file scopes (system, user, workspace) plus system defaults. The migration must run on **all** of them before merging. Missing even one scope means that scope's `hooks.enabled` or `hooks.disabled` is silently dropped.

### 7.3 Migration Call-Site Is `settings.ts`

The `migrateHooksConfig()` function must be called in `packages/cli/src/config/settings.ts` inside `loadSettings()`, on each scope's settings object, before `mergeSettings()` is invoked. This parallels the existing `migrateLegacyInteractiveShellSetting()` pattern already in that file (called on all four scope objects before constructing `LoadedSettings`).

### 7.4 `hooksConfig` Does Not Exist in Extensions

Extension configs (`GeminiCLIExtension.hooks`) are already typed as event-only maps. Extensions do not carry `enabled`, `disabled`, or `notifications`. The `hooksConfig` split is purely a user/workspace/system settings concept. No extension schema changes are needed.

### 7.5 `projectHooks` Private Field Type Must Be Cleaned

The current private `projectHooks` field (line 765–767) is typed as `({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] })`. This is incorrect — `disabled` is not a valid property on a pure hook event map. The type must be changed to `{ [K in HookEventName]?: HookDefinition[] }` only, matching the `ConfigParameters.projectHooks` type which is already clean.

### 7.6 Hook Registry Trust Scan Must Stop Filtering `disabled` Pseudo-Key

The `checkProjectHooksTrust()` method in `hookRegistry.ts` (line 126) contains `if (key === 'disabled') continue;`, which is stale mixed-schema logic. After the split cleans the `getProjectHooks()` return type to a pure event map, this guard becomes dead code. It must be removed to reflect the clean contract and to prevent future confusion about whether `disabled` might appear in the map.

### 7.7 SettingsService Key Must Change

The `getDisabledHooks()` and `setDisabledHooks()` methods persist under `'hooks.disabled'`. After the split, the key must become `'hooksConfig.disabled'`. This affects runtime state persistence — any ephemerally-set disabled hooks will use the new key.

### 7.8 The `hooks` Merge Strategy Remains `SHALLOW_MERGE`

The `hooks` object (now event-only) should retain `SHALLOW_MERGE` so that workspace-level hook definitions are merged with user-level ones. The new `hooksConfig` object should also use `SHALLOW_MERGE` for the same reason — workspace can override `enabled` while inheriting `disabled` from user settings.

### 7.9 `notifications` Is Defined But Unused in LLxprt

The `hooks.notifications` property exists in the schema (line 1883) but is not currently consumed anywhere in the LLxprt codebase — `StatusDisplay.tsx` does not gate on it. It should still be migrated to `hooksConfig.notifications` for schema correctness and future use, but no runtime behavior change is expected from this field.

### 7.10 The `tools.enableHooks` Flag Is Separate

The `tools.enableHooks` flag (line 1106) is an independent experimental gate. It controls whether the hooks UI and system are available at all. The `hooksConfig.enabled` flag is the user-facing canonical toggle. Both must be `true` for hooks to run. The `tools.enableHooks` flag is NOT being moved or renamed in this change.
