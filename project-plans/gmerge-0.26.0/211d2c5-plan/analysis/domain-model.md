# Domain Analysis: Hooks Schema Split

## Entities

### 1. Settings Schema (`SETTINGS_SCHEMA`)

The single source of truth for all settings type definitions. Defines keys, types, defaults, merge strategies, and UI metadata for each setting.

- **Current state**: `hooks` key is a mixed object containing both config fields (`enabled`, `disabled`, `notifications`) and event hook definitions (`BeforeTool`, `AfterTool`, etc.)
- **Target state**: Two separate keys — `hooksConfig` (config fields only) and `hooks` (event definitions only)

### 2. Settings Object (`Settings`)

A TypeScript type inferred from `SETTINGS_SCHEMA`. Represents the runtime shape of a loaded settings file.

- Loaded from four scopes: system, system-defaults, user, workspace
- Merged using per-key merge strategies before use
- **Key relationship**: `Settings` type is derived from `SETTINGS_SCHEMA` via `InferSettings<>`, so schema changes automatically propagate to the type

### 3. Config Parameters (`ConfigParameters`)

Interface for constructing a `Config` instance. Defined in `packages/core/src/config/config.ts`.

- Already has `hooks` typed as pure event map: `{ [K in HookEventName]?: HookDefinition[] }`
- Already has `disabledHooks?: string[]` as a separate parameter
- **Gap**: Constructor does not wire `params.disabledHooks` to `this.disabledHooks`

### 4. Config Class (`Config`)

Core runtime configuration object. Holds hooks state, provides getters/setters.

- **Private fields affected**:
  - `hooks` (line 761-763): Already typed correctly as event-only
  - `disabledHooks` (line 764): Initialized to `[]`, never set from params
  - `projectHooks` (line 765-767): Has stale `& { disabled?: string[] }` in type
- **Methods affected**:
  - `getDisabledHooks()` (line 2737): Falls back to `settingsService.get('hooks.disabled')`
  - `setDisabledHooks()` (line 2753): Persists to `settingsService.set('hooks.disabled', ...)`
  - `getProjectHooks()` (line 2794): Return type includes `{ disabled?: string[] }`

### 5. Hook Registry (`HookRegistry`)

Manages hook registration and trust scanning.

- `checkProjectHooksTrust()` (line 119): Iterates project hooks, has stale `if (key === 'disabled') continue;` guard
- `registerHooks()`: Uses `config.getDisabledHooks()` — works through API, no direct settings access

### 6. CLI Config Loader (cli `config.ts`)

Constructs `Config` instances from merged settings. Current workarounds:

- Lines 1519-1527: Destructures `disabled` out of `hooks` to create a pure event map
- Lines 1540-1545: Reads `disabled` from `hooks` post-construction and calls `setDisabledHooks()`
- Lines 1517-1518: Reads `getEnableHooks()` / `getEnableHooksUI()` which read `hooks.enabled`

### 7. Settings Helpers (`getEnableHooks`, `getEnableHooksUI`)

- `getEnableHooksUI()` (line 2351): Reads `tools.enableHooks` only — no change needed
- `getEnableHooks()` (line 2359): Reads `settings.hooks?.enabled ?? false` — must change to `settings.hooksConfig?.enabled ?? false`

### 8. Hooks Command (`hooksCommand.ts`)

CLI slash command for enabling/disabling individual hooks.

- Line 36: User-facing message references `hooks.enabled` — must change to `hooksConfig.enabled`
- Uses `config.getDisabledHooks()` / `config.setDisabledHooks()` — these persist via SettingsService, so the key change in Config propagates automatically

### 9. Migration Command (`migrate.ts`)

Migrates hooks from user settings to project-level config.

- Line 87: `if (eventName === 'disabled' || !Array.isArray(definitions)) continue;` — stale guard

---

## State Transitions

### Settings File Lifecycle

```
On-Disk (old format)
  → Load from file (per scope)
  → migrateHooksConfig() [NEW — per scope, before merge]
  → In-Memory (new format)
  → mergeSettings() [across scopes]
  → Merged Settings
  → Config construction (CLI config loader)
  → Config instance (runtime)
```

### Migration State Machine

```
Input Settings Object:
  ┌─ Has hooks.enabled/disabled/notifications? ─── YES ──→ Move to hooksConfig (don't overwrite)
  │                                                         Remove from hooks
  │                                                         Return modified settings
  └─ NO ──→ Return unchanged
```

### DisabledHooks Flow (Current → Target)

**Current:**
```
Settings.hooks.disabled → [CLI destructure hack] → setDisabledHooks(post-construction) → Config.disabledHooks
```

**Target:**
```
Settings.hooksConfig.disabled → Config(params.disabledHooks) → Config.disabledHooks (set in constructor)
```

---

## Business Rules

1. **BR-01: hooksConfig takes precedence over hooks for migrated fields** — If both `hooks.enabled` and `hooksConfig.enabled` exist in a settings file, `hooksConfig.enabled` wins.

2. **BR-02: Migration is in-memory only** — Settings files on disk are never modified by the migration. The migration runs every time settings are loaded.

3. **BR-03: Migration must be idempotent** — Running migration on already-migrated settings produces identical output.

4. **BR-04: All scopes must be migrated** — System, system-defaults, user, and workspace settings must each be migrated before the merge step.

5. **BR-05: hooksConfig uses SHALLOW_MERGE** — Workspace can override `enabled` while inheriting `disabled` from user settings.

6. **BR-06: hooks retains SHALLOW_MERGE** — Event definitions continue to merge shallowly across scopes.

7. **BR-07: Both gates required for hook execution** — `tools.enableHooks` (experimental gate) AND `hooksConfig.enabled` (user toggle) must both be true.

8. **BR-08: notifications is defined but unused** — Must be migrated for schema correctness but has no runtime effect in current LLxprt.

9. **BR-09: Extensions are unaffected** — Extension `hooks` is already event-only. No `hooksConfig` applies to extensions.

---

## Edge Cases

1. **Empty hooks object**: `{ hooks: {} }` — No migration needed, no event hooks, no config.
2. **hooks with only config fields**: `{ hooks: { enabled: true } }` — After migration: `hooksConfig: { enabled: true }`, `hooks: {}`.
3. **hooks with only event fields**: `{ hooks: { BeforeTool: [...] } }` — No migration needed, hooks unchanged.
4. **Both old and new format**: `{ hooks: { enabled: false }, hooksConfig: { enabled: true } }` — `hooksConfig.enabled` wins (already set, not overwritten).
5. **null/undefined hooks**: `{ hooks: undefined }` — Migration is a no-op.
6. **disabledHooks param undefined**: Constructor defaults to `[]`.
7. **Settings file with no hooks at all**: No migration needed.
8. **Scope-specific partial migration**: User has `hooks.enabled`, workspace has `hooks.disabled` — each scope migrated independently before merge.

---

## Error Scenarios

1. **Migration called after merge**: Fields from one scope's `hooks.enabled` could be lost if only the merged result is migrated. **Mitigation**: Migration runs per-scope before merge.
2. **getDisabledHooks() called before constructor wiring**: Currently falls back to `settingsService.get('hooks.disabled')`. After fix, constructor sets `disabledHooks` from params, so fallback uses new key `'hooksConfig.disabled'`.
3. **Old settings file with `hooks.disabled` as event key**: Extremely unlikely but possible. Migration moves it to `hooksConfig.disabled`. If a user literally has an event named `disabled`, it would be incorrectly migrated. This is an acceptable edge case given `disabled` is not a valid `HookEventName`.
