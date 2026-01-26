# Feature Implementation Plan: Extension Settings

**Feature:** Extension Settings with Keychain Storage  
**Branch:** `20260126gmerge` (continuation)  
**Prerequisites:** None (builds on existing extension architecture)  
**Estimated Complexity:** Medium  
**Upstream References:** `750c0e366`, `7e987113a`, `c13ec85d7d`

---

## Overview

Add support for extension-defined settings that are prompted during install/update. Settings can be:
- **Plain text** - stored in `.env` file in extension storage
- **Sensitive** - stored in OS keychain with user-friendly service names

### Goals
1. Extensions can declare required settings in their manifest
2. Users are prompted for settings during extension install/update
3. Non-sensitive settings stored in env files
4. Sensitive settings stored in keychain
5. Support both `gemini-cli` and `llxprt` extension manifest formats

---

## START HERE (If you were told to "DO this plan")

### Step 1: Check current state
```bash
git branch --show-current  # Should be 20260126gmerge
git status                 # Should be clean
```

### Step 2: Create/check todo list
Call `todo_read()`. If empty or this feature not present, call `todo_write()` with the todo list from "Todo List" section below.

### Step 3: Find where to resume
- Look for first `pending` item starting with `EXT-SETTINGS-`
- If an item is `in_progress`, restart that item

### Step 4: Execute using subagents
- **For implementation tasks:** Use `typescriptexpert` subagent
- **For review tasks:** Use `reviewer` subagent
- Follow the doer/verifier pattern strictly

### Step 5: Commit after each phase
Each phase gets its own commit. This allows rollback if something breaks.

---

## Todo List

```javascript
todo_write({
  todos: [
    // Phase 1: Schema & Types (TDD)
    {
      id: "EXT-SETTINGS-1-test",
      content: "Write tests for ExtensionSettingSchema and types - test validation of setting definitions with name, description, envVar, sensitive flag",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-1-impl",
      content: "Implement ExtensionSettingSchema in extensionSettings.ts - Zod schema for setting definitions",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-1-review",
      content: "Review Phase 1: Schema validates correctly, types derived from Zod, lint/typecheck pass",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-1-commit",
      content: "Commit: 'feat(extensions): add extension settings schema and types'",
      status: "pending",
      priority: "high"
    },

    // Phase 2: Storage Layer (TDD)
    {
      id: "EXT-SETTINGS-2-test",
      content: "Write tests for settings storage - env file read/write for non-sensitive, keychain for sensitive, getEnvFilePath helper",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-2-impl",
      content: "Implement settings storage in ExtensionStorage - add getEnvFilePath, saveSettings, loadSettings methods",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-2-review",
      content: "Review Phase 2: Storage works for both env files and keychain, proper error handling",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-2-commit",
      content: "Commit: 'feat(extensions): add settings storage layer with keychain support'",
      status: "pending",
      priority: "high"
    },

    // Phase 3: Prompt UI (TDD)
    {
      id: "EXT-SETTINGS-3-test",
      content: "Write tests for maybePromptForSettings - should prompt when settings missing, skip when present, handle user cancel",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-3-impl",
      content: "Implement maybePromptForSettings function - prompts user for required settings during install/update",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-3-review",
      content: "Review Phase 3: Prompt flow works, respects existing values, handles cancellation gracefully",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-3-commit",
      content: "Commit: 'feat(extensions): add settings prompt during install/update'",
      status: "pending",
      priority: "high"
    },

    // Phase 4: Integration (TDD)
    {
      id: "EXT-SETTINGS-4-test",
      content: "Write integration tests - install extension with settings, verify env vars populated at runtime, test both gemini.json and llxprt.json manifests",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-4-impl",
      content: "Integrate settings into install/update flows - call maybePromptForSettings, populate env vars for extension runtime",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-4-review",
      content: "Review Phase 4: Full integration works, manifest compatibility verified, lint/typecheck/test all pass",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-4-commit",
      content: "Commit: 'feat(extensions): integrate settings into extension lifecycle'",
      status: "pending",
      priority: "high"
    },

    // Phase 5: Keychain Naming (upstream c13ec85d7d)
    {
      id: "EXT-SETTINGS-5-test",
      content: "Write tests for user-friendly keychain service names - format: 'LLxprt Code Extensions {name} {id}'",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-5-impl",
      content: "Implement user-friendly keychain service names in KeychainTokenStorage usage",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-5-review",
      content: "Review Phase 5: Keychain names are user-friendly, backward compatible",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-SETTINGS-5-commit",
      content: "Commit: 'feat(extensions): user-friendly keychain service names (upstream c13ec85d7d)'",
      status: "pending",
      priority: "high"
    }
  ]
})
```

---

## Phase Details

### Phase 1: Schema & Types

**Files to create:**
- `packages/cli/src/config/extensions/extensionSettings.ts`
- `packages/cli/src/config/extensions/extensionSettings.test.ts`

**Test cases (write these FIRST):**
```typescript
describe('ExtensionSettingSchema', () => {
  it('should validate a minimal setting definition', () => {
    const setting = { name: 'apiKey', envVar: 'MY_API_KEY' };
    expect(() => ExtensionSettingSchema.parse(setting)).not.toThrow();
  });

  it('should validate a complete setting definition', () => {
    const setting = {
      name: 'apiKey',
      description: 'Your API key',
      envVar: 'MY_API_KEY',
      sensitive: true
    };
    const parsed = ExtensionSettingSchema.parse(setting);
    expect(parsed.sensitive).toBe(true);
  });

  it('should reject setting without name', () => {
    const setting = { envVar: 'MY_API_KEY' };
    expect(() => ExtensionSettingSchema.parse(setting)).toThrow();
  });

  it('should reject setting without envVar', () => {
    const setting = { name: 'apiKey' };
    expect(() => ExtensionSettingSchema.parse(setting)).toThrow();
  });

  it('should default sensitive to false', () => {
    const setting = { name: 'apiKey', envVar: 'MY_API_KEY' };
    const parsed = ExtensionSettingSchema.parse(setting);
    expect(parsed.sensitive).toBe(false);
  });
});
```

**Implementation pattern:**
```typescript
import { z } from 'zod';

export const ExtensionSettingSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  envVar: z.string().min(1),
  sensitive: z.boolean().default(false),
});

export type ExtensionSetting = z.infer<typeof ExtensionSettingSchema>;

export const ExtensionSettingsArraySchema = z.array(ExtensionSettingSchema);
export type ExtensionSettings = z.infer<typeof ExtensionSettingsArraySchema>;
```

**Subagent prompt (typescriptexpert):**
```
Implement Phase 1 of Extension Settings for LLxprt.

TASK: Create schema and types for extension settings.

TDD REQUIREMENT: Write tests FIRST in extensionSettings.test.ts, then implement in extensionSettings.ts.

FILES TO CREATE:
- packages/cli/src/config/extensions/extensionSettings.ts
- packages/cli/src/config/extensions/extensionSettings.test.ts

SCHEMA REQUIREMENTS:
- Use Zod for schema definition
- ExtensionSetting must have: name (required), description (optional), envVar (required), sensitive (default false)
- Export both schema and inferred type
- Follow existing patterns in packages/cli/src/config/extensions/variableSchema.ts

TEST CASES (implement these first):
1. Validate minimal setting (name + envVar only)
2. Validate complete setting with all fields
3. Reject setting without name
4. Reject setting without envVar
5. Default sensitive to false

AFTER IMPLEMENTATION:
1. npm run lint
2. npm run typecheck
3. npm run test -- extensionSettings.test.ts

Report: test results and any issues.
```

**Review prompt (reviewer):**
```
Review Phase 1 of Extension Settings implementation.

VERIFICATION CHECKLIST:
1. Tests exist and were written first (check git diff order if possible)
2. All 5 test cases from spec are present
3. Zod schema correctly validates settings
4. Types are derived from schema (not manually defined)
5. npm run lint passes
6. npm run typecheck passes
7. npm run test -- extensionSettings.test.ts passes
8. No use of 'any' type
9. Follows patterns from variableSchema.ts

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "tests_present": true/false,
  "tests_pass": true/false,
  "lint_pass": true/false,
  "typecheck_pass": true/false,
  "schema_correct": true/false,
  "types_derived": true/false,
  "issues": []
}
```

---

### Phase 2: Storage Layer

**Files to modify:**
- `packages/cli/src/config/extensions/storage.ts` (or create if not exists)
- `packages/cli/src/config/extensions/storage.test.ts`

**Test cases (write FIRST):**
```typescript
describe('ExtensionSettingsStorage', () => {
  describe('getEnvFilePath', () => {
    it('should return path to .env file in extension storage', () => {
      const path = getEnvFilePath('my-extension');
      expect(path).toContain('my-extension');
      expect(path).toEndWith('.env');
    });
  });

  describe('saveSettings', () => {
    it('should save non-sensitive settings to env file', async () => {
      const settings = [{ name: 'apiUrl', envVar: 'API_URL', sensitive: false }];
      const values = { API_URL: 'https://api.example.com' };
      await saveSettings('my-ext', settings, values);
      // Verify file written
    });

    it('should save sensitive settings to keychain', async () => {
      const settings = [{ name: 'apiKey', envVar: 'API_KEY', sensitive: true }];
      const values = { API_KEY: 'secret123' };
      await saveSettings('my-ext', settings, values);
      // Verify keychain called
    });
  });

  describe('loadSettings', () => {
    it('should load non-sensitive settings from env file', async () => {
      // Setup env file
      const values = await loadSettings('my-ext', settings);
      expect(values.API_URL).toBe('https://api.example.com');
    });

    it('should load sensitive settings from keychain', async () => {
      // Setup keychain
      const values = await loadSettings('my-ext', settings);
      expect(values.API_KEY).toBe('secret123');
    });
  });
});
```

**Subagent prompt (typescriptexpert):**
```
Implement Phase 2 of Extension Settings for LLxprt.

TASK: Create storage layer for extension settings.

TDD REQUIREMENT: Write tests FIRST, then implement.

PREREQUISITES: Phase 1 must be complete (ExtensionSettingSchema exists).

FILES TO CREATE/MODIFY:
- packages/cli/src/config/extensions/storage.ts (add settings methods)
- packages/cli/src/config/extensions/storage.test.ts

STORAGE REQUIREMENTS:
1. getEnvFilePath(extensionId: string): string - returns path to .env file
2. saveSettings(extensionId, settings, values) - saves to env file or keychain
3. loadSettings(extensionId, settings) - loads from env file or keychain
4. Non-sensitive values go to .env file in extension storage directory
5. Sensitive values go to KeychainTokenStorage

KEYCHAIN SERVICE NAME FORMAT:
'LLxprt Code Extensions {extensionName} {extensionId}'

USE EXISTING:
- KeychainTokenStorage from @vybestack/llxprt-code-core
- ExtensionStorage for directory paths
- dotenv for env file parsing

TEST CASES (implement first):
1. getEnvFilePath returns correct path
2. saveSettings writes non-sensitive to env file
3. saveSettings writes sensitive to keychain
4. loadSettings reads non-sensitive from env file
5. loadSettings reads sensitive from keychain
6. Handle missing env file gracefully
7. Handle missing keychain entry gracefully

AFTER IMPLEMENTATION:
1. npm run lint
2. npm run typecheck
3. npm run test -- storage.test.ts

Report: test results and any issues.
```

---

### Phase 3: Prompt UI

**Files to create:**
- `packages/cli/src/config/extensions/settingsPrompt.ts`
- `packages/cli/src/config/extensions/settingsPrompt.test.ts`

**Test cases:**
```typescript
describe('maybePromptForSettings', () => {
  it('should prompt for missing settings', async () => {
    const settings = [{ name: 'apiKey', envVar: 'API_KEY', sensitive: true }];
    const existingValues = {};
    // Mock prompt
    const result = await maybePromptForSettings('my-ext', settings, existingValues);
    expect(result.API_KEY).toBeDefined();
  });

  it('should skip prompt when all settings present', async () => {
    const settings = [{ name: 'apiKey', envVar: 'API_KEY', sensitive: true }];
    const existingValues = { API_KEY: 'already-set' };
    const result = await maybePromptForSettings('my-ext', settings, existingValues);
    expect(result.API_KEY).toBe('already-set');
  });

  it('should handle user cancellation', async () => {
    // Mock prompt to return cancel
    const result = await maybePromptForSettings('my-ext', settings, {});
    expect(result).toBeNull();
  });

  it('should show description when prompting', async () => {
    const settings = [{
      name: 'apiKey',
      description: 'Enter your API key from dashboard',
      envVar: 'API_KEY'
    }];
    // Verify description shown in prompt
  });
});
```

---

### Phase 4: Integration

**Files to modify:**
- `packages/cli/src/config/extension.ts` (install/update flows)
- `packages/core/src/utils/extensionLoader.ts` (env var population)

**Test cases:**
```typescript
describe('Extension Install with Settings', () => {
  it('should prompt for settings during install', async () => {
    const extension = {
      name: 'test-ext',
      settings: [{ name: 'apiKey', envVar: 'API_KEY', sensitive: true }]
    };
    await installExtension(extension);
    // Verify prompt was called
    // Verify settings were saved
  });

  it('should populate env vars when loading extension', async () => {
    // Setup: extension with saved settings
    const env = await getExtensionEnvironment('test-ext');
    expect(env.API_KEY).toBe('saved-value');
  });

  it('should support gemini.json manifest format', async () => {
    // Extension with gemini.json instead of llxprt.json
    const config = loadExtensionConfig('/path/to/ext');
    expect(config.settings).toBeDefined();
  });

  it('should support llxprt.json manifest format', async () => {
    // Extension with llxprt.json
    const config = loadExtensionConfig('/path/to/ext');
    expect(config.settings).toBeDefined();
  });
});
```

---

### Phase 5: Keychain Naming (upstream c13ec85d7d)

This phase applies the user-friendly keychain naming from upstream.

**Test cases:**
```typescript
describe('Keychain Service Names', () => {
  it('should use user-friendly format for extension settings', () => {
    const serviceName = getKeychainServiceName('my-extension', 'ext-123');
    expect(serviceName).toBe('LLxprt Code Extensions my-extension ext-123');
  });

  it('should sanitize extension name for keychain', () => {
    const serviceName = getKeychainServiceName('My Extension!', 'ext-123');
    // Should handle special characters
    expect(serviceName).not.toContain('!');
  });
});
```

---

## Manifest Compatibility

LLxprt must support both manifest formats:

**gemini.json (upstream format):**
```json
{
  "name": "my-extension",
  "settings": [
    {
      "name": "apiKey",
      "description": "Your API key",
      "envVar": "MY_API_KEY",
      "sensitive": true
    }
  ]
}
```

**llxprt.json (LLxprt format):**
```json
{
  "name": "my-extension",
  "settings": [
    {
      "name": "apiKey",
      "description": "Your API key",
      "envVar": "MY_API_KEY",
      "sensitive": true
    }
  ]
}
```

The schema is identical - only the filename differs. Extension loader should check for both files in order:
1. `llxprt.json` (preferred)
2. `gemini.json` (fallback for upstream compatibility)

---

## Rollback Strategy

Each phase has its own commit. To rollback:
```bash
# Find the commit to revert
git log --oneline -10

# Revert specific phase
git revert <commit-hash>

# Or reset to before feature started
git reset --hard <commit-before-feature>
```

---

## Success Criteria

- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Build passes (`npm run build`)
- [ ] Can install extension with settings defined
- [ ] Settings prompt appears during install
- [ ] Non-sensitive settings saved to .env file
- [ ] Sensitive settings saved to keychain with user-friendly name
- [ ] Extension can access settings via env vars at runtime
- [ ] Both gemini.json and llxprt.json manifests work
