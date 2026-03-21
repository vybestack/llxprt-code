# Playbook: Simplify Extension Settings Command

**Upstream SHA:** `97b31c4eefa`
**Upstream Subject:** Simplify extension settings command (#16001)
**Upstream Stats:** 9 files, 514 insertions, 420 deletions

## What Upstream Does

Upstream replaces the `settings set` / `settings list` two-subcommand pattern with a single `config` command that:
1. `config <name> <setting>` — configure a single setting (replaces `settings set`)
2. `config <name>` — interactively configure all settings for one extension (new capability)
3. `config` (no args) — interactively configure all installed extensions (new capability)
4. Adds overwrite confirmation prompts when a setting already has a value
5. Shows advisory notes when a setting is configured at workspace scope while editing user scope
6. Extracts `getExtensionManager()` from `getExtensionAndManager()` in utils.ts
7. Updates install-time warning message to reference `config` instead of `settings`

## Why REIMPLEMENT in LLxprt

1. LLxprt's extension settings infrastructure uses standalone functions (`loadExtensionByName`, `loadExtensionConfig`, `getExtensionAndConfig`) rather than upstream's `ExtensionManager` class with `getExtensions()`, `loadExtensionConfig()`, etc.
2. LLxprt's `updateSetting()` signature is `(extensionName, extensionDir, settingKey, requestSetting, scope)` — not `(extensionConfig, extensionId, settingKey, promptForSetting, scope)` as upstream.
3. LLxprt's `getScopedEnvContents()` signature is `(extensionName, extensionDir, scope)` — not `(extensionConfig, extensionId, scope)` as upstream.
4. LLxprt's `GeminiCLIExtension` has `name` + `path` but no `id` field (upstream uses `id` for storage keys).
5. LLxprt's `getExtensionAndConfig()` helper in utils.ts returns `{extension, extensionConfig}` using `loadExtensionByName()` + `loadExtensionConfig()` — no `ExtensionManager` involved.
6. LLxprt has `promptForSetting()` as a file-private function in `settings.ts`; upstream exports it from `extensionSettings.js`.

## LLxprt-Specific Design Decision

Upstream replaces `set`/`list` with a single `config` command at the extensions level. LLxprt follows this simplification by adding a canonical `config` subcommand directly under the `extensions` parent command (i.e., `llxprt extensions config`). The existing `settings set`/`settings list` subcommands remain as backward-compatibility aliases so existing scripts and docs are not broken.

Canonical command shape (mirrors upstream):
- `llxprt extensions config <name> <setting>` — configure a specific setting
- `llxprt extensions config <name>` — interactively configure all settings for one extension
- `llxprt extensions config` — interactively configure all installed extensions

Backward-compatibility aliases (unchanged, existing):
- `llxprt extensions settings set <name> <setting>` — still works
- `llxprt extensions settings list <name>` — still works

This is a deliberate, bounded divergence from strict upstream replacement semantics: LLxprt keeps legacy aliases for compatibility, while making `llxprt extensions config` the canonical shape.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/cli/src/commands/extensions/settings.ts` — `setCommand` (line 143), `listCommand` (line 174), `settingsCommand` (line 198)
- [OK] `packages/cli/src/commands/extensions/settings.ts` — `promptForSetting()` (line 31, file-private)
- [OK] `packages/cli/src/commands/extensions/settings.ts` — `handleSet()` (line 85), `handleList()` (line 110)
- [OK] `packages/cli/src/commands/extensions/utils.ts` — `getExtensionAndConfig()` (line 29)
- [OK] `packages/cli/src/config/extensions/settingsIntegration.ts` — `getEnvContents()` (line 273)
- [OK] `packages/cli/src/config/extensions/settingsIntegration.ts` — `getScopedEnvContents()` (line 240) — signature: `(extensionName, extensionDir, scope)`
- [OK] `packages/cli/src/config/extensions/settingsIntegration.ts` — `updateSetting()` (line 373) — signature: `(extensionName, extensionDir, settingKey, requestSetting, scope)`
- [OK] `packages/cli/src/config/extensions/settingsIntegration.ts` — `ExtensionSettingScope` enum (line 25, USER/WORKSPACE)
- [OK] `packages/cli/src/config/extensions/settingsIntegration.ts` — `loadExtensionSettingsFromManifest()` (line 41)
- [OK] `packages/cli/src/config/extension.ts` — `ExtensionSetting` interface (line 52)
- [OK] `packages/cli/src/config/extension.ts` — `ResolvedExtensionSetting` interface (line 63, no `source` field)
- [OK] `packages/cli/src/config/extension.ts` — install-warning message referencing `settings` command (line 691)
- [OK] `packages/cli/src/config/extensions/extensionSettings.ts` — `ExtensionSetting` zod type (line 53)
- [OK] `packages/cli/src/config/extensions/settingsStorage.ts` — `ExtensionSettingsStorage` class
- [OK] `packages/cli/src/config/extensions/settingsPrompt.ts` — `maybePromptForSettings()`
- [OK] `packages/cli/src/commands/extensions.tsx` — parent command registering `settingsCommand`
- [OK] `packages/cli/src/commands/extensions/settings.test.ts` — existing tests for `setCommand`/`listCommand`

**To be created:**
- `packages/cli/src/commands/extensions/config.ts` — New `config` command (registered under `extensions` parent)
- `packages/cli/src/commands/extensions/config.test.ts` — Tests for config command

## Files to Modify / Create

### 1. Create: `packages/cli/src/commands/extensions/config.ts`

Interactive config command built on LLxprt's existing helpers:

```typescript
import type { CommandModule } from 'yargs';
import { getExtensionAndConfig } from './utils.js';
import {
  updateSetting,
  getScopedEnvContents,
  ExtensionSettingScope,
  loadExtensionSettingsFromManifest,
} from '../../config/extensions/settingsIntegration.js';
import {
  loadExtensionByName,
  loadUserExtensions,
  loadExtensionConfig,
} from '../../config/extension.js';
import { exitCli } from '../utils.js';
import { promptForSetting } from './settings.js';
```

Three modes:
- **`config <name> <setting>`** — configure a specific setting (calls `updateSetting(extensionConfig.name, extension.path, setting, promptForSetting, scope)`)
- **`config <name>`** — configure all settings for an extension (loads settings via `loadExtensionSettingsFromManifest(extension.path)`, checks existing values via `getScopedEnvContents(extensionConfig.name, extension.path, scope)`, prompts for overwrite, then calls `updateSetting` per setting)
- **`config`** — iterates all installed extensions via `loadUserExtensions()`, loads config for each, configures settings

For overwrite confirmation:
- Checks `getScopedEnvContents(extensionConfig.name, extension.path, scope)` for current scope values
- If `scope === USER`, also checks `getScopedEnvContents(extensionConfig.name, extension.path, WORKSPACE)` and logs advisory if workspace value exists
- If value already set in current scope, prompts "Setting X is already set. Overwrite? [y/N]" using readline (synchronous prompt, no `prompts` dependency — match LLxprt's existing readline pattern from `promptForSetting`)
- If user declines, skip that setting

Use `exitCli()` exactly once after the selected mode completes (including full all-extensions iteration), matching `setCommand`/`listCommand` process-lifecycle behavior.

Export as `configCommand: CommandModule`.

### 2. Modify: `packages/cli/src/commands/extensions/settings.ts`

- Add `export` to `promptForSetting()` declaration (line 31): `export async function promptForSetting(...)` so config.ts can import it.
- No new subcommand registration here — the `config` command is registered at the `extensions` level, not under `settingsCommand`. The `setCommand`/`listCommand` remain unchanged as backward-compatibility aliases.

### 3. Modify: `packages/cli/src/commands/extensions.tsx`

Register the new `configCommand` as a sibling to `settingsCommand` under the `extensions` parent:

```typescript
import { configCommand } from './extensions/config.js';

// In extensionsCommand.builder:
yargs
  .command(settingsCommand)
  .command(configCommand)
  // ... existing subcommands
```

### 4. Modify: `packages/cli/src/config/extension.ts`

Update install-time warning message at line 691 to reference the canonical `config` command:

```typescript
// Change from:
const message = `Extension "${newExtensionConfig.name}" has missing settings: ${settingNames}. Please run "llxprt extensions settings set ${newExtensionConfig.name} <setting-name>" or "llxprt extensions config ${newExtensionConfig.name}" to configure them.`;
// To:
const message = `Extension "${newExtensionConfig.name}" has missing settings: ${settingNames}. Please run "llxprt extensions config ${newExtensionConfig.name}" to configure them.`;
```

### 5. No changes to: `packages/cli/src/config/extensions/settingsIntegration.ts`

All existing functions (`updateSetting`, `getScopedEnvContents`, `loadExtensionSettingsFromManifest`) already have the correct signatures for config.ts to consume. No new function needed — the upstream's `getResolvedSettingsWithSource` concept is not part of this commit's scope (that belongs to commit 77e226c55fe "Show settings source").

### 6. No changes to: `packages/cli/src/config/extension.ts` interfaces

The `ResolvedExtensionSetting` interface does not need a `source` field for this commit. Source/provenance tracking is part of a separate upstream commit (77e226c55fe, REIMPLEMENT #70) and should not be mixed in here.

### 7. Create: `packages/cli/src/commands/extensions/config.test.ts`

Tests using vitest, mocking the same modules as `settings.test.ts`:

**Mocks:**
- `./utils.js` → mock `getExtensionAndConfig`
- `../../config/extensions/settingsIntegration.js` → mock `updateSetting`, `getScopedEnvContents`, `loadExtensionSettingsFromManifest` (use real exported `ExtensionSettingScope` enum values; do not mock the enum)
- `../../config/extension.js` → mock `loadUserExtensions`, `loadExtensionConfig`
- `../utils.js` → mock `exitCli`

**Deterministic overwrite-confirmation test seam (required):**
- In `config.ts`, factor overwrite confirmation behind a small helper exported from the module (for example `confirmOverwrite(settingName: string): Promise<boolean>`), implemented with readline in production.
- In tests, mock that helper directly to return `true`/`false` for accepted/declined cases.
- Do **not** rely on real stdin/readline interaction in tests.

- `./settings.js` → mock `promptForSetting`

**Test cases:**

1. **Specific setting mode:** `config test-ext TEST_VAR` calls `updateSetting('test-ext', '/path/to/extension', 'TEST_VAR', promptForSetting, 'user')`
2. **Specific setting with scope:** `config test-ext TEST_VAR --scope workspace` passes workspace scope
3. **Missing extension:** `config nonexistent TEST_VAR` → `updateSetting` not called
4. **Extension name validation:** `config ../bad TEST_VAR` → logs error, no `updateSetting`
5. **All settings mode:** `config test-ext` → loads manifest settings, calls `updateSetting` for each
6. **All settings with no settings defined:** `config test-ext` when manifest returns empty → logs "no settings to configure"
7. **Overwrite confirmation (accepted):** When `getScopedEnvContents` returns existing value, prompts for overwrite → user accepts → calls `updateSetting`
8. **Overwrite confirmation (declined):** Same scenario → user declines → skips that setting
9. **Workspace advisory:** When configuring user scope and workspace value exists, logs advisory note
10. **All extensions mode:** `config` with no args → iterates installed extensions, configures each
11. **All extensions with none installed:** `config` → logs "No extensions installed"
12. **All-extensions mode resilience:** when one extension fails during load/configure, command logs the failure, continues with remaining extensions, and still applies settings to others.
13. **All-extensions partial-failure exit semantics:** if one or more extensions fail in all-extensions mode, command exits non-zero after processing all extensions (while still applying successful configurations for other extensions).

## Preflight Checks

```bash
# Verify settings.ts structure
grep -n "setCommand\|listCommand\|settingsCommand\|promptForSetting" \
  packages/cli/src/commands/extensions/settings.ts

# Verify settingsIntegration.ts function signatures
grep -n "export.*function\|export enum" \
  packages/cli/src/config/extensions/settingsIntegration.ts

# Verify updateSetting signature (extensionName, extensionDir pattern)
sed -n '373,379p' packages/cli/src/config/extensions/settingsIntegration.ts

# Verify getScopedEnvContents signature
sed -n '240,244p' packages/cli/src/config/extensions/settingsIntegration.ts

# Verify getExtensionAndConfig helper
grep -n "export async function getExtensionAndConfig" \
  packages/cli/src/commands/extensions/utils.ts

# Verify config.ts does not exist yet
test ! -f packages/cli/src/commands/extensions/config.ts && echo "OK: config.ts absent"

# Verify install warning message location
grep -n "Please run.*settings" packages/cli/src/config/extension.ts

# Verify extensions.tsx parent command structure
grep -n "command\|settingsCommand" packages/cli/src/commands/extensions.tsx
```

## Implementation Steps

1. **Read** `settingsIntegration.ts` fully to confirm `updateSetting()`, `getScopedEnvContents()`, and `loadExtensionSettingsFromManifest()` signatures and behavior.
2. **Read** `settings.ts` to confirm `promptForSetting()` and yargs command pattern.
3. **Read** `extension.ts` to confirm `loadUserExtensions()`, `loadExtensionConfig()`, and install-warning message.
4. **Read** `utils.ts` to confirm `getExtensionAndConfig()` pattern.
5. **Read** `extensions.tsx` to confirm parent command builder structure for registering `configCommand`.
6. **Export `promptForSetting`** from `settings.ts` (add `export` keyword to line 31).
7. **Create `config.ts`:**
   - Import `getExtensionAndConfig` from `./utils.js`
   - Import `updateSetting`, `getScopedEnvContents`, `ExtensionSettingScope`, `loadExtensionSettingsFromManifest` from `../../config/extensions/settingsIntegration.js`
   - Import `loadUserExtensions`, `loadExtensionConfig` from `../../config/extension.js`
   - Import `promptForSetting` from `./settings.js`
   - Import `exitCli` from `../utils.js`
   - Build three-mode handler using LLxprt's `(extensionName, extensionDir)` API pattern
   - For all-extensions mode: use `loadUserExtensions()` to iterate, `loadExtensionConfig({extensionDir, workspaceDir})` to get config for each
- For all-extensions mode, require continue-on-error behavior: if one extension fails to load config or update settings, log that extension-specific failure and continue configuring remaining extensions; after processing all extensions, exit non-zero if any extension failed.

   - Use readline-based overwrite confirmation (no `prompts` dependency)
8. **Register** `configCommand` in `extensions.tsx` as a sibling to `settingsCommand`.
9. **Update** install-warning message in `extension.ts` line 691.
10. **Create `config.test.ts`** with the test cases enumerated above.
11. **Run verification.**

## Verification

```bash
npm run typecheck
npm run lint
npm run test -- --reporter=verbose packages/cli/src/commands/extensions/config.test.ts
npm run test -- --reporter=verbose packages/cli/src/commands/extensions/settings.test.ts
npm run test -- --reporter=verbose packages/cli/src/config/extensions/settingsIntegration.test.ts
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Execution Notes / Risks

- **Risk: Breaking existing `set`/`list` commands.** Keep them fully backwards-compatible. The `config` command is a new sibling under `extensions`, not a replacement for `settingsCommand`.
- **Risk: `promptForSetting` sharing.** Currently file-private in `settings.ts`. Adding `export` is low-risk since no other module imports it yet and the name is unique. Verify no naming collisions with the type `ExtensionSetting.promptForSetting` (there is none).
- **Risk: Overwrite confirmation UX.** Upstream uses `prompts` npm package for confirmation. LLxprt should use readline-based confirmation matching the existing `promptForConsentNonInteractive` pattern in `extension.ts` (lines 505-520) or a simple `readline.question` — do NOT add `prompts` dependency if it's not already in the project.
- **Risk: `loadUserExtensions()` for all-extensions mode.** This only returns user-installed extensions, not workspace extensions. This matches upstream's behavior where `extensionManager.getExtensions()` similarly only lists managed extensions.
- **Do NOT** remove `set`/`list` from `settingsCommand`. They remain as backward-compatibility aliases.
- **Do NOT** adopt upstream's `ExtensionManager`-based architecture in config.ts. Use LLxprt's existing standalone function pattern.
- **Do NOT** add a `source` field to `ResolvedExtensionSetting` — that belongs to commit 77e226c55fe (REIMPLEMENT #70).
- **Do NOT** change `getEnvContents()` or `getScopedEnvContents()` signatures — the config command consumes them as-is.
- **Do NOT** change `utils.ts` to add `getExtensionManager()` — LLxprt doesn't have an `ExtensionManager` class in the command layer; `getExtensionAndConfig()` is the correct helper.
