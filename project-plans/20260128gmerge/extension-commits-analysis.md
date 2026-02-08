# Extension commit analysis (gemini-cli upstream)

Scope: extension-related commits cc2c48d59, b248ec6df, 47603ef8e, c88340314, bafbcbbe8. Reviewed upstream diffs and LLxprt extension implementation (functional architecture). Note: `packages/core/src/extensions/` does **not** exist in LLxprt; extension logic lives in `packages/cli/src/config/extension.ts` and core extension loading in `packages/core/src/utils/extensionLoader.ts` + `packages/core/src/config/config.ts`.

---

## cc2c48d59 — fix(extension-uninstallation): directory name mismatch
**Upstream change**
- In `packages/cli/src/config/extension-manager.ts`, uninstall now uses directory basename for non-link installs, and extension name for link installs.
- Added test for uninstalling when extension name differs from directory name.

**LLxprt check**
- `packages/cli/src/config/extension.ts` already handles this in `uninstallExtension`:
  - Uses `ExtensionStorage(extension.installMetadata?.type === 'link' ? extension.name : path.basename(extension.path))`.

**Decision**: **ALREADY COVERED**
- Logic already matches upstream fix; no action required.

---

## b248ec6df — setting to block Git/GitHub extensions
**Upstream change**
- Adds `security.blockGitExtensions` setting, prevents installing/loading Git/GitHub extensions.
- Updates schema and docs. Tests confirm:
  - Loading a git-based extension returns null.
  - Installing Git extension throws error.

**LLxprt check**
- `packages/cli/src/config/extension.ts`:
  - `loadExtension` blocks git/github-release when `settings.security?.blockGitExtensions` is true.
  - `installOrUpdateExtension` throws error when Git/GitHub installs are blocked.
- `packages/cli/src/config/settingsSchema.ts` already contains `blockGitExtensions`.

**Decision**: **ALREADY COVERED**
- LLxprt already has both load and install enforcement + schema.

---

## 47603ef8e — refresh memory on extension load/unload
**Upstream change**
- Adds `refreshServerHierarchicalMemory` helper to reload memory and update config/state.
- Extension loader now refreshes memory after all start/stop operations complete.
- Core emits `CoreEvent.MemoryChanged`, UI listens to update counts.

**LLxprt check**
- `packages/core/src/utils/extensionLoader.ts`:
  - `maybeRefreshMemory()` refreshes memory after all extension start/stop.
  - It calls `config.refreshMemory()` (already consolidated on core Config).
- `packages/core/src/config/config.ts`:
  - `refreshMemory()` reloads memory, updates LLXPRT.md state, emits `CoreEvent.MemoryChanged`.

**Decision**: **ALREADY COVERED**
- Memory refresh-on-extension load/unload is already implemented with the same behavior.

---

## c88340314 — extension reloading respects updated excludeTools
**Upstream change**
- Tool registry keeps **all** tools registered, even excluded ones.
- Exclusions are applied dynamically at query time, enabling tools to reappear when excludeTools changes.
- Handles exclusion matching for:
  - Tool name
  - Class name
  - MCP tools (qualified/unqualified)
- Extension loader refreshes Gemini tools list when excludeTools changes.

**LLxprt check**
- `packages/core/src/utils/extensionLoader.ts`:
  - Already refreshes Gemini tools list when extension has `excludeTools`.
- `packages/core/src/config/config.ts`:
  - `createToolRegistry` currently **skips registering** a tool when excluded at creation time (using `getExcludeTools()`), which can prevent the tool from reappearing after extension unload or settings change.
- `packages/core/src/tools/tool-registry.ts`:
  - Governance checks exist, but it is not structured to preserve excluded tools for later re-enable.
  - Exclusion matching is normalized but does **not** mirror upstream’s MCP qualified/unqualified match or class name check.

**Decision**: **REIMPLEMENT**
- Needed to preserve tools even when excluded at initialization, so they can be re-enabled if extensions unload or settings change.
- Needed to expand excludeTools matching to cover MCP tool name variants and class-name exclusions (parity with upstream).
- Fits LLxprt’s functional architecture; requires updates to core Config + ToolRegistry, not extension-manager.

---

## bafbcbbe8 — `/extensions restart` command
**Upstream change**
- Adds `/extensions restart` command.
- Adds `ExtensionLoader.restartExtension()`.
- UI updates for info messages and extension state reducer (`RESTARTED`).

**LLxprt check**
- `packages/core/src/utils/extensionLoader.ts` already implements `restartExtension` with config checks.
- `packages/cli/src/ui/commands/extensionsCommand.ts` already has `restart` subcommand.
- `packages/cli/src/ui/state/extensions.ts` already includes `RESTARTED` reducer action.

**Decision**: **ALREADY COVERED**
- No additional work needed.

---

# Summary table

| Commit | Decision | Notes |
| --- | --- | --- |
| cc2c48d59 | ALREADY COVERED | Uninstall uses basename for non-link installs in LLxprt. |
| b248ec6df | ALREADY COVERED | blockGitExtensions already enforced in load/install + schema. |
| 47603ef8e | ALREADY COVERED | Extension load/unload triggers memory refresh via Config. |
| c88340314 | REIMPLEMENT | Need dynamic tool exclusion (keep tools registered), plus MCP/class-name matching. |
| bafbcbbe8 | ALREADY COVERED | Restart command + restartExtension already present. |
