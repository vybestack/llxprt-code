# Playbook: Remote Admin Settings (secureModeEnabled & mcpEnabled)

**Upstream SHA:** `2fe45834dde6dac5a1bff2d4df4926b28755eaf0`
**Upstream Subject:** feat(admin): Introduce remote admin settings & implement secureModeEnabled/mcpEnabled
**Upstream Stats:** 9 files, 309 insertions

## What Upstream Does

Introduces a new **`admin` settings category** designed for **enterprise administrators** to enforce policies remotely. This commit implements two admin controls:

1. **`admin.secureModeEnabled`** (boolean, default false):
   - If `true`, **disallows YOLO mode** from being used (similar to existing `security.disableYoloMode`, but takes precedence)
   - Error message changes to "disabled by your admin" to clarify the source of the restriction

2. **`admin.mcp.enabled`** (boolean, default true):
   - If `false`, **disables all MCP servers** (Model Context Protocol)
   - Clears `mcpServers`, `allowedMcpServers`, `blockedMcpServers`, and `mcpServerCommand`
   - Replaces `/mcp` command with a stub that shows "MCP disabled by your admin"

3. **`admin.extensions.enabled`** (boolean, default true):
   - Defined in schema but **not implemented yet** in this commit
   - Reserved for future use to disable extensions

The `admin` settings are designed to be **merged with REPLACE strategy** (not concatenated), allowing system-level configs to override user configs.

## LLxprt Adaptation Strategy

LLxprt **has YOLO mode, MCP support, and extensions**, so this feature is directly applicable. The upstream logic is:

1. **Add `admin` settings schema** with 3 nested properties
2. **Enforce `secureModeEnabled`** in config loading (override `disableYoloMode`)
3. **Enforce `mcpEnabled`** by clearing MCP config and stubbing the `/mcp` command
4. **Add config methods** to store/retrieve remote admin settings
5. **Update tests** to verify the new enforcement logic

### Key Differences

- LLxprt may have different MCP command structure — check if `/mcp` command exists
- LLxprt uses `@vybestack/llxprt-code-core` instead of `@google/gemini-cli-core`
- Settings paths may differ (`.llxprt/` vs `.gemini/`)

## Files to Create/Modify

### 1. Update Settings Schema
**File:** `packages/cli/src/config/settingsSchema.ts`

**Add new top-level `admin` object (after `hooks` or at end of schema):**

```typescript
admin: {
  type: 'object',
  label: 'Admin',
  category: 'Admin',
  requiresRestart: false,
  default: {},
  description: 'Settings configured remotely by enterprise admins.',
  showInDialog: false,
  mergeStrategy: MergeStrategy.REPLACE,
  properties: {
    secureModeEnabled: {
      type: 'boolean',
      label: 'Secure Mode Enabled',
      category: 'Admin',
      requiresRestart: false,
      default: false,
      description: 'If true, disallows yolo mode from being used.',
      showInDialog: false,
      mergeStrategy: MergeStrategy.REPLACE,
    },
    extensions: {
      type: 'object',
      label: 'Extensions Settings',
      category: 'Admin',
      requiresRestart: false,
      default: {},
      description: 'Extensions-specific admin settings.',
      showInDialog: false,
      mergeStrategy: MergeStrategy.REPLACE,
      properties: {
        enabled: {
          type: 'boolean',
          label: 'Extensions Enabled',
          category: 'Admin',
          requiresRestart: false,
          default: true,
          description: 'If false, disallows extensions from being installed or used.',
          showInDialog: false,
          mergeStrategy: MergeStrategy.REPLACE,
        },
      },
    },
    mcp: {
      type: 'object',
      label: 'MCP Settings',
      category: 'Admin',
      requiresRestart: false,
      default: {},
      description: 'MCP-specific admin settings.',
      showInDialog: false,
      mergeStrategy: MergeStrategy.REPLACE,
      properties: {
        enabled: {
          type: 'boolean',
          label: 'MCP Enabled',
          category: 'Admin',
          requiresRestart: false,
          default: true,
          description: 'If false, disallows MCP servers from being used.',
          showInDialog: false,
          mergeStrategy: MergeStrategy.REPLACE,
        },
      },
    },
  },
},
```

**Notes:**
- `showInDialog: false` — these settings are NOT shown in the `/settings` UI (admin-only)
- `mergeStrategy: MergeStrategy.REPLACE` — system settings override user settings
- `extensions.enabled` is defined but not enforced yet (future work)

### 2. Update CLI Config Loader
**File:** `packages/cli/src/config/config.ts` (the CLI-specific loader)

#### a) Enforce `secureModeEnabled` (lines 508-520):

**OLD:**
```typescript
// Override approval mode if disableYoloMode is set.
if (settings.security?.disableYoloMode) {
  if (approvalMode === ApprovalMode.YOLO) {
    debugLogger.error('YOLO mode is disabled by the "disableYolo" setting.');
    throw new FatalConfigError(
      'Cannot start in YOLO mode when it is disabled by settings',
    );
  }
  approvalMode = ApprovalMode.DEFAULT;
}
```

**NEW:**
```typescript
// Override approval mode if disableYoloMode or secureModeEnabled is set.
if (settings.security?.disableYoloMode || settings.admin?.secureModeEnabled) {
  if (approvalMode === ApprovalMode.YOLO) {
    if (settings.admin?.secureModeEnabled) {
      debugLogger.error('YOLO mode is disabled by "secureModeEnabled" setting.');
    } else {
      debugLogger.error('YOLO mode is disabled by the "disableYolo" setting.');
    }
    throw new FatalConfigError(
      'Cannot start in YOLO mode since it is disabled by your admin',
    );
  }
  approvalMode = ApprovalMode.DEFAULT;
}
```

#### b) Enforce `mcpEnabled` (lines 639-669):

**Add before the `return new Config()` statement:**
```typescript
const mcpEnabled = settings.admin?.mcp?.enabled ?? true;
```

**Then update the Config constructor call:**
```typescript
return new Config({
  // ... existing params ...
  mcpServerCommand: mcpEnabled ? settings.mcp?.serverCommand : undefined,
  mcpServers: mcpEnabled ? settings.mcpServers : {},
  mcpEnabled,
  allowedMcpServers: mcpEnabled
    ? (argv.allowedMcpServerNames ?? settings.mcp?.allowed)
    : undefined,
  blockedMcpServers: mcpEnabled
    ? argv.allowedMcpServerNames
      ? undefined
      : settings.mcp?.excluded
    : undefined,
  // ... existing params ...
  disableYoloMode: settings.security?.disableYoloMode || settings.admin?.secureModeEnabled,
  // ... rest of params ...
});
```

**Explanation:** If `mcpEnabled` is false, clear all MCP config and set `allowedMcpServers`/`blockedMcpServers` to `undefined` (not empty arrays).

### 3. Update Core Config Class
**File:** `packages/core/src/config/config.ts`

#### a) Add to `ConfigParameters` interface (line ~359):
```typescript
mcpEnabled?: boolean;
```

#### b) Add field to `Config` class (line ~394):
```typescript
private readonly mcpEnabled: boolean;
```

#### c) Initialize in constructor (line ~519):
```typescript
this.mcpEnabled = params.mcpEnabled ?? true;
```

#### d) Add getter (line ~1141):
```typescript
getMcpEnabled(): boolean {
  return this.mcpEnabled;
}
```

#### e) Add remote admin settings storage (lines ~494, ~902):

**Add fields:**
```typescript
private remoteAdminSettings: GeminiCodeAssistSetting | undefined;
```

**Add getters/setters:**
```typescript
getRemoteAdminSettings(): GeminiCodeAssistSetting | undefined {
  return this.remoteAdminSettings;
}

setRemoteAdminSettings(settings: GeminiCodeAssistSetting): void {
  this.remoteAdminSettings = settings;
}
```

**Note:** `GeminiCodeAssistSetting` is a type imported from `code_assist/types.ts` — check if this type exists in LLxprt.

### 4. Add Code Assist Types (if missing)
**File:** `packages/core/src/code_assist/types.ts`

**Add at the end:**
```typescript
export interface GeminiCodeAssistSetting {
  secureModeEnabled?: boolean;
  mcpSetting?: McpSetting;
  cliFeatureSetting?: CliFeatureSetting;
}

export interface McpSetting {
  mcpEnabled?: boolean;
  allowedMcpConfigs?: McpConfig[];
}

export interface McpConfig {
  mcpServer?: string;
}

export interface CliFeatureSetting {
  extensionsSetting?: ExtensionsSetting;
}

export interface ExtensionsSetting {
  extensionsEnabled?: boolean;
}
```

**Note:** These types are for **future remote admin settings** fetched from a server. Not used yet in this commit.

### 5. Update Builtin Command Loader
**File:** `packages/cli/src/services/BuiltinCommandLoader.ts`

#### a) Add imports (lines 9-12):
```typescript
import {
  CommandKind,
  type SlashCommand,
  type CommandContext,
} from '../ui/commands/types.js';
import type { MessageActionReturn, Config } from '@vybestack/llxprt-code-core';
```

#### b) Replace `/mcp` command conditionally (lines 84-100):

**OLD:**
```typescript
await ideCommand(),
initCommand,
mcpCommand,
memoryCommand,
```

**NEW:**
```typescript
await ideCommand(),
initCommand,
...(this.config?.getMcpEnabled() === false
  ? [
      {
        name: 'mcp',
        description: 'Manage configured Model Context Protocol (MCP) servers',
        kind: CommandKind.BUILT_IN,
        autoExecute: false,
        subCommands: [],
        action: async (
          _context: CommandContext,
        ): Promise<MessageActionReturn> => ({
          type: 'message',
          messageType: 'error',
          content: 'MCP disabled by your admin.',
        }),
      },
    ]
  : [mcpCommand]),
memoryCommand,
```

**Explanation:** If MCP is disabled, replace the real `mcpCommand` with a stub that returns an error message.

### 6. Update Config Tests
**File:** `packages/cli/src/config/config.test.ts`

#### a) Update existing test (line ~1072):

**Change error message expectation:**
```typescript
await expect(loadCliConfig(settings, 'test-session', argv)).rejects.toThrow(
  'Cannot start in YOLO mode since it is disabled by your admin',
);
```

#### b) Add new test suite for `secureModeEnabled` (lines 2415-2471):

```typescript
describe('loadCliConfig secureModeEnabled', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('LLXPRT_API_KEY', 'test-api-key');
    vi.spyOn(ExtensionManager.prototype, 'getExtensions').mockReturnValue([]);
    vi.mocked(isWorkspaceTrusted).mockReturnValue({
      isTrusted: true,
      source: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('should throw an error if YOLO mode is attempted when secureModeEnabled is true', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      admin: {
        secureModeEnabled: true,
      },
    };

    await expect(loadCliConfig(settings, 'test-session', argv)).rejects.toThrow(
      'Cannot start in YOLO mode since it is disabled by your admin',
    );
  });

  it('should throw an error if approval-mode=yolo is attempted when secureModeEnabled is true', async () => {
    process.argv = ['node', 'script.js', '--approval-mode=yolo'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      admin: {
        secureModeEnabled: true,
      },
    };

    await expect(loadCliConfig(settings, 'test-session', argv)).rejects.toThrow(
      'Cannot start in YOLO mode since it is disabled by your admin',
    );
  });

  it('should set disableYoloMode to true when secureModeEnabled is true', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      admin: {
        secureModeEnabled: true,
      },
    };
    const config = await loadCliConfig(settings, 'test-session', argv);
    expect(config.isYoloModeDisabled()).toBe(true);
  });
});
```

#### c) Add new test suite for `mcpEnabled` (lines 2473-2604):

```typescript
describe('loadCliConfig mcpEnabled', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('LLXPRT_API_KEY', 'test-api-key');
    vi.spyOn(ExtensionManager.prototype, 'getExtensions').mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const mcpSettings = {
    mcp: {
      serverCommand: 'mcp-server',
      allowed: ['serverA'],
      excluded: ['serverB'],
    },
    mcpServers: { serverA: { url: 'http://a' } },
  };

  it('should enable MCP by default', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { ...mcpSettings };
    const config = await loadCliConfig(settings, 'test-session', argv);
    expect(config.getMcpEnabled()).toBe(true);
    expect(config.getMcpServerCommand()).toBe('mcp-server');
    expect(config.getMcpServers()).toEqual({ serverA: { url: 'http://a' } });
    expect(config.getAllowedMcpServers()).toEqual(['serverA']);
    expect(config.getBlockedMcpServers()).toEqual(['serverB']);
  });

  it('should disable MCP when mcpEnabled is false', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      ...mcpSettings,
      admin: {
        mcp: {
          enabled: false,
        },
      },
    };
    const config = await loadCliConfig(settings, 'test-session', argv);
    expect(config.getMcpEnabled()).toBe(false);
    expect(config.getMcpServerCommand()).toBeUndefined();
    expect(config.getMcpServers()).toEqual({});
    expect(config.getAllowedMcpServers()).toEqual([]);
    expect(config.getBlockedMcpServers()).toEqual([]);
  });

  it('should enable MCP when mcpEnabled is true', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      ...mcpSettings,
      admin: {
        mcp: {
          enabled: true,
        },
      },
    };
    const config = await loadCliConfig(settings, 'test-session', argv);
    expect(config.getMcpEnabled()).toBe(true);
    expect(config.getMcpServerCommand()).toBe('mcp-server');
    expect(config.getMcpServers()).toEqual({ serverA: { url: 'http://a' } });
    expect(config.getAllowedMcpServers()).toEqual(['serverA']);
    expect(config.getBlockedMcpServers()).toEqual(['serverB']);
  });
});
```

### 7. Update Builtin Command Loader Tests
**File:** `packages/cli/src/services/BuiltinCommandLoader.test.ts`

**Add to all mock configs (3 places):**
```typescript
getMcpEnabled: vi.fn().mockReturnValue(true),
```

**Lines affected:**
- Line ~105 (basic mock config)
- Line ~182 (config with message bus)
- Line ~203 (profile config)

### 8. Update Documentation
**File:** `docs/get-started/configuration.md`

**Add new section under settings (line ~936):**
```markdown
#### `admin`

- **`admin.secureModeEnabled`** (boolean):
  - **Description:** If true, disallows yolo mode from being used.
  - **Default:** `false`

- **`admin.extensions.enabled`** (boolean):
  - **Description:** If false, disallows extensions from being installed or used.
  - **Default:** `true`

- **`admin.mcp.enabled`** (boolean):
  - **Description:** If false, disallows MCP servers from being used.
  - **Default:** `true`
```

### 9. Update Schema JSON (if auto-generated)
**File:** `schemas/settings.schema.json`

This file is **binary** in the upstream diff, so it's likely auto-generated. If LLxprt has a schema generation script, run it after updating `settingsSchema.ts`.

## Implementation Steps

1. **Add settings schema:**
   - Edit `settingsSchema.ts`
   - Add `admin` object with 3 nested properties
   - Verify `mergeStrategy: MergeStrategy.REPLACE` is set

2. **Update core config:**
   - Add `mcpEnabled` field, getter, and constructor logic
   - Add `remoteAdminSettings` field and getters/setters (optional)
   - Add types to `code_assist/types.ts` if missing

3. **Update CLI config loader:**
   - Enforce `secureModeEnabled` in YOLO mode check
   - Enforce `mcpEnabled` by conditionally clearing MCP config
   - Update `disableYoloMode` to consider `secureModeEnabled`

4. **Update builtin command loader:**
   - Replace `/mcp` command with stub if `getMcpEnabled() === false`
   - Add necessary imports

5. **Add tests:**
   - Create `secureModeEnabled` test suite (3 tests)
   - Create `mcpEnabled` test suite (3 tests)
   - Update existing test error message
   - Add mock `getMcpEnabled()` to command loader tests

6. **Update docs:**
   - Add `admin` settings section to configuration docs

7. **Regenerate schema (if applicable):**
   - Run schema generation script if it exists

8. **Manual testing:**
   - Set `admin.secureModeEnabled: true` and try `--yolo` → should error
   - Set `admin.mcp.enabled: false` and run `/mcp` → should show "disabled by admin"
   - Verify that system-level `admin` settings override user settings

## Execution Notes

- **Batch group:** Settings
- **Dependencies:** None (but assumes MCP and YOLO mode exist)
- **Verification:** `npm run typecheck && npm run lint && npm test`
- **Estimated magnitude:** Medium — 9 files, 309 lines, mostly additive
- **Risk:** Low-medium — policy enforcement, but well-tested upstream
- **Critical gotcha:** `admin.extensions.enabled` is defined but NOT enforced yet. Document this clearly.
- **LLxprt-specific:** Replace `GEMINI_API_KEY` with `LLXPRT_API_KEY` in tests. Check if `/mcp` command exists; if not, skip command loader changes.
- **Enterprise impact:** This is the foundation for remote admin settings. Future work will add server-side fetching of `GeminiCodeAssistSetting`.
