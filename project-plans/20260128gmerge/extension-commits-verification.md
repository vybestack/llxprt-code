# Extension Commits Verification

## Overview

This document analyzes five upstream gemini-cli extension-related commits and determines what needs implementation in LLxprt.

**LLxprt Architecture:** Uses a functional extension architecture (no extension-manager.ts class). Extension code lives in:
- `packages/cli/src/config/extension.ts` 
- `packages/core/src/utils/extensionLoader.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/tools/tool-registry.ts`

---

## Commit 1: cc2c48d59 - Fix uninstalling extensions named differently than directory

**Status:** [OK] **ALREADY COVERED**

**Upstream Change:**
In `extension-manager.ts`, uninstall uses `path.basename(extension.path)` for non-link installs to handle cases where extension name differs from directory name.

**LLxprt Implementation:**

File: `packages/cli/src/config/extension.ts` (lines 252-260)
```typescript
export async function uninstallExtension(
  extension: GeminiCLIExtension,
  config: Config,
): Promise<void> {
  await config.getExtensionLoader().unloadExtension(extension);
  const storage = new ExtensionStorage(
    extension.installMetadata?.type === 'link'
      ? extension.name
      : path.basename(extension.path),
  );
  await fs.promises.rm(storage.getExtensionDir(), {
    recursive: true,
    force: true,
  });
}
```

**Verification:** [OK] LLxprt correctly implements the same logic - uses `path.basename(extension.path)` for non-link installs.

---

## Commit 2: b248ec6df - Add setting to disable Git extensions

**Status:** [OK] **ALREADY COVERED**

**Upstream Change:**
Adds `security.blockGitExtensions` setting that blocks installing/loading extensions from Git sources. Checks in `loadExtension()` and `installOrUpdateExtension()`.

**LLxprt Implementation:**

File: `packages/cli/src/config/extension.ts` (lines 190-200)
```typescript
export async function loadExtension(
  extensionPath: string,
  config: Config,
): Promise<GeminiCLIExtension | null> {
  const installMetadata = loadInstallMetadata(extensionPath);
  let effectiveExtensionPath = extensionPath;
  if (
    (installMetadata?.type === 'git' ||
      installMetadata?.type === 'github-release') &&
    config.getSettings().security?.blockGitExtensions
  ) {
    return null;
  }
  // ...
}
```

File: `packages/cli/src/config/extension.ts` (lines 84-91)
```typescript
export async function installOrUpdateExtension(
  // ...
): Promise<GeminiCLIExtension> {
  if (
    (installMetadata.type === 'git' ||
      installMetadata.type === 'github-release') &&
    config.getSettings().security?.blockGitExtensions
  ) {
    throw new Error(
      'Installing extensions from remote sources is disallowed by your current settings.',
    );
  }
  // ...
}
```

**Verification:** [OK] LLxprt correctly implements `blockGitExtensions` checks in both install and load paths.

---

## Commit 3: 47603ef8e - Reload gemini memory on extension load/unload

**Status:** [OK] **ALREADY COVERED**

**Upstream Change:**
Refactors memory loading into `refreshServerHierarchicalMemory()` function and calls it after extension load/unload. Also adds `CoreEvent.MemoryChanged` event.

**LLxprt Implementation:**

File: `packages/core/src/utils/extensionLoader.ts` (lines 68-100)
```typescript
async startExtension(extension: GeminiCLIExtension): Promise<void> {
  this.startingCount++;
  const starting = this.stoppingCount === 0 && this.startingCount === 1;
  if (starting) {
    this.eventEmitter?.emit('extensionsStarting', {
      extensions: this.getExtensions(),
    });
  }
  try {
    await this.config.getMcpClientManager()!.startExtension(extension);
    // Note: Context files are loaded only once all extensions are done
    // loading/unloading to reduce churn, see the `maybeRefreshMemories` call
    // below.
    // ...
  } finally {
    this.startCompletedCount++;
    if (this.startingCount === this.startCompletedCount) {
      this.startingCount = 0;
      this.startCompletedCount = 0;
    }
    await this.maybeRefreshMemories();
  }
}
```

File: `packages/core/src/utils/extensionLoader.ts` (lines 110-145)
```typescript
private async maybeRefreshMemories(): Promise<void> {
  if (!this.config) {
    throw new Error(
      'Cannot refresh gemini memories prior to calling `start`.',
    );
  }
  if (
    !this.isStarting && // Don't refresh memories on the first call to `start`.
    this.startingCount === this.startCompletedCount &&
    this.stoppingCount === this.stopCompletedCount
  ) {
    // Wait until all extensions are done starting and stopping before we
    // reload memory, this is somewhat expensive and also busts the context
    // cache, we want to only do it once.
    await refreshServerHierarchicalMemory(this.config);
  }
}
```

File: `packages/core/src/utils/memoryDiscovery.ts` (line 35)
```typescript
export async function refreshServerHierarchicalMemory(config: Config) {
  // Implementation exists in LLxprt
}
```

**Verification:** [OK] LLxprt has the same implementation - memory refresh after extension load/unload with batching to avoid excessive refreshes.

---

## Commit 4: c88340314 - Dynamic tool exclusion on extension reload

**Status:** [ERROR] **REIMPLEMENT NEEDED**

**Upstream Change Summary:**

1. **Changed from static to dynamic exclusion:**
   - Before: Tools were never registered if excluded (static exclusion)
   - After: All tools are registered, but filtered at query time (dynamic exclusion)
   - Reason: Allows extensions to be reloaded with updated `excludeTools` settings

2. **Implementation details:**
   - Changed `getExcludeTools()` return type from `string[] | undefined` to `Set<string> | undefined`
   - Removed exclusion checks from tool registration (in `config.ts`)
   - Added `getActiveTools()` method to filter excluded tools at query time
   - Added `isActiveTool(tool, excludeTools)` method that checks:
     - Simple tool name
     - Normalized class name (with `_` prefix stripped)
     - MCP tool names (both qualified `server/tool` and unqualified `tool`)
   - Added `getFullyQualifiedPrefix()` method to MCP tools

**LLxprt Current Implementation:**

File: `packages/core/src/config/config.ts` (lines 826-843)
```typescript
getExcludeTools(): string[] | undefined {
  const excludeToolsSet = new Set([...(this.excludeTools ?? [])]);
  for (const extension of this.getExtensionLoader().getExtensions()) {
    if (!extension.isActive) {
      continue;
    }
    for (const tool of extension.excludeTools ?? []) {
      excludeToolsSet.add(tool);
    }
  }
  return [...excludeToolsSet];
}
```

**Issue:** Returns `string[]` instead of `Set<string>` (minor - upstream changed return type)

File: `packages/core/src/config/config.ts` (lines 1296-1313)
```typescript
// In createToolRegistry() method
const excludeTools = this.getExcludeTools() || [];
// ...
const isExcluded = excludeTools.some(
  (tool) => tool === toolName || tool === normalizedClassName,
);

if (isExcluded) {
  isEnabled = false;
}
```

**Issue:** LLxprt uses **static exclusion** - checks exclude during tool registration and doesn't register excluded tools. This prevents dynamic tool exclusion on extension reload.

File: `packages/core/src/tools/tool-registry.ts` (lines 190-225)
```typescript
export class ToolRegistry {
  // The tools keyed by tool name as seen by the LLM.
  private tools: Map<string, AnyDeclarativeTool> = new Map();
  // ...
  
  registerTool(tool: AnyDeclarativeTool): void {
    if (this.tools.has(tool.name)) {
      // Error handling...
    }
    this.tools.set(tool.name, tool);
  }
```

**Issue:** No concept of "all known tools" vs "active tools" - all registered tools are active.

File: `packages/core/src/tools/tool-registry.ts` (lines 424-448)
```typescript
getAllToolNames(): string[] {
  return Array.from(this.tools.keys());
}

getAllTools(): AnyDeclarativeTool[] {
  return Array.from(this.tools.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

getTool(name: string): AnyDeclarativeTool | undefined {
  return this.tools.get(name);
}
```

**Issue:** No filtering of excluded tools at query time.

### What Needs to Change in LLxprt:

1. **Change `getExcludeTools()` return type:**
   - File: `packages/core/src/config/config.ts`
   - Change: `getExcludeTools(): string[] | undefined` → `getExcludeTools(): Set<string> | undefined`
   - Return the Set directly instead of converting to array

2. **Remove static exclusion from tool registration:**
   - File: `packages/core/src/config/config.ts`
   - Remove the `isExcluded` check in `createToolRegistry()` around lines 1296-1313
   - Don't skip registering tools just because they're excluded

3. **Rename `tools` Map to `allKnownTools`:**
   - File: `packages/core/src/tools/tool-registry.ts`
   - Clarify that this includes excluded tools

4. **Add `getActiveTools()` method:**
   - File: `packages/core/src/tools/tool-registry.ts`
   - Filter out excluded tools using `isActiveTool()`

5. **Add `isActiveTool(tool, excludeTools)` method:**
   - File: `packages/core/src/tools/tool-registry.ts`
   - Check multiple name formats:
     - `tool.name`
     - Normalized class name (strip `_` prefix)
     - For MCP tools: both qualified and unqualified names

6. **Add `getFullyQualifiedPrefix()` to MCP tools:**
   - File: `packages/core/src/tools/mcp-tool.ts`
   - Return `${this.serverName}__` prefix

7. **Update all query methods to use `getActiveTools()`:**
   - `getFunctionDeclarations()`
   - `getAllToolNames()`
   - `getAllTools()`
   - `getToolsByServer()`
   - `getTool()`

8. **Update `extensionLoader.ts` to refresh tools:**
   - File: `packages/core/src/utils/extensionLoader.ts`
   - Add `maybeRefreshGeminiTools()` method
   - Call after `startExtension()` and `stopExtension()` when extension has `excludeTools`

**Why This Matters:**

With static exclusion, if an extension is loaded with `excludeTools: ['tool-a']`, then reloaded with `excludeTools: []`, tool-a would still be excluded because it was never registered in the first place. Dynamic exclusion allows the same tool registration to be enabled/disabled based on current configuration.

---

## Commit 5: bafbcbbe8 - Add `/extensions restart` command

**Status:** [OK] **ALREADY COVERED**

**Upstream Change:**
Adds `restart` subcommand to extensions command that restarts specified extensions or all extensions with `--all`. Uses `restartExtension()` method in ExtensionLoader.

**LLxprt Implementation:**

File: `packages/core/src/utils/extensionLoader.ts` (lines 229-232)
```typescript
async restartExtension(extension: GeminiCLIExtension): Promise<void> {
  await this.stopExtension(extension);
  await this.startExtension(extension);
}
```

File: `packages/cli/src/ui/commands/extensionsCommand.ts` (lines 145-249)
```typescript
async function restartAction(
  context: CommandContext,
  args: string,
): Promise<void> {
  const extensionLoader = context.services.config?.getExtensionLoader();
  if (!extensionLoader) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: "Extensions are not yet loaded, can't restart yet",
      },
      Date.now(),
    );
    return;
  }

  const restartArgs = args.split(' ').filter((value) => value.length > 0);
  const all = restartArgs.length === 1 && restartArgs[0] === '--all';
  const names = all ? null : restartArgs;
  
  let extensionsToRestart = extensionLoader
    .getExtensions()
    .filter((extension: GeminiCLIExtension) => extension.isActive);
  if (names) {
    extensionsToRestart = extensionsToRestart.filter(
      (extension: GeminiCLIExtension) => names.includes(extension.name),
    );
    // Warning for not found extensions...
  }
  
  const results = await Promise.allSettled(
    extensionsToRestart.map(async (extension: GeminiCLIExtension) => {
      await extensionLoader.restartExtension(extension);
      context.ui.dispatchExtensionStateUpdate({
        type: 'RESTARTED',
        payload: { name: extension.name },
      });
    }),
  );
  // Error handling...
}
```

File: `packages/cli/src/ui/commands/extensionsCommand.ts` (lines 272-277)
```typescript
const restartCommand: SlashCommand = {
  name: 'restart',
  description: 'Restart extensions. Usage: restart <extension-names>|--all',
  kind: CommandKind.BUILT_IN,
  action: restartAction,
  completion: completeExtensions,
};
```

**Verification:** [OK] LLxprt has full implementation including:
- `restartExtension()` method in ExtensionLoader
- `restartAction()` function in extensionsCommand.ts with `--all` support
- `restartCommand` subcommand definition
- Completion support for active extensions
- Error handling with Promise.allSettled

---

## Summary Table

| Commit | Description | LLxprt Status | Notes |
|--------|-------------|---------------|-------|
| cc2c48d59 | Uninstall fix for different directory names | [OK] Already Covered | Uses `path.basename(extension.path)` for non-link installs |
| b248ec6df | Block Git extensions setting | [OK] Already Covered | Checks `blockGitExtensions` in install and load |
| 47603ef8e | Memory refresh on extension load/unload | [OK] Already Covered | Calls `refreshServerHierarchicalMemory()` with batching |
| **c88340314** | **Dynamic tool exclusion on reload** | **[ERROR] Reimplement Needed** | **LLxprt uses static exclusion, needs dynamic filtering** |
| bafbcbbe8 | `/extensions restart` command | [OK] Already Covered | Full implementation with `--all`, completion, and error handling |

---

## Next Steps for c88340314

The dynamic tool exclusion feature is important for extension reloading functionality. To implement:

1. Start by changing `getExcludeTools()` return type to `Set<string>`
2. Rename `tools` → `allKnownTools` in ToolRegistry
3. Add `getActiveTools()` and `isActiveTool()` methods
4. Remove static exclusion checks from tool registration
5. Update all query methods to filter by active status
6. Add MCP tool qualified/unqualified name handling
7. Add tool refresh to extensionLoader

This will allow LLxprt to properly handle extension reloading with updated `excludeTools` settings.
