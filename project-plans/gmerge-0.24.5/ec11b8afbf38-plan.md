# Playbook: Add extension settings info to /extensions list

**Upstream SHA:** `ec11b8afbf38`
**Upstream Subject:** Add extension settings info to /extensions list
**Upstream Stats:** 4 files, 86 insertions

## What Upstream Does

Enhances extension listing to display configured settings with their current values. Adds `ExtensionSetting` and `ResolvedExtensionSetting` interfaces to track setting definitions and resolved values (with redaction for sensitive settings). When loading extensions, resolves all settings from the custom environment and stores them on the extension object. Updates `ExtensionsList` UI component to display settings with proper formatting. Updates extension formatting utility to include settings in output.

## LLxprt Adaptation Strategy

Direct mapping - LLxprt has identical extension system structure. Changes span:
- Core config types for extension settings interfaces
- Extension loading logic to resolve settings
- CLI UI components for display
- Extension formatting utility (may be in ExtensionLoader or separate formatter)

LLxprt uses `GeminiCLIExtension` interface (legacy upstream naming, verified at `packages/core/src/config/config.ts` line 225).

## LLxprt File Existence Map

**Core Config Files (VERIFIED):**

| Upstream File | LLxprt Path | Status | Action |
|--------------|-------------|--------|---------|
| `packages/core/src/config/config.ts` | `packages/core/src/config/config.ts` | EXISTS | Modify - Add ExtensionSetting and ResolvedExtensionSetting interfaces, update GeminiCLIExtension |

**Extension Loading Files:**

| Component | LLxprt Path | Status | Action |
|-----------|-------------|--------|---------|
| Extension loading logic | `packages/cli/src/config/extension.ts` | EXISTS | Modify - Resolve settings when loading extensions |
| Extension loader utility | Search needed | TBD | Modify - Update formatExtensionInfo if exists |

**UI Component Files:**

| Component | LLxprt Path | Status | Action |
|-----------|-------------|--------|---------|
| Extensions list component | Search for `ExtensionsList` | TBD | Modify - Display settings in UI |
| Extensions list tests | Search for test file | TBD | Modify - Test settings display |

**Dependencies verified:**
- `GeminiCLIExtension` interface exists at `packages/core/src/config/config.ts`
- Extension settings system exists at `packages/cli/src/config/extensions/extensionSettings.ts`
- `resolveEnvVarsInObject` likely exists for custom environment resolution

## Preflight Checks

```bash
# Verify core config
grep -q "interface GeminiCLIExtension" packages/core/src/config/config.ts && echo "OK: GeminiCLIExtension exists"

# Find extension loading
grep -q "loadExtension\|resolveEnvVarsInObject" packages/cli/src/config/extension.ts && echo "OK: extension loading"

# Find ExtensionsList component
find packages/cli/src/ui -name "*ExtensionsList*" -type f | head -1

# Find formatExtensionInfo
grep -rn "formatExtensionInfo" packages/cli/src --include="*.ts" --include="*.tsx" | head -5

# Verify settings infrastructure
test -f packages/cli/src/config/extensions/extensionSettings.ts && echo "OK: extensionSettings.ts"
```

## Inter-Playbook Dependencies

**Depends on:** 
- Prior extension system (no specific playbook, baseline functionality)

**Provides:**
- `ExtensionSetting` and `ResolvedExtensionSetting` type definitions in core
- `resolvedSettings` array on `GeminiCLIExtension` interface
- UI display of extension settings with values

**Used by:**
- `4c67eef0f299-plan.md` (Missing settings warning) - uses the `settings` field added here

## Files to Create/Modify

**Modify:**
1. `packages/core/src/config/config.ts` - Add ExtensionSetting and ResolvedExtensionSetting interfaces, update GeminiCLIExtension
2. `packages/cli/src/config/extension.ts` - Resolve settings when loading extensions
3. UI component file (path TBD from search) - Display settings in extension list
4. UI test file (path TBD from search) - Test settings display

## Implementation Steps

### 1. Add type definitions to config.ts

**File:** `packages/core/src/config/config.ts`

Add after the `GeminiCLIExtension` interface definition (around line 225):

```typescript
export interface ExtensionSetting {
  name: string;
  description: string;
  envVar: string;
  sensitive?: boolean;
}

export interface ResolvedExtensionSetting {
  name: string;
  envVar: string;
  value: string;
  sensitive: boolean;
}
```

Update the `GeminiCLIExtension` interface:

```typescript
export interface GeminiCLIExtension {
  name: string;
  version: string;
  isActive: boolean;
  path: string;
  installMetadata?: ExtensionInstallMetadata;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFiles: string[];
  excludeTools?: string[];
  hooks?: { [K in HookEventName]?: HookDefinition[] };
  settings?: ExtensionSetting[];              // NEW
  resolvedSettings?: ResolvedExtensionSetting[];  // NEW
}
```

Also export these types from the index if needed:
```typescript
export type { ExtensionSetting, ResolvedExtensionSetting };
```

### 2. Resolve settings in extension loading

**File:** `packages/cli/src/config/extension.ts`

Find the extension loading function (likely `loadExtension` or similar). Look for where `resolveEnvVarsInObject` is called with `customEnv`.

After resolving env vars, add settings resolution:

```typescript
// After: const config = resolveEnvVarsInObject(rawConfig, customEnv);

const resolvedSettings: ResolvedExtensionSetting[] = [];

if (config.settings) {
  for (const setting of config.settings) {
    const value = customEnv[setting.envVar];
    resolvedSettings.push({
      name: setting.name,
      envVar: setting.envVar,
      value: value === undefined
        ? '[not set]'
        : setting.sensitive
          ? '***'
          : value,
      sensitive: setting.sensitive ?? false,
    });
  }
}
```

Add to the extension object creation:

```typescript
const extension: GeminiCLIExtension = {
  name: config.name,
  version: config.version,
  isActive: true,
  path: extensionPath,
  installMetadata,
  mcpServers: config.mcpServers,
  contextFiles: resolvedContextFiles,
  excludeTools: config.excludeTools,
  hooks: config.hooks,
  settings: config.settings,           // NEW
  resolvedSettings,                    // NEW
};
```

Import the new types:
```typescript
import type { 
  GeminiCLIExtension,
  ExtensionSetting,
  ResolvedExtensionSetting,
} from '@vybestack/llxprt-code-core';
```

### 3. Update formatExtensionInfo (if exists)

**Action:** First, search for `formatExtensionInfo`:

```bash
grep -rn "formatExtensionInfo" packages/cli/src --include="*.ts"
```

If found in `packages/cli/src/config/extension.ts` or similar, update it:

```typescript
export function formatExtensionInfo(extension: GeminiCLIExtension): string {
  let output = '';
  
  // ... existing formatting for name, version, status, tools, etc.
  
  // NEW: Add settings section
  const resolvedSettings = extension.resolvedSettings;
  if (resolvedSettings && resolvedSettings.length > 0) {
    output += `\n Settings:`;
    resolvedSettings.forEach((setting) => {
      output += `\n  ${setting.name}: ${setting.value}`;
    });
  }
  
  return output;
}
```

If `formatExtensionInfo` doesn't exist, skip this step - the UI component will handle display.

### 4. Update ExtensionsList component

**Action:** First, find the component:

```bash
find packages/cli/src/ui -name "*ExtensionsList*" -type f
```

Expected location: `packages/cli/src/ui/components/views/ExtensionsList.tsx` or similar.

**File:** `packages/cli/src/ui/components/views/ExtensionsList.tsx` (or found path)

Find the extension item rendering (look for `Box` with `ext.name`, `ext.version`).

Update the outer Box to use column layout:

**Before:**
```tsx
<Box>
  <Text>{ext.name} {ext.version} - {ext.isActive ? 'active' : 'inactive'}</Text>
</Box>
```

**After:**
```tsx
<Box flexDirection="column" marginBottom={1}>
  <Text>{ext.name} {ext.version} - {ext.isActive ? 'active' : 'inactive'}</Text>
  
  {ext.resolvedSettings && ext.resolvedSettings.length > 0 && (
    <Box flexDirection="column" paddingLeft={2}>
      <Text>settings:</Text>
      {ext.resolvedSettings.map((setting) => (
        <Text key={setting.name}>
          - {setting.name}: {setting.value}
        </Text>
      ))}
    </Box>
  )}
</Box>
```

Add any necessary imports if missing:
```tsx
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
```

### 5. Add test for settings display

**Action:** Find the test file:

```bash
find packages/cli/src/ui -name "*ExtensionsList*.test.*" -type f
```

Expected location: `packages/cli/src/ui/components/views/ExtensionsList.test.tsx` or similar.

**File:** `packages/cli/src/ui/components/views/ExtensionsList.test.tsx` (or found path)

Add test case:

```typescript
it('should render resolved settings for an extension', () => {
  const extensionWithSettings: GeminiCLIExtension = {
    name: 'test-extension',
    version: '1.0.0',
    isActive: true,
    path: '/path/to/extension',
    contextFiles: [],
    resolvedSettings: [
      {
        name: 'sensitiveApiKey',
        value: '***',
        envVar: 'API_KEY',
        sensitive: true,
      },
      {
        name: 'maxTokens',
        value: '1000',
        envVar: 'MAX_TOKENS',
        sensitive: false,
      },
    ],
  };
  
  const { lastFrame } = render(
    <ExtensionsList extensions={[extensionWithSettings]} />
  );
  
  const output = lastFrame();
  
  expect(output).toContain('settings:');
  expect(output).toContain('- sensitiveApiKey: ***');
  expect(output).toContain('- maxTokens: 1000');
});
```

Add import if needed:
```typescript
import type { GeminiCLIExtension, ResolvedExtensionSetting } from '@vybestack/llxprt-code-core';
```

### 6. Verify extension config structure

**File:** Check extension config schema (if exists)

Look for `ExtensionConfig` interface in `packages/cli/src/config/extension.ts`:

```typescript
interface ExtensionConfig {
  name: string;
  version: string;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFileName?: string | string[];
  excludeTools?: string[];
  hooks?: Hooks;
  settings?: ExtensionSetting[];  // Should already exist or be added
}
```

Ensure `settings` field is present and matches the `ExtensionSetting[]` type.

## Deterministic Verification Commands

```bash
# 1. Type checking
npm run typecheck

# 2. Find and test UI components
find packages/cli/src/ui/components -name "*ExtensionsList*" -type f
npm run test -- packages/cli/src/ui/components/views/ExtensionsList

# 3. Test extension loading
npm run test -- packages/cli/src/config/extension.test.ts

# 4. Verify types compile
npm run build -- packages/core/src/config/config.ts

# 5. Test extension settings integration
npm run test -- packages/cli/src/config/extensions/

# 6. Full UI test suite
npm run test -- packages/cli/src/ui/

# 7. Visual verification (if possible)
# Run CLI in interactive mode with an extension that has settings
# Execute /extensions list
# Verify settings appear with correct values
```

## Manual Verification Steps

After implementation, test manually:

1. Create a test extension with settings defined in `llxprt-extension.json`:
```json
{
  "name": "test-ext",
  "version": "1.0.0",
  "settings": [
    {
      "name": "apiKey",
      "description": "API key for service",
      "envVar": "TEST_EXT_API_KEY",
      "sensitive": true
    },
    {
      "name": "maxRetries",
      "description": "Maximum retry attempts",
      "envVar": "TEST_EXT_MAX_RETRIES",
      "sensitive": false
    }
  ]
}
```

2. Install the extension
3. Configure settings (or leave unconfigured to see `[not set]`)
4. Run `/extensions list` in interactive CLI
5. Verify output shows:
   - `settings:` section
   - `- apiKey: ***` (if set) or `- apiKey: [not set]`
   - `- maxRetries: <value>` (if set)

## Execution Notes

- **Batch group:** Extensions (execute after ec79fe1 or baseline)
- **Dependencies:** Baseline extension system (no specific prior playbook required)
- **Risk level:** Low - purely additive, no breaking changes
- **Testing focus:**
  - Verify sensitive settings show `***` instead of actual value
  - Verify `[not set]` appears for unconfigured settings
  - Verify non-sensitive settings show actual values
  - Ensure UI formatting is readable in terminal
- **Visual change:** Extension list output now includes settings section
- **Note:** Search-based file discovery needed for exact UI component paths
