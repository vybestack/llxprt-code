# Playbook: Implement Admin Extensions Disabled Enforcement

**Upstream SHA:** `97ad3d97cba`
**Upstream Subject:** Reapply "feat(admin): implement extensions disabled" (#16082) (#16109)
**Upstream Stats:** ~5 files, moderate insertions

## What Upstream Does

Upstream implements an admin-level setting (`admin.extensions.enabled`) that, when set to `false`, prevents all extensions from loading. This is the reapplied version of a previously reverted attempt. The implementation:
1. Adds an `admin.extensions.enabled` field to the admin settings schema (default: `true`).
2. Checks the admin flag in the extension loading code — if `false`, `loadExtensions()` returns an empty array.
3. Surfaces the disabled state in the `/extensions list` UI so users understand why no extensions are loaded.
4. Respects the admin setting hierarchy: admin settings come from system-level config (`/etc/llxprt/settings.json`) and cannot be overridden by user or project settings.

## Why REIMPLEMENT in LLxprt

1. LLxprt's `settingsSchema.ts` does NOT currently include `admin.extensions.enabled` — search confirms zero matches for `admin.*extensions` in this file.
2. LLxprt's `packages/cli/src/config/config.ts` has admin handling for `secureMode` (line 1168) and `mcp.enabled` (line 1376) but no extension-disable enforcement.
3. LLxprt's `packages/cli/src/config/extension.ts` `loadExtensions()` (line 170) filters via `ExtensionEnablementManager.isEnabled()` and workspace trust but has no admin-level gate.
4. The admin settings infrastructure exists (config.ts reads `effectiveSettings.admin`), so the pattern is established — this is adding a new admin flag to it.
5. LLxprt's extension list UI is in `packages/cli/src/ui/components/views/ExtensionsList.tsx` and may need a "disabled by admin" indicator.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/cli/src/config/settingsSchema.ts` — Settings schema (2298 lines), has admin settings structure
- [OK] `packages/cli/src/config/config.ts` — Config class, admin handling at lines 1168, 1376, 1408
- [OK] `packages/cli/src/config/extension.ts` — `loadExtensions()` at line 170, `ExtensionEnablementManager` filtering at line 186
- [OK] `packages/cli/src/ui/components/views/ExtensionsList.tsx` — Extension list UI component
- [OK] `packages/cli/src/config/settings.ts` — Settings loading including system/admin level
- [OK] `packages/cli/src/config/extensions/extensionEnablement.ts` — `ExtensionEnablementManager` class

**Must NOT create:**
- No new files needed — all changes fit in existing files.

## Files to Modify / Create

### 1. Modify: `packages/cli/src/config/settingsSchema.ts`

Add `admin.extensions.enabled` to the admin settings definition. Find the existing admin settings section (search for `admin` properties or `secureMode`) and add:

```typescript
// In the admin settings definition
admin: {
  // ... existing secureMode, mcp, etc.
  extensions: {
    enabled: {
      type: 'boolean',
      label: 'Extensions Enabled (Admin)',
      default: true,
      category: 'Admin',
      description: 'Admin setting to enable or disable all extensions. When false, no extensions will be loaded.',
      showInDialog: false,
      adminOnly: true,
    },
  },
}
```

The exact insertion point depends on how the admin schema is structured. Match the existing pattern for `admin.mcp.enabled` and `admin.secureModeEnabled`.

### 2. Modify: `packages/cli/src/config/extension.ts`

Add an admin check at the top of `loadExtensions()` (line 170). Before loading any extensions, check if admin has disabled them:

```typescript
export function loadExtensions(
  extensionEnablementManager: ExtensionEnablementManager,
  workspaceDir: string = process.cwd(),
): GeminiCLIExtension[] {
  const settings = loadSettings(workspaceDir).merged;

  // Admin-level extension disable enforcement
  if (settings.admin?.extensions?.enabled === false) {
    return [];
  }

  // ... existing loading logic
}
```

### 3. Modify: `packages/cli/src/config/config.ts`

If the config class builds an `extensions` array or passes the admin flag to other components, ensure the admin check is consistent. Look for where `loadExtensions()` is called and verify the admin flag is propagated:

- Around lines 1376-1408 (where admin.mcp.enabled is checked), add a similar check for extensions:

```typescript
// Check admin extension disable (similar to admin.mcp.enabled pattern)
const extensionsEnabled = effectiveSettings.admin?.extensions?.enabled ?? true;
```

This value should be used to gate extension loading or passed to the location where `loadExtensions()` is called.

### 4. Modify: `packages/cli/src/ui/components/views/ExtensionsList.tsx`

Update the extension list UI to show a message when extensions are admin-disabled:

- Accept an `adminDisabled` prop or check the config for the admin setting.
- If admin-disabled, show: "Extensions are disabled by your administrator." instead of (or in addition to) the empty list.
- This mirrors the pattern used for MCP servers being admin-disabled.

### 5. Add/Modify Tests

- **`packages/cli/src/config/extension.test.ts`:** Add test cases for `loadExtensions()` returning empty when `admin.extensions.enabled` is `false`. Test that it returns normally when the flag is `true` or absent (default behavior).
- **`packages/cli/src/config/config.test.ts`:** If there are existing admin setting tests, add a case for extensions disabled enforcement.

## Preflight Checks

```bash
# Verify no existing admin.extensions handling
grep -rn "admin.*extensions\|extensions.*disabled\|extensionsEnabled" \
  packages/cli/src/config/settingsSchema.ts \
  packages/cli/src/config/extension.ts \
  packages/cli/src/config/config.ts
# Expected: no matches (or very few unrelated)

# Verify admin pattern exists (secureMode, mcp)
grep -n "admin.*secureMode\|admin.*mcp" packages/cli/src/config/config.ts
# Expected: matches at lines 1168, 1376, etc.

# Verify loadExtensions signature
grep -n "export function loadExtensions" packages/cli/src/config/extension.ts
# Expected: line 170

# Verify ExtensionsList component exists
test -f packages/cli/src/ui/components/views/ExtensionsList.tsx && echo "OK"
```

## Implementation Steps

1. **Read** `packages/cli/src/config/settingsSchema.ts` admin section to understand existing admin schema structure.
2. **Read** `packages/cli/src/config/config.ts` lines 1160-1420 to understand admin handling patterns.
3. **Add** `admin.extensions.enabled` to the settings schema, following the `admin.mcp.enabled` pattern.
4. **Add** admin gate to `loadExtensions()` at the top of the function in `extension.ts`.
5. **Add** admin gate propagation in `config.ts` if needed (depends on how extensions are loaded in the config pipeline).
6. **Update** `ExtensionsList.tsx` to show admin-disabled message.
7. **Add tests** for the admin extension gate behavior.
8. **Run verification.**

## Verification

```bash
npm run typecheck
npm run lint
npm run test -- --reporter=verbose packages/cli/src/config/extension.test.ts
npm run test -- --reporter=verbose packages/cli/src/config/config
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Execution Notes / Risks

- **Risk: Settings schema structure.** The admin settings may be defined as a nested object in the schema or as flat dotted keys. Read the existing `admin.secureModeEnabled` and `admin.mcp.enabled` patterns carefully and match them exactly.
- **Risk: Type propagation.** The `Settings` type must be extended to include `admin.extensions.enabled`. If the settings type is auto-generated from the schema, it may update automatically. If it's manually typed, update the type definition too.
- **Do NOT** change `ExtensionEnablementManager` — that handles per-extension user-level enable/disable. The admin flag is a global kill switch that takes precedence over per-extension settings.
- **Do NOT** add a UI toggle for this in the settings dialog — admin settings are configured via system-level `settings.json` only (e.g., `/etc/llxprt/settings.json`), not through the interactive UI.
- **Precedence:** Admin settings override all other levels. If `admin.extensions.enabled` is `false`, no extensions load regardless of user or project settings.
- **Default:** `true` — extensions are enabled by default unless an admin explicitly disables them.
