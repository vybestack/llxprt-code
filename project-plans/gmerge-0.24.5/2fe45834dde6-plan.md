# Playbook: Remote Admin Settings (secureModeEnabled & mcpEnabled)

**Upstream SHA:** `2fe45834dde6dac5a1bff2d4df4926b28755eaf0`
**Upstream Subject:** feat(admin): Introduce remote admin settings & implement secureModeEnabled/mcpEnabled
**Upstream Stats:** 9 files, 309 insertions

## What Upstream Does

Introduces a new **`admin` settings category** for **enterprise administrators** to enforce policies remotely. This commit implements two admin controls:

1. **`admin.secureModeEnabled`** (boolean, default false):
   - If `true`, **disallows YOLO mode**
   - Error message: "disabled by your admin"

2. **`admin.mcp.enabled`** (boolean, default true):
   - If `false`, **disables all MCP servers**
   - Clears MCP config and stubs `/mcp` command

3. **`admin.extensions.enabled`** (boolean, default true):
   - Defined in schema but **NOT implemented yet** (reserved for future)

The `admin` settings use **REPLACE merge strategy** (system overrides user settings).

## LLxprt File Existence Map

**VERIFIED paths:**
- `packages/cli/src/config/settingsSchema.ts` - EXISTS, add admin settings schema
- `packages/cli/src/config/config.ts` - EXISTS, add enforcement logic for secureModeEnabled and mcpEnabled
- `packages/core/src/config/config.ts` - EXISTS, add mcpEnabled field and getter
- `packages/cli/src/services/BuiltinCommandLoader.ts` - EXISTS, add conditional MCP stub
- `packages/cli/src/config/config.test.ts` - EXISTS, add admin settings test suites
- `packages/cli/src/services/BuiltinCommandLoader.test.ts` - EXISTS, add getMcpEnabled mock

**Actions required:**
1. MODIFY: `packages/cli/src/config/settingsSchema.ts` (add admin settings)
2. MODIFY: `packages/core/src/config/config.ts` (add mcpEnabled field)
3. MODIFY: `packages/cli/src/config/config.ts` (enforce admin settings)
4. MODIFY: `packages/cli/src/services/BuiltinCommandLoader.ts` (stub /mcp if disabled)
5. ADD TESTS: `packages/cli/src/config/config.test.ts` (secureModeEnabled & mcpEnabled suites)
6. UPDATE TESTS: `packages/cli/src/services/BuiltinCommandLoader.test.ts` (add mock)
7. UPDATE DOCS: `docs/get-started/configuration.md` (add admin settings)

**Scope reduction from upstream:**
- SKIP: `GeminiCodeAssistSetting` types (don't exist in LLxprt, not needed for MVP)
- SKIP: `remoteAdminSettings` storage (future remote fetching, out of scope)
- KEEP: Admin settings schema and enforcement logic

## Files to Modify

### 1. Update Settings Schema
**File:** `packages/cli/src/config/settingsSchema.ts`

**Add new top-level `admin` object:**
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
          description: 'If false, disallows extensions from being installed or used. (Not enforced yet)',
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

### 2. Update Core Config Class
**File:** `packages/core/src/config/config.ts`

**Add to `ConfigParameters` interface:**
```typescript
mcpEnabled?: boolean;
```

**Add field to `Config` class:**
```typescript
private readonly mcpEnabled: boolean;
```

**Initialize in constructor:**
```typescript
this.mcpEnabled = params.mcpEnabled ?? true;
```

**Add getter:**
```typescript
getMcpEnabled(): boolean {
  return this.mcpEnabled;
}
```

### 3. Update CLI Config Loader
**File:** `packages/cli/src/config/config.ts`

**Enforce `secureModeEnabled` (find YOLO mode check, around line 508-520):**
```typescript
// OLD:
if (settings.security?.disableYoloMode) {
  if (approvalMode === ApprovalMode.YOLO) {
    debugLogger.error('YOLO mode is disabled by the "disableYolo" setting.');
    throw new FatalConfigError(
      'Cannot start in YOLO mode when it is disabled by settings',
    );
  }
  approvalMode = ApprovalMode.DEFAULT;
}

// NEW:
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

**Enforce `mcpEnabled` (before `return new Config()`):**
```typescript
const mcpEnabled = settings.admin?.mcp?.enabled ?? true;
```

**Update Config constructor call:**
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
  // ... rest of params ...
  disableYoloMode: settings.security?.disableYoloMode || settings.admin?.secureModeEnabled,
  // ... rest of params ...
});
```

### 4. Update Builtin Command Loader
**File:** `packages/cli/src/services/BuiltinCommandLoader.ts`

**Replace `/mcp` command conditionally (in command list):**
```typescript
// OLD:
await ideCommand(),
initCommand,
mcpCommand,
memoryCommand,

// NEW:
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

### 5. Add Config Tests
**File:** `packages/cli/src/config/config.test.ts`

**Update existing test error message (find YOLO mode test):**
```typescript
await expect(loadCliConfig(settings, 'test-session', argv)).rejects.toThrow(
  'Cannot start in YOLO mode since it is disabled by your admin',
);
```

**Add new test suite for `secureModeEnabled`:**
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

**Add new test suite for `mcpEnabled`:**
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
  });
});
```

### 6. Update Builtin Command Loader Tests
**File:** `packages/cli/src/services/BuiltinCommandLoader.test.ts`

**Add to all mock configs (find mockConfig objects):**
```typescript
getMcpEnabled: vi.fn().mockReturnValue(true),
```

### 7. Update Documentation
**File:** `docs/get-started/configuration.md`

**Add new section under settings:**
```markdown
#### `admin`

Settings configured by system administrators to enforce security policies. These settings use REPLACE merge strategy (system overrides user settings).

- **`admin.secureModeEnabled`** (boolean):
  - **Description:** If true, disallows YOLO mode from being used.
  - **Default:** `false`
  - **When enabled:** Users cannot use `--yolo` flag or `--approval-mode=yolo`.

- **`admin.mcp.enabled`** (boolean):
  - **Description:** If false, disallows MCP servers from being used.
  - **Default:** `true`
  - **When disabled:** All MCP configuration is ignored, `/mcp` command shows "disabled by admin".

- **`admin.extensions.enabled`** (boolean):
  - **Description:** If false, disallows extensions from being installed or used.
  - **Default:** `true`
  - **Status:** Defined but not enforced yet (reserved for future implementation).

**Example system-level configuration (`/etc/llxprt/settings.json`):**
```json
{
  "admin": {
    "secureModeEnabled": true,
    "mcp": {
      "enabled": false
    }
  }
}
```
```

## Preflight Checks

**VERIFIED:**
- Settings schema exists at packages/cli/src/config/settingsSchema.ts
- Core config exists at packages/core/src/config/config.ts
- CLI config loader exists at packages/cli/src/config/config.ts
- Builtin command loader exists at packages/cli/src/services/BuiltinCommandLoader.ts
- Test files exist for config and builtin command loader

**Dependencies:**
- None (self-contained feature)

**Verification Commands:**
```bash
npm run typecheck   # Type checking must pass
npm run lint        # Linting must pass
npm run test        # All tests must pass
```

## Implementation Steps

1. **Add admin settings schema:**
   - Edit `settingsSchema.ts`
   - Add `admin` object with 3 nested properties
   - Set `mergeStrategy: MergeStrategy.REPLACE`

2. **Update core config:**
   - Add `mcpEnabled` field, getter, constructor logic

3. **Update CLI config loader:**
   - Enforce `secureModeEnabled` in YOLO check
   - Calculate `mcpEnabled` and conditionally clear MCP config
   - Update `disableYoloMode` to consider `secureModeEnabled`

4. **Update builtin command loader:**
   - Replace `/mcp` command with stub if `getMcpEnabled() === false`

5. **Add tests:**
   - Create `secureModeEnabled` test suite (2 tests)
   - Create `mcpEnabled` test suite (3 tests)
   - Update existing YOLO test error message
   - Add mock `getMcpEnabled()` to command loader tests

6. **Update docs:**
   - Add `admin` settings section

7. **Manual testing:**
   - Set `admin.secureModeEnabled: true` → try `--yolo` → should error
   - Set `admin.mcp.enabled: false` → run `/mcp` → should show "disabled"
   - Verify system-level admin settings override user settings

8. **Verification:**
   ```bash
   npm run typecheck && npm run lint && npm run test
   ```

## Execution Notes

- **Batch group:** Admin-Settings
- **Dependencies:** None
- **Verification:** `npm run typecheck && npm run lint && npm run test`
- **Risk:** Low-medium — Policy enforcement, well-tested upstream
- **Scope reduction:** Skipped `GeminiCodeAssistSetting` types and remote fetching logic (not needed for MVP)
- **Critical gotcha:** `admin.extensions.enabled` is defined but NOT enforced. Document as "reserved for future".
- **Enterprise impact:** Foundation for remote admin settings. Future work will add server-side policy fetching.
- **Testing priority:** High — Must verify:
  - YOLO mode correctly blocked when `secureModeEnabled: true`
  - MCP disabled when `admin.mcp.enabled: false`
  - System settings override user settings (merge strategy)
  - Default behavior unchanged (all defaults allow everything)
