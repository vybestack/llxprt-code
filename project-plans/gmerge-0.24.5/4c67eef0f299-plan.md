# Playbook: Inform user of missing settings on extensions update

**Upstream SHA:** `4c67eef0f299`
**Upstream Subject:** Inform user of missing settings on extensions update
**Upstream Stats:** 4 files, 357 insertions

## What Upstream Does

Removes the auto-update blocker when extension settings change and instead warns users about missing settings after update. Adds `getMissingSettings()` function to check which required settings are not configured. Updates extension install/update logic to call `getMissingSettings` and emit warnings via debugLogger and coreEvents. Adds comprehensive test suite for missing settings detection and update flow. Previously, extensions with setting changes would fail auto-update with error - now they update successfully but warn about unconfigured settings.

## LLxprt Adaptation Strategy

Direct mapping with careful testing - LLxprt has parallel extension settings system. Changes involve:
- Extension settings utilities - adding `getMissingSettings` function
- Extension install/update logic - removing settings change blocker, adding warning
- Comprehensive test suite - new test file

LLxprt has:
- `packages/cli/src/config/extensions/extensionSettings.ts` (verified via directory listing)
- `packages/cli/src/config/extension.ts` with install/update logic
- Extension settings loaded from .env files and potentially keychain
- Debug logging infrastructure

Need to check for upstream-specific dependencies:
- `coreEvents.emitFeedback` - may need to use debugLogger only if not present
- `KeychainTokenStorage` - verify LLxprt has this for sensitive settings

## LLxprt File Existence Map

**Extension Settings Files (VERIFIED):**

| Upstream File | LLxprt Path | Status | Action |
|--------------|-------------|--------|---------|
| `packages/cli/src/config/extensions/extensionSettings.ts` | `packages/cli/src/config/extensions/extensionSettings.ts` | EXISTS | Modify - Add getMissingSettings function |
| `packages/cli/src/config/extension.ts` | `packages/cli/src/config/extension.ts` | EXISTS | Modify - Remove settings blocker, add warning |
| `packages/cli/src/config/extension.test.ts` | `packages/cli/src/config/extension.test.ts` | EXISTS | Modify - Update auto-update test |
| `packages/cli/src/config/extensions/extensionUpdates.test.ts` | NEW | CREATE | Create - Comprehensive test suite |

**Dependencies to verify:**
- `getEnvContents` function in extensionSettings.ts
- `KeychainTokenStorage` for sensitive settings (search needed)
- `coreEvents.emitFeedback` or alternative (search needed)
- `debugLogger` from core

## Preflight Checks

```bash
# Verify extension settings infrastructure
test -f packages/cli/src/config/extensions/extensionSettings.ts && echo "OK: extensionSettings.ts"
grep -q "getEnvContents" packages/cli/src/config/extensions/extensionSettings.ts && echo "OK: getEnvContents exists"

# Verify extension loading
test -f packages/cli/src/config/extension.ts && echo "OK: extension.ts"
grep -q "installOrUpdateExtension\|loadExtensionConfig" packages/cli/src/config/extension.ts && echo "OK: update logic exists"

# Check for KeychainTokenStorage
grep -rn "KeychainTokenStorage" packages/cli/src packages/core/src --include="*.ts" | head -5

# Check for coreEvents
grep -rn "coreEvents\|emitFeedback" packages/core/src --include="*.ts" | head -5

# Verify debugLogger
grep -q "debugLogger" packages/core/src/index.ts && echo "OK: debugLogger exported"
```

## Inter-Playbook Dependencies

**Depends on:**
- `ec11b8afbf38-plan.md` - Adds `settings` field to extension config and `ExtensionSetting` interface

**Provides:**
- `getMissingSettings()` function for detecting unconfigured settings
- Warning system for missing settings after extension updates
- Removal of auto-update blocker for settings changes

**Breaking change:**
- Extensions with auto-update no longer fail on settings changes
- They update successfully and warn instead

## Files to Create/Modify

**Create:**
1. `packages/cli/src/config/extensions/extensionUpdates.test.ts` - Comprehensive test suite (300+ lines)

**Modify:**
2. `packages/cli/src/config/extensions/extensionSettings.ts` - Add getMissingSettings function
3. `packages/cli/src/config/extension.ts` - Remove settings blocker, add warning
4. `packages/cli/src/config/extension.test.ts` - Update auto-update test expectations

## Implementation Steps

### 1. Add getMissingSettings to extensionSettings.ts

**File:** `packages/cli/src/config/extensions/extensionSettings.ts`

Add export function at end of file:

```typescript
/**
 * Returns a list of settings that are defined but not configured.
 * Checks both .env files and keychain for sensitive settings.
 */
export async function getMissingSettings(
  extensionConfig: ExtensionConfig,
  extensionId: string,
): Promise<ExtensionSetting[]> {
  const { settings } = extensionConfig;
  
  if (!settings || settings.length === 0) {
    return [];
  }

  // Get existing settings from .env and keychain
  const existingSettings = await getEnvContents(extensionConfig, extensionId);
  const missingSettings: ExtensionSetting[] = [];

  for (const setting of settings) {
    if (existingSettings[setting.envVar] === undefined) {
      missingSettings.push(setting);
    }
  }

  return missingSettings;
}
```

Add type import if needed:
```typescript
import type { ExtensionSetting } from '@vybestack/llxprt-code-core';
```

Note: `ExtensionConfig` should already be imported/defined in this file.

### 2. Remove settings change blocker in extension.ts

**File:** `packages/cli/src/config/extension.ts`

Find the `installOrUpdateExtension` function. Look for code that compares old and new settings and throws an error for auto-update.

**Locate and REMOVE this block:**
```typescript
if (isUpdate && installMetadata.autoUpdate) {
  const oldSettings = new Set(
    previousExtensionConfig.settings?.map(s => s.name) || []
  );
  const newSettings = new Set(
    newExtensionConfig.settings?.map(s => s.name) || []
  );
  
  const settingsAreEqual = 
    oldSettings.size === newSettings.size &&
    [...oldSettings].every(s => newSettings.has(s));
  
  if (!settingsAreEqual && installMetadata.autoUpdate) {
    throw new Error(
      'Extension has settings changes and cannot be auto-updated. ' +
      'Please manually update the extension.'
    );
  }
}
```

**Delete the entire block** that checks `settingsAreEqual`.

### 3. Add missing settings warning

**File:** `packages/cli/src/config/extension.ts`

Import the new function:
```typescript
import { getMissingSettings } from './extensions/extensionSettings.js';
```

Check if `coreEvents` is available:
```bash
grep -rn "coreEvents" packages/core/src --include="*.ts" | grep "export"
```

If `coreEvents.emitFeedback` exists, import it:
```typescript
import { coreEvents } from '@vybestack/llxprt-code-core';
```

If not, use only `debugLogger` (already imported).

In `installOrUpdateExtension`, after `loadExtensionConfig` and before the actual file operations (copy/move), add:

```typescript
// After: const newExtensionConfig = await loadExtensionConfig(...);
// Before: actual file copy/install operations

const missingSettings = await getMissingSettings(
  newExtensionConfig,
  extensionId,
);

if (missingSettings.length > 0) {
  const settingNames = missingSettings.map((s) => s.name).join(', ');
  const message = 
    `Extension "${newExtensionConfig.name}" has missing settings: ${settingNames}. ` +
    `Please run "llxprt extensions settings ${newExtensionConfig.name} <setting-name>" to configure them.`;
  
  debugLogger.warn(message);
  
  // If coreEvents exists, emit feedback
  if (typeof coreEvents !== 'undefined' && coreEvents.emitFeedback) {
    coreEvents.emitFeedback('warning', message);
  }
}
```

**Note:** Replace `"llxprt extensions settings"` with the correct LLxprt command syntax.

### 4. Update existing auto-update test

**File:** `packages/cli/src/config/extension.test.ts`

Find the test that checks auto-update failure when settings change. It might be named something like:
- `"should fail auto-update if settings have changed"`
- `"should throw error when settings change during auto-update"`

**Change from:**
```typescript
it('should fail auto-update if settings have changed', async () => {
  // ... setup with old and new extension configs with different settings
  
  await expect(
    installOrUpdateExtension(installMetadata, ...)
  ).rejects.toThrow('settings changes');
});
```

**Change to:**
```typescript
it('should auto-update successfully when settings have changed', async () => {
  // ... setup with old and new extension configs with different settings
  
  const result = await installOrUpdateExtension(installMetadata, ...);
  
  // Should succeed
  expect(result).toBeDefined();
  
  // Verify version was updated
  const updatedExtension = await loadExtension(...);
  expect(updatedExtension.version).toBe('1.1.0'); // or whatever the new version is
  
  // Optionally verify warning was logged
  expect(debugLogger.warn).toHaveBeenCalledWith(
    expect.stringContaining('missing settings')
  );
});
```

### 5. Create extensionUpdates.test.ts

**File:** `packages/cli/src/config/extensions/extensionUpdates.test.ts`

Create comprehensive test suite:

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMissingSettings } from './extensionSettings.js';
import type { ExtensionSetting } from '@vybestack/llxprt-code-core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock dependencies
vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    stat: vi.fn(),
  },
  existsSync: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', () => ({
  debugLogger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  coreEvents: {
    emitFeedback: vi.fn(),
  },
  KeychainTokenStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock/home'),
}));

describe('getMissingSettings', () => {
  const mockExtensionConfig = {
    name: 'test-extension',
    version: '1.0.0',
    settings: [
      {
        name: 'apiKey',
        description: 'API key',
        envVar: 'TEST_API_KEY',
        sensitive: true,
      },
      {
        name: 'maxRetries',
        description: 'Max retries',
        envVar: 'TEST_MAX_RETRIES',
        sensitive: false,
      },
    ] as ExtensionSetting[],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when all settings are present', async () => {
    // Mock getEnvContents to return all settings
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      'TEST_API_KEY=secret\nTEST_MAX_RETRIES=3'
    );
    
    const missing = await getMissingSettings(mockExtensionConfig, 'test-ext');
    
    expect(missing).toEqual([]);
  });

  it('should identify missing non-sensitive settings', async () => {
    // Mock getEnvContents to return only apiKey
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      'TEST_API_KEY=secret'
    );
    
    const missing = await getMissingSettings(mockExtensionConfig, 'test-ext');
    
    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe('maxRetries');
  });

  it('should identify missing sensitive settings', async () => {
    // Mock getEnvContents to return only maxRetries
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      'TEST_MAX_RETRIES=3'
    );
    
    // Mock keychain to return empty
    const missing = await getMissingSettings(mockExtensionConfig, 'test-ext');
    
    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe('apiKey');
    expect(missing[0].sensitive).toBe(true);
  });

  it('should return empty array when extension has no settings', async () => {
    const configWithoutSettings = {
      name: 'test-extension',
      version: '1.0.0',
    };
    
    const missing = await getMissingSettings(configWithoutSettings, 'test-ext');
    
    expect(missing).toEqual([]);
  });

  it('should handle both workspace and user settings', async () => {
    // Test that settings from both scopes are checked
    // Mock file reads for both workspace and user .env files
    vi.mocked(fs.existsSync).mockImplementation((path) => {
      // Simulate workspace .env exists
      return path.toString().includes('.llxprt');
    });
    
    const missing = await getMissingSettings(mockExtensionConfig, 'test-ext');
    
    // Verify both scopes were checked
    expect(fs.promises.readFile).toHaveBeenCalled();
  });
});

describe('Extension update with missing settings', () => {
  it('should warn when extension has missing settings after update', async () => {
    // This test would require mocking installOrUpdateExtension
    // and verifying debugLogger.warn and coreEvents.emitFeedback are called
    
    // Setup: extension v1.0 with no settings → v1.1 with new setting
    // Expected: update succeeds, warning emitted
    
    // Mock implementation details:
    // - loadExtensionConfig returns config with settings
    // - getMissingSettings returns one missing setting
    // - Verify debugLogger.warn called with correct message
  });

  it('should include setting names in warning message', async () => {
    // Verify warning message format includes all missing setting names
  });

  it('should suggest correct command to configure settings', async () => {
    // Verify warning includes "llxprt extensions settings <name> <setting>"
  });
});
```

**Note:** The test file structure above is a template. Adapt based on actual extension loading patterns in LLxprt.

### 6. Setup test mocks properly

In the test file, ensure:

1. **KeychainTokenStorage mock** - uses in-memory store:
```typescript
const mockKeychain = new Map<string, string>();

vi.mock('@vybestack/llxprt-code-core', () => ({
  KeychainTokenStorage: vi.fn().mockImplementation(() => ({
    get: (key: string) => Promise.resolve(mockKeychain.get(key)),
    set: (key: string, value: string) => {
      mockKeychain.set(key, value);
      return Promise.resolve();
    },
  })),
}));
```

2. **Extension directory mocking** - return temp paths to avoid real I/O

3. **fs.promises mocking** - intercept reads/writes

### 7. Verify coreEvents integration

**Action:** Check if coreEvents.emitFeedback exists:

```bash
grep -rn "emitFeedback" packages/core/src --include="*.ts"
```

If NOT found, update step 3 to use only `debugLogger.warn`.

If found, verify the signature:
```typescript
coreEvents.emitFeedback(type: 'warning' | 'info' | 'error', message: string)
```

## Deterministic Verification Commands

```bash
# 1. Type checking
npm run typecheck

# 2. Test getMissingSettings function
npm run test -- packages/cli/src/config/extensions/extensionSettings.test.ts

# 3. Test extension updates (comprehensive suite)
npm run test -- packages/cli/src/config/extensions/extensionUpdates.test.ts

# 4. Test extension loading (updated test)
npm run test -- packages/cli/src/config/extension.test.ts

# 5. All extension tests
npm run test -- packages/cli/src/config/extension
npm run test -- packages/cli/src/config/extensions/

# 6. Full CLI test suite
npm run test -- packages/cli/

# 7. Integration verification
# Manually test with real extension update that adds settings
```

## Manual Verification Steps

1. **Setup:** Create extension v1.0 with no settings:
```json
{
  "name": "test-ext",
  "version": "1.0.0"
}
```

2. **Install:** Install the extension using CLI

3. **Update config:** Change to v1.1 with new setting:
```json
{
  "name": "test-ext",
  "version": "1.1.0",
  "settings": [
    {
      "name": "apiKey",
      "description": "API key for service",
      "envVar": "TEST_EXT_API_KEY",
      "sensitive": true
    }
  ]
}
```

4. **Update:** Run update command (with auto-update enabled)

5. **Verify:**
   - Update succeeds (no error thrown)
   - Warning appears in output: "Extension has missing settings: apiKey"
   - Suggestion to run settings command appears
   - Extension version is updated to 1.1.0

## Execution Notes

- **Batch group:** Extensions (execute after ec11b8a)
- **Dependencies:** `ec11b8afbf38-plan.md` (adds settings display)
- **Risk level:** Medium - changes auto-update behavior (breaking change)
- **Testing focus:**
  - Comprehensive test suite is critical (300+ lines)
  - Test both sensitive and non-sensitive settings
  - Test workspace vs user scope
  - Verify warning messages are helpful and actionable
- **Breaking change:** Extensions no longer fail auto-update on settings changes
- **User experience:** Users now see warnings instead of errors, must configure settings manually
- **Note:** May need to adapt test structure based on actual LLxprt extension loading patterns
