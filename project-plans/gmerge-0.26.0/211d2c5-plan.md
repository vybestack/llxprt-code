# Playbook: Hooks Properties Are Event Names (211d2c5)

**Commit:** 211d2c5fdd877c506cb38217075d1aee98245d2c
**Risk Level:** HIGH
**Scope:** 19 upstream files - fundamental schema change for hooks system

---

## Executive Summary

This commit splits the `hooks` settings into two parts:
1. **`hooksConfig`**: Configuration fields like `enabled`, `disabled`, `notifications`
2. **`hooks`**: Event-specific hook definitions (event names are now the properties)

This is a **breaking schema change** that requires:
- Moving `hooks.enabled` → `hooksConfig.enabled`
- Moving `hooks.disabled` → `hooksConfig.disabled`
- Moving `hooks.notifications` → `hooksConfig.notifications`
- Keeping event hooks (`BeforeTool`, `AfterTool`, etc.) in `hooks`
- Adding `disabledHooks` parameter to Config

---

## Upstream Change Summary

### Schema Changes

**BEFORE:**
```json
{
  "hooks": {
    "enabled": false,
    "disabled": ["hook-name"],
    "notifications": true,
    "BeforeTool": [...],
    "AfterTool": [...]
  }
}
```

**AFTER:**
```json
{
  "hooksConfig": {
    "enabled": false,
    "disabled": ["hook-name"],
    "notifications": true
  },
  "hooks": {
    "BeforeTool": [...],
    "AfterTool": [...]
  }
}
```

### Config Changes

**BEFORE:**
```typescript
// hooks object contained both config and event definitions
hooks: {
  enabled: boolean;
  disabled: string[];
  notifications: boolean;
  [HookEventName]?: HookDefinition[];
}
```

**AFTER:**
```typescript
// Config parameters split
hooksConfig: {
  enabled?: boolean;
  disabled?: string[];
  notifications?: boolean;
}
hooks: {
  [HookEventName]?: HookDefinition[];
}
disabledHooks: string[]; // Separate parameter
```

### Files Modified (19 total)

| File | Changes |
|------|---------|
| `docs/cli/settings.md` | Document `hooksConfig` section |
| `docs/get-started/configuration.md` | Update configuration docs |
| `integration-tests/hooks-agent-flow.test.ts` | Update test settings |
| `integration-tests/hooks-system.test.ts` | Update test settings |
| `packages/cli/src/commands/hooks/migrate.ts` | Update migration logic |
| `packages/cli/src/config/config.ts` | Use `hooksConfig.enabled` |
| `packages/cli/src/config/extension-manager.ts` | Use `hooksConfig.enabled` |
| `packages/cli/src/config/extension.test.ts` | Update test settings |
| `packages/cli/src/config/settingsSchema.ts` | Split `hooks` into `hooksConfig` + `hooks` |
| `packages/cli/src/ui/commands/hooksCommand.ts` | Use `hooksConfig.disabled` |
| `packages/cli/src/ui/components/StatusDisplay.tsx` | Use `hooksConfig.notifications` |
| `packages/core/src/config/config.ts` | Add `disabledHooks` parameter |
| `schemas/settings.schema.json` | Update JSON schema |

---

## LLxprt Current State Analysis

### Current LLxprt Settings Schema

Based on `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/settingsSchema.ts`:

```typescript
hooks: {
  type: 'object',
  label: 'Hooks',
  category: 'Advanced',
  requiresRestart: false,
  default: {} as { [K in HookEventName]?: HookDefinition[] } & {
    enabled?: boolean;
    disabled?: string[];
    notifications?: boolean;
  },
  description: 'Hook configurations for intercepting and customizing agent behavior.',
  showInDialog: false,
  properties: {
    enabled: { ... },
    notifications: { ... },
    disabled: { ... },
  },
},
```

**LLxprt does NOT have `hooksConfig` yet - this needs to be added.**

### Current Config Usage

Based on search results, LLxprt currently:
- Uses `settings.hooks.enabled` in `config.ts`
- Uses `config.getDisabledHooks()` for disabled hooks
- Stores disabled hooks in `settings.hooks.disabled`

---

## Detailed Adaptation Plan

### Phase 1: Update Settings Schema

#### Step 1.1: Add `hooksConfig` to `packages/cli/src/config/settingsSchema.ts`

**Add new top-level `hooksConfig` section BEFORE `hooks`:**

```typescript
hooksConfig: {
  type: 'object',
  label: 'HooksConfig',
  category: 'Advanced',
  requiresRestart: false,
  default: {},
  description: 'Configuration settings for the hooks system.',
  showInDialog: false,
  properties: {
    enabled: {
      type: 'boolean',
      label: 'Enable Hooks',
      category: 'Advanced',
      requiresRestart: false,
      default: false,
      description:
        'Canonical toggle for the hooks system. When disabled, no hooks will be executed.',
      showInDialog: false,
    },
    disabled: {
      type: 'array',
      label: 'Disabled Hooks',
      category: 'Advanced',
      requiresRestart: false,
      default: [] as string[],
      description:
        'List of hook names (commands) that should be disabled. Hooks in this list will not execute even if configured.',
      showInDialog: false,
    },
    notifications: {
      type: 'boolean',
      label: 'Hook Notifications',
      default: true,
      category: 'Advanced',
      description: 'Show visual indicators when hooks are executing.',
      showInDialog: true,
      requiresRestart: false,
    },
  },
},
```

#### Step 1.2: Update `hooks` Section

**Modify the `hooks` section to ONLY contain event definitions:**

```typescript
hooks: {
  type: 'object',
  label: 'Hook Events',
  category: 'Advanced',
  requiresRestart: false,
  default: {},
  description: 'Event-specific hook configurations.',
  showInDialog: false,
  // NOTE: Remove enabled, disabled, notifications from properties
  // These are now in hooksConfig
  // The properties here should be dynamic (event names)
  // For schema purposes, we use additionalProperties
  additionalProperties: {
    type: 'array',
    description: 'Hook definitions for an event.',
    ref: 'HookDefinition',
  },
},
```

### Phase 2: Update Config Types

#### Step 2.1: Update `packages/core/src/config/config.ts`

**Update `ConfigParameters` interface — MANDATORY:**

```typescript
export interface ConfigParameters {
  // ... other properties
  
  // CHANGE: hooks is event-only — no disabled/enabled/notifications
  hooks?: { [K in HookEventName]?: HookDefinition[] };
  
  // ADD: disabledHooks is now a first-class explicit parameter
  // MUST be passed explicitly — never derived from hooks object
  disabledHooks?: string[];
  
  // projectHooks is strictly event-only (no disabled key permitted)
  projectHooks?: { [K in HookEventName]?: HookDefinition[] };
  
  // ... other properties
}
```

> **STRICT TYPE REQUIREMENT:** `projectHooks` MUST be typed as
> `{ [K in HookEventName]?: HookDefinition[] }` — pure event map, no `disabled`
> property. Any code that tries to read `projectHooks.disabled` is a bug.
> `disabledHooks` lives exclusively on `Config` as its own field.

**Update `Config` class initialization:**

```typescript
// In constructor:
// disabledHooks is passed explicitly — never read from hooks object
this.disabledHooks = params.disabledHooks ?? [];

// hooks object is event-only; no config fields to strip
if (params.hooks) {
  this.hooks = params.hooks;
}
```

**Update `getProjectHooks()` return type:**

```typescript
// OLD (wrong — mixed type with disabled):
getProjectHooks():
  | ({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] })
  | undefined;

// REQUIRED (event-only, no disabled):
getProjectHooks(): { [K in HookEventName]?: HookDefinition[] } | undefined {
  return this.projectHooks;
}
```

### Phase 3: Update CLI Config

#### Step 3.1: Update `packages/cli/src/config/config.ts`

**Search Pattern:**
```typescript
settings.hooks?.enabled
settings.hooks.enabled
```

**Replace With:**
```typescript
settings.hooksConfig?.enabled
```

**Full context:**
```typescript
// OLD:
enableHooks:
  (settings.tools?.enableHooks ?? true) &&
  (settings.hooks?.enabled ?? false),

// NEW:
enableHooks:
  (settings.tools?.enableHooks ?? true) &&
  (settings.hooksConfig?.enabled ?? false),
```

**Add `disabledHooks` parameter to config:**
```typescript
await loadServerConfig({
  // ... other params
  enableHooks:
    (settings.tools?.enableHooks ?? true) &&
    (settings.hooksConfig?.enabled ?? false),
  enableHooksUI: settings.tools?.enableHooks ?? true,
  hooks: settings.hooks || {},
  disabledHooks: settings.hooksConfig?.disabled || [], // NEW
  projectHooks: projectHooks || {},
  // ... other params
});
```

#### Step 3.2: Update Extension Manager

**File:** `packages/cli/src/config/extension-manager.ts`

**Search Pattern:**
```typescript
this.settings.hooks.enabled
```

**Replace With:**
```typescript
this.settings.hooksConfig.enabled
```

**Full context:**
```typescript
// OLD:
if (
  this.settings.tools.enableHooks &&
  this.settings.hooks.enabled
) {

// NEW:
if (
  this.settings.tools.enableHooks &&
  this.settings.hooksConfig.enabled
) {
```

### Phase 4: Update Hooks Command

#### Step 4.1: Update `packages/cli/src/ui/commands/hooksCommand.ts`

**Search Pattern:**
```typescript
settings.merged.hooks.disabled
'hooks.disabled'
```

**Replace With:**
```typescript
settings.merged.hooksConfig.disabled
'hooksConfig.disabled'
```

**All replacements needed:**

```typescript
// OLD:
const disabledHooks = settings.merged.hooks.disabled;
settings.setValue(scope, 'hooks.disabled', newDisabledHooks);
config.updateDisabledHooks(settings.merged.hooks.disabled);

// NEW:
const disabledHooks = settings.merged.hooksConfig.disabled;
settings.setValue(scope, 'hooksConfig.disabled', newDisabledHooks);
config.updateDisabledHooks(settings.merged.hooksConfig.disabled);
```

### Phase 5: Update StatusDisplay Component

#### Step 5.1: Update `packages/cli/src/ui/components/StatusDisplay.tsx`

**Search Pattern:**
```typescript
settings.merged.hooks.notifications
```

**Replace With:**
```typescript
settings.merged.hooksConfig.notifications
```

**Full context:**
```typescript
// OLD:
if (
  uiState.activeHooks.length > 0 &&
  settings.merged.hooks.notifications
) {

// NEW:
if (
  uiState.activeHooks.length > 0 &&
  settings.merged.hooksConfig.notifications
) {
```

### Phase 6: Update Migration Command

#### Step 6.1: Update `packages/cli/src/commands/hooks/migrate.ts`

**Search Pattern:**
```typescript
'hooks.enabled'
```

**Replace With:**
```typescript
'hooksConfig.enabled'
```

**Update migration log message:**
```typescript
// OLD:
debugLogger.log(
  'Note: Set hooks.enabled to true in your settings to enable the hook system.',
);

// NEW:
debugLogger.log(
  'Note: Set hooksConfig.enabled to true in your settings to enable the hook system.',
);
```

**Update hooks object handling:**
```typescript
// OLD:
const existingHooks = settings.merged.hooks as Record<string, unknown>;

// NEW:
const existingHooks = (settings.merged?.hooks || {}) as Record<
  string,
  unknown
>;
```

### Phase 7: Update All Tests

#### Step 7.1: Update Integration Tests

**File:** `integration-tests/hooks-system.test.ts`

**Search Pattern:**
```typescript
hooks: {
  enabled: true,
```

**Replace With:**
```typescript
hooksConfig: {
  enabled: true,
},
hooks: {
```

**Example:**
```typescript
// OLD:
settings: {
  hooks: {
    enabled: true,
    BeforeTool: [...]
  }
}

// NEW:
settings: {
  hooksConfig: {
    enabled: true,
  },
  hooks: {
    BeforeTool: [...]
  }
}
```

#### Step 7.2: Update Extension Tests

**File:** `packages/cli/src/config/extension.test.ts`

**Update test settings:**
```typescript
// OLD:
const hooksConfig = {
  hooks: {
    BeforeTool: [...]
  }
};
settings.hooks.enabled = true;

// NEW:
const hooksConfig = {
  enabled: false, // in hooks.json
  hooks: {
    BeforeTool: [...]
  }
};
settings.hooksConfig.enabled = true;
```

### Phase 8: Update Hook System Tests

#### Step 8.1: Update `packages/core/src/hooks/hookSystem.test.ts`

**Search Pattern:**
```typescript
disabled: ['echo "disabled-hook"'],
```

**Move to config:**
```typescript
// OLD:
hooks: {
  BeforeTool: [...],
  disabled: ['echo "disabled-hook"'],
}

// NEW:
hooks: {
  BeforeTool: [...],
},
disabledHooks: ['echo "disabled-hook"'],
```

---

## Files to Read (Full Paths)

```
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/settingsSchema.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/config.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/config/config.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/commands/hooksCommand.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/components/StatusDisplay.tsx
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/extension-manager.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/commands/hooks/migrate.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/hooks/hookSystem.test.ts
```

## Files to Modify (Full Paths)

```
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/settingsSchema.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/config.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/config/config.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/commands/hooksCommand.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/components/StatusDisplay.tsx
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/extension-manager.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/commands/hooks/migrate.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/hooks/hookSystem.test.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/commands/hooksCommand.test.ts
/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/extension.test.ts
```

---

## Risk Areas

### Critical Risk
1. **Breaking Schema Change:** Existing user settings files have old structure — MUST migrate on load (not optional)
2. **Hook System Silently Broken:** If `migrateHooksConfig` is skipped for any scope, `hooksConfig.enabled` stays `undefined` → hooks never run, with no error message
3. **Config Initialization:** `disabledHooks` must be passed explicitly to `Config` constructor — if omitted or read from `hooks` map, disabled-hook enforcement is lost
4. **Mixed-type `projectHooks`:** Any `disabled` key in a `projectHooks` map will be silently ignored at runtime but corrupt TypeScript typechecking

### High Risk
1. **Test Coverage:** All hook tests must be updated to use split schema
2. **Extension Loading:** Extensions may expect old `hooks` structure — migration must also run on extension settings
3. **Incomplete Migration Call Sites:** Settings migration must cover ALL three scopes (system/user/workspace); missing even one scope silently breaks that tier

### Medium Risk
1. **Documentation Sync:** Multiple docs files need updates
2. **Type Safety:** TypeScript types must be consistent across all files

---

## Settings-Load Migration — MANDATORY

> **This migration is NOT optional.** Without it, any existing user/workspace/system
> settings file that contains `hooks.enabled`, `hooks.disabled`, or
> `hooks.notifications` will silently break — hooks will never run or will always
> run, and no error will be shown. Every settings-load path MUST call this
> migration before merging settings into the live config.

### Where to Apply

Add `migrateHooksConfig` in `packages/cli/src/config/settings.ts` (same file
where `disable* → enable*` migration lives). Call it during settings loading for
**all three scopes** — system, user, and workspace — before the merge step.

### Implementation

```typescript
function migrateHooksConfig(settings: Settings): Settings {
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return settings;

  const needsMigration =
    'enabled' in hooks ||
    'disabled' in hooks ||
    'notifications' in hooks;

  if (!needsMigration) return settings;

  const hooksConfig: Record<string, unknown> = {
    ...(settings.hooksConfig as Record<string, unknown> | undefined),
  };
  const newHooks: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(hooks)) {
    if (key === 'enabled' || key === 'disabled' || key === 'notifications') {
      // Migrate to hooksConfig; do NOT overwrite if already present
      if (!(key in hooksConfig)) {
        hooksConfig[key] = value;
      }
    } else {
      newHooks[key] = value;
    }
  }

  return {
    ...settings,
    hooksConfig,
    hooks: newHooks,
  };
}
```

### Call Sites (all three are required — none is optional)

```typescript
// In loadSettings() or equivalent, BEFORE merging:
const systemSettings  = migrateHooksConfig(rawSystemSettings);
const userSettings    = migrateHooksConfig(rawUserSettings);
const workspaceSettings = migrateHooksConfig(rawWorkspaceSettings);
// Then merge as usual
```

> **Acceptance criterion:** A settings file containing the old schema:
> ```json
> { "hooks": { "enabled": true, "disabled": ["foo"], "BeforeTool": [...] } }
> ```
> must produce, after migration, a live config where:
> - `settings.hooksConfig.enabled === true`
> - `settings.hooksConfig.disabled` contains `"foo"`
> - `settings.hooks` contains only `{ "BeforeTool": [...] }`
> - `settings.hooks.enabled` is `undefined` (key removed)

---

## Acceptance Criteria

All of the following must be demonstrably true before this playbook is considered done:

1. **`hooks` object contains ONLY hook event collections** — no `disabled`, `enabled`, or `notifications` keys anywhere in `hooks` type definitions or runtime objects.

2. **All enable/disable/notifications reads go through `hooksConfig`** — grep for `settings.hooks.enabled`, `settings.hooks.disabled`, `settings.hooks.notifications` must return zero results.

3. **Command toggles update `hooksConfig.disabled`** — `hooksCommand.ts` writes to `hooksConfig.disabled`, not `hooks.disabled`.

4. **`Config` constructor receives `disabledHooks` explicitly** — the caller in `packages/cli/src/config/config.ts` passes `disabledHooks: settings.hooksConfig?.disabled ?? []` as a distinct parameter. No code extracts `disabled` from the `hooks` map.

5. **Settings-load migration runs for all three scopes** — `migrateHooksConfig` is called on system, user, and workspace settings before any merge. This is verified by a unit test that feeds an old-format settings object and asserts the migrated shape.

6. **`projectHooks` typed as strict event map** — `{ [K in HookEventName]?: HookDefinition[] }`, no intersection with `{ disabled?: string[] }`.

## Verification Steps

### Step 1: Type Check
```bash
npm run typecheck
```

### Step 2: Run All Tests
```bash
npm run test
```

### Step 3: Verify Migration
Write a unit test (in `settings.test.ts` or equivalent) that asserts:
```typescript
const old = { hooks: { enabled: true, disabled: ['foo'], BeforeTool: [...] } };
const migrated = migrateHooksConfig(old);
expect(migrated.hooksConfig?.enabled).toBe(true);
expect(migrated.hooksConfig?.disabled).toContain('foo');
expect(migrated.hooks?.BeforeTool).toBeDefined();
expect((migrated.hooks as any).enabled).toBeUndefined();
```

### Step 4: Verify Hooks Work End-to-End
```bash
# Create a test hook configuration using NEW schema
cat > ~/.llxprt/settings.json << 'EOF'
{
  "hooksConfig": {
    "enabled": true,
    "notifications": true
  },
  "hooks": {
    "BeforeTool": [{
      "hooks": [{ "command": "echo 'Hook executed'" }]
    }]
  }
}
EOF

node scripts/start.js --profile-load synthetic "read the file test.txt"
# Should see hook notification
```

### Step 5: Verify OLD schema migrates gracefully (backward compat)
```bash
# Create settings using OLD schema
cat > ~/.llxprt/settings.json << 'EOF'
{
  "hooks": {
    "enabled": true,
    "notifications": true,
    "BeforeTool": [{
      "hooks": [{ "command": "echo 'Migrated hook executed'" }]
    }]
  }
}
EOF

node scripts/start.js --profile-load synthetic "read the file test.txt"
# Must still work — migration must have converted on load
```

### Step 6: Full Verification Cycle
```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

---

## Rollback Plan

If critical issues arise after shipping the split schema:
1. Revert to single `hooks` object (undo schema split)
2. Restore `hooks.enabled`, `hooks.disabled`, `hooks.notifications` properties in schema
3. Remove `hooksConfig` references from all consumer files
4. Remove `disabledHooks` explicit parameter; restore reading from `hooks.disabled`

> **Do NOT attempt a "dual-support" partial rollback** (supporting both `hooks.enabled`
> and `hooksConfig.enabled` simultaneously). This leads to ambiguous precedence and
> harder-to-test edge cases. Either the migration runs and the new schema is canonical,
> or you fully revert. There is no safe middle ground.

---

## Notes

- This commit depends on the non-nullable settings refactor (f7f38e2)
- This commit should be applied BEFORE the MCP status hook refactor (cebe386)
- The `hooksConfig` change affects all hook consumers
- Integration tests are the most affected (many settings updates needed)
