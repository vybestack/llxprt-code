# Feature Implementation Plan: Extension Settings

**Feature:** Extension Settings with Keychain Storage  
**Branch:** `20260126gmerge` (continuation)  
**Prerequisites:** None (builds on existing extension architecture)  
**Estimated Complexity:** Medium  
**Upstream References:** `750c0e366`, `7e987113a`, `c13ec85d7d`

---

## Overview

Add support for extension-defined settings that are prompted during install/update:
- **Plain text settings** - stored in `.env` file in extension storage
- **Sensitive settings** - stored in OS keychain with user-friendly service names
- **Manifest compatibility** - support both `gemini.json` and `llxprt.json`

---

## START HERE (If you were told to "DO this plan")

### Step 1: Check current state
```bash
git branch --show-current  # Should be 20260126gmerge
git status                 # Should be clean
```

### Step 2: Create/check todo list
Call `todo_read()`. If empty or this feature not present, call `todo_write()` with todos below.

### Step 3: Execute using subagents
- **For implementation:** Use `typescriptexpert` subagent
- **For review:** Use `reviewer` subagent

---

## Todo List

```javascript
todo_write({
  todos: [
    // Phase 1: Schema & Types (TDD)
    { id: "EXT-SETTINGS-1-test", content: "Write tests for ExtensionSettingSchema", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-1-impl", content: "Implement ExtensionSettingSchema", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-1-review", content: "Review Phase 1 (qualitative)", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-1-commit", content: "Commit Phase 1", status: "pending", priority: "high" },

    // Phase 2: Storage Layer (TDD)
    { id: "EXT-SETTINGS-2-test", content: "Write tests for settings storage", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-2-impl", content: "Implement settings storage", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-2-review", content: "Review Phase 2 (qualitative)", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-2-commit", content: "Commit Phase 2", status: "pending", priority: "high" },

    // Phase 3: Prompt UI (TDD)
    { id: "EXT-SETTINGS-3-test", content: "Write tests for maybePromptForSettings", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-3-impl", content: "Implement maybePromptForSettings", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-3-review", content: "Review Phase 3 (qualitative)", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-3-commit", content: "Commit Phase 3", status: "pending", priority: "high" },

    // Phase 4: Integration (TDD)
    { id: "EXT-SETTINGS-4-test", content: "Write integration tests", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-4-impl", content: "Integrate into extension lifecycle", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-4-review", content: "Review Phase 4 (qualitative)", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-4-commit", content: "Commit Phase 4", status: "pending", priority: "high" },

    // Phase 5: Keychain Naming (upstream c13ec85d7d)
    { id: "EXT-SETTINGS-5-test", content: "Write tests for keychain naming", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-5-impl", content: "Implement user-friendly keychain names", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-5-review", content: "Review Phase 5 (qualitative)", status: "pending", priority: "high" },
    { id: "EXT-SETTINGS-5-commit", content: "Commit Phase 5", status: "pending", priority: "high" }
  ]
})
```

---

## Phase 1: Schema & Types

### Files to create
- `packages/cli/src/config/extensions/extensionSettings.ts`
- `packages/cli/src/config/extensions/extensionSettings.test.ts`

### Test cases (write FIRST)
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
    expect(() => ExtensionSettingSchema.parse({ envVar: 'X' })).toThrow();
  });

  it('should reject setting without envVar', () => {
    expect(() => ExtensionSettingSchema.parse({ name: 'x' })).toThrow();
  });

  it('should default sensitive to false', () => {
    const parsed = ExtensionSettingSchema.parse({ name: 'x', envVar: 'X' });
    expect(parsed.sensitive).toBe(false);
  });
});
```

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 1 QUALITATIVE REVIEW for Extension Settings - Schema & Types.

YOU MUST ACTUALLY READ THE CODE.

PART 1: MECHANICAL CHECKS
npm run lint && npm run typecheck && npm run test -- extensionSettings

PART 2: TEST QUALITY ANALYSIS
Read extensionSettings.test.ts:

Questions:
- Are all Zod validation paths tested?
- Is there a test for invalid types (number instead of string)?
- Is there a test for extra properties (should be stripped or error)?
- Are empty strings tested? (name: '', envVar: '')

PART 3: SCHEMA ANALYSIS
Read extensionSettings.ts:

Questions:
- Is the schema using Zod correctly?
- Is `sensitive` defaulting to false via .default(false)?
- Are types DERIVED from the schema? (z.infer<typeof ...>)
- Is there an array schema for multiple settings?
- Are the field descriptions helpful for LLM/IDE?

Example of what to look for:
```typescript
// GOOD - types derived from schema
export const ExtensionSettingSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  envVar: z.string().min(1),
  sensitive: z.boolean().default(false),
});
export type ExtensionSetting = z.infer<typeof ExtensionSettingSchema>;

// BAD - manually defined types that could drift
interface ExtensionSetting {
  name: string;
  // ...
}
```

PART 4: COMPATIBILITY CHECK
- Does the schema match upstream's extension manifest format?
- Will this parse settings from gemini-cli extensions correctly?
- Will this parse settings from llxprt extensions correctly?

PART 5: EDGE CASES
Manually trace what happens with these inputs:
1. { name: 'API Key', envVar: 'API_KEY', sensitive: true } - valid
2. { name: '', envVar: 'X' } - should fail (empty name)
3. { name: 'x', envVar: '' } - should fail (empty envVar)
4. { name: 'x', envVar: 'X', extra: 'field' } - should strip extra
5. { name: 123, envVar: 'X' } - should fail (wrong type)

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { ... },
  "qualitative": {
    "test_quality": {
      "verdict": "PASS/FAIL",
      "validation_paths_covered": true/false,
      "type_errors_tested": true/false,
      "edge_cases_tested": ["list"],
      "issues": []
    },
    "schema_quality": {
      "verdict": "PASS/FAIL",
      "zod_usage_correct": true/false,
      "types_derived": true/false,
      "array_schema_exists": true/false,
      "descriptions_helpful": true/false,
      "issues": []
    },
    "compatibility": {
      "verdict": "PASS/FAIL",
      "matches_upstream": true/false,
      "gemini_extensions_parseable": true/false,
      "llxprt_extensions_parseable": true/false
    },
    "edge_case_trace": {
      "case_1": "PASS/FAIL",
      "case_2": "PASS/FAIL",
      "case_3": "PASS/FAIL",
      "case_4": "PASS/FAIL",
      "case_5": "PASS/FAIL"
    }
  },
  "issues_requiring_remediation": []
}
```

---

## Phase 2: Storage Layer

### Files to create/modify
- `packages/cli/src/config/extensions/settingsStorage.ts`
- `packages/cli/src/config/extensions/settingsStorage.test.ts`

### Test cases (write FIRST)
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
      const envContent = fs.readFileSync(envPath, 'utf-8');
      expect(envContent).toContain('API_URL=https://api.example.com');
    });

    it('should save sensitive settings to keychain', async () => {
      const settings = [{ name: 'apiKey', envVar: 'API_KEY', sensitive: true }];
      const values = { API_KEY: 'secret123' };
      await saveSettings('my-ext', settings, values);
      // Verify keychain was called (mock or integration test)
    });

    it('should NOT save sensitive settings to env file', async () => {
      const settings = [{ name: 'apiKey', envVar: 'API_KEY', sensitive: true }];
      const values = { API_KEY: 'secret123' };
      await saveSettings('my-ext', settings, values);
      const envContent = fs.readFileSync(envPath, 'utf-8');
      expect(envContent).not.toContain('secret123');
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

    it('should return null for missing settings', async () => {
      const values = await loadSettings('my-ext', settings);
      expect(values.MISSING_KEY).toBeUndefined();
    });
  });
});
```

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 2 QUALITATIVE REVIEW for Extension Settings - Storage Layer.

YOU MUST ACTUALLY READ THE CODE.

PART 1: MECHANICAL CHECKS
npm run lint && npm run typecheck && npm run test -- settingsStorage

PART 2: TEST QUALITY ANALYSIS
Questions:
- Are REAL file operations tested (not just mocks)?
- Is keychain integration tested? (May need integration test)
- Is the "sensitive NOT in env file" explicitly tested?
- What about concurrent access? (Two processes saving)
- What about file corruption? (Partial write)

PART 3: IMPLEMENTATION ANALYSIS
Read settingsStorage.ts:

ENV FILE HANDLING:
- What format is the env file? (KEY=value, dotenv compatible?)
- Is the env file in the correct location? (extension storage dir)
- How are special characters in values handled? (quotes, newlines)
- Is there atomic write? (write to temp, then rename)

KEYCHAIN HANDLING:
- Is KeychainTokenStorage from core being used?
- What's the keychain service name format?
- How are multiple settings for one extension stored? (One entry per setting? One JSON blob?)
- What happens if keychain is locked/unavailable?

ERROR HANDLING:
- What if env file doesn't exist on load?
- What if keychain entry doesn't exist on load?
- What if write fails partway?
- Are errors logged/surfaced appropriately?

PART 4: SECURITY ANALYSIS
- Are sensitive values NEVER written to env file?
- Are sensitive values NEVER logged?
- Is the env file permissions appropriate? (not world-readable)
- Is there any risk of sensitive value leaking?

PART 5: BEHAVIORAL TRACE
Trace this scenario:
1. Extension has settings: [{ name: 'url', envVar: 'URL', sensitive: false }, { name: 'key', envVar: 'KEY', sensitive: true }]
2. User provides: { URL: 'http://example.com', KEY: 'secret' }
3. saveSettings() is called
4. Later, loadSettings() is called
5. Verify: URL comes from env file, KEY comes from keychain

Does the code actually do this correctly?

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { ... },
  "qualitative": {
    "test_quality": {
      "verdict": "PASS/FAIL",
      "real_file_ops": true/false,
      "keychain_tested": true/false,
      "sensitive_not_in_file_tested": true/false,
      "edge_cases": [],
      "issues": []
    },
    "env_file_handling": {
      "verdict": "PASS/FAIL",
      "format": "describe",
      "location": "describe",
      "special_chars": "describe",
      "atomic_write": true/false,
      "issues": []
    },
    "keychain_handling": {
      "verdict": "PASS/FAIL",
      "service_name_format": "describe",
      "storage_strategy": "per-setting/json-blob",
      "unavailable_handling": "describe",
      "issues": []
    },
    "security": {
      "verdict": "PASS/FAIL",
      "sensitive_never_in_file": true/false,
      "sensitive_never_logged": true/false,
      "file_permissions": "describe",
      "issues": []
    },
    "behavioral_trace": {
      "verdict": "PASS/FAIL",
      "save_works": true/false,
      "load_works": true/false,
      "separation_correct": true/false,
      "explanation": "..."
    }
  },
  "issues_requiring_remediation": []
}
```

---

## Phase 3: Prompt UI

### Files to create
- `packages/cli/src/config/extensions/settingsPrompt.ts`
- `packages/cli/src/config/extensions/settingsPrompt.test.ts`

### Test cases (write FIRST)
```typescript
describe('maybePromptForSettings', () => {
  it('should prompt for missing settings', async () => {
    const settings = [{ name: 'apiKey', envVar: 'API_KEY', sensitive: true }];
    const existingValues = {};
    // Mock readline/prompt
    const result = await maybePromptForSettings('my-ext', settings, existingValues);
    expect(promptWasCalled).toBe(true);
  });

  it('should skip prompt when all settings present', async () => {
    const settings = [{ name: 'apiKey', envVar: 'API_KEY', sensitive: true }];
    const existingValues = { API_KEY: 'already-set' };
    const result = await maybePromptForSettings('my-ext', settings, existingValues);
    expect(promptWasCalled).toBe(false);
    expect(result.API_KEY).toBe('already-set');
  });

  it('should handle user cancellation', async () => {
    // Mock prompt to return cancel/empty
    const result = await maybePromptForSettings('my-ext', settings, {});
    expect(result).toBeNull();
  });

  it('should show description when prompting', async () => {
    const settings = [{
      name: 'apiKey',
      description: 'Enter your API key from dashboard',
      envVar: 'API_KEY'
    }];
    await maybePromptForSettings('my-ext', settings, {});
    expect(promptMessages).toContain('Enter your API key from dashboard');
  });

  it('should mask input for sensitive settings', async () => {
    const settings = [{ name: 'apiKey', envVar: 'API_KEY', sensitive: true }];
    await maybePromptForSettings('my-ext', settings, {});
    expect(inputWasMasked).toBe(true);
  });
});
```

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 3 QUALITATIVE REVIEW for Extension Settings - Prompt UI.

YOU MUST ACTUALLY READ THE CODE.

PART 1: MECHANICAL CHECKS
npm run lint && npm run typecheck && npm run test -- settingsPrompt

PART 2: TEST QUALITY ANALYSIS
Questions:
- Is the prompt mocked appropriately for tests?
- Is user cancellation tested?
- Is input masking for sensitive values tested?
- Is partial input tested? (user fills some, cancels rest)

PART 3: IMPLEMENTATION ANALYSIS
Read settingsPrompt.ts:

PROMPT MECHANISM:
- What library is used for prompting? (readline, inquirer, etc.)
- Is it compatible with non-interactive mode? (CI/CD)
- What happens in non-interactive mode?

UX FLOW:
- What does the prompt look like to the user?
- Is the setting name shown?
- Is the description shown?
- Is it clear which settings are required vs optional?
- Is it clear which settings are sensitive?

INPUT HANDLING:
- Is sensitive input masked (show * instead of characters)?
- Is there input validation?
- What if user enters empty string?
- Can user skip optional settings?

CANCELLATION:
- How does user cancel? (Ctrl+C? Empty input? 'q'?)
- What's the return value on cancel?
- Is partial progress lost on cancel?

PART 4: NON-INTERACTIVE MODE
- What happens if stdin is not a TTY?
- Can settings be provided via environment variables?
- Can settings be provided via command line args?

PART 5: BEHAVIORAL TRACE
Trace this user flow:
1. Extension has 3 settings: url (optional), apiKey (required, sensitive), debug (optional)
2. User already has url set
3. maybePromptForSettings() is called
4. User should see prompt for apiKey only
5. Input should be masked
6. User enters value
7. User should NOT be prompted for url (already set) or debug (optional)

Does the implementation match this UX?

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { ... },
  "qualitative": {
    "test_quality": { ... },
    "prompt_mechanism": {
      "verdict": "PASS/FAIL",
      "library": "describe",
      "non_interactive_handling": "describe"
    },
    "ux_flow": {
      "verdict": "PASS/FAIL",
      "clear_to_user": true/false,
      "description_shown": true/false,
      "required_vs_optional_clear": true/false,
      "sensitive_indicated": true/false
    },
    "input_handling": {
      "verdict": "PASS/FAIL",
      "masked_for_sensitive": true/false,
      "validation": "describe",
      "empty_handling": "describe"
    },
    "cancellation": {
      "verdict": "PASS/FAIL",
      "mechanism": "describe",
      "return_value": "describe",
      "partial_lost": true/false
    },
    "behavioral_trace": {
      "verdict": "PASS/FAIL",
      "only_missing_prompted": true/false,
      "optional_skipped": true/false,
      "masked_correctly": true/false
    }
  },
  "issues_requiring_remediation": []
}
```

---

## Phase 4: Integration

### Files to modify
- `packages/cli/src/config/extension.ts` (install/update flows)
- `packages/core/src/utils/extensionLoader.ts` (env var population)

### Test cases (write FIRST)
```typescript
describe('Extension Install with Settings', () => {
  it('should prompt for settings during install', async () => {
    const extension = {
      name: 'test-ext',
      settings: [{ name: 'apiKey', envVar: 'API_KEY', sensitive: true }]
    };
    await installExtension(extension);
    expect(promptWasCalled).toBe(true);
    expect(settingsWereSaved).toBe(true);
  });

  it('should populate env vars when loading extension', async () => {
    // Setup: extension with saved settings
    const env = await getExtensionEnvironment('test-ext');
    expect(env.API_KEY).toBe('saved-value');
  });

  it('should support gemini.json manifest format', async () => {
    // Extension with gemini.json
    const config = loadExtensionConfig('/path/to/ext-with-gemini-json');
    expect(config.settings).toBeDefined();
  });

  it('should support llxprt.json manifest format', async () => {
    // Extension with llxprt.json
    const config = loadExtensionConfig('/path/to/ext-with-llxprt-json');
    expect(config.settings).toBeDefined();
  });

  it('should prefer llxprt.json over gemini.json', async () => {
    // Extension with both files
    const config = loadExtensionConfig('/path/to/ext-with-both');
    // Should have loaded llxprt.json
  });
});
```

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 4 QUALITATIVE REVIEW for Extension Settings - Integration.

YOU MUST ACTUALLY READ THE CODE.

PART 1: MECHANICAL CHECKS
npm run lint && npm run typecheck && npm run test

PART 2: INSTALL FLOW ANALYSIS
Trace the install flow:
1. User runs: llxprt extensions install <extension>
2. Extension is downloaded
3. Manifest (gemini.json or llxprt.json) is read
4. If settings defined, maybePromptForSettings() called
5. Settings saved
6. Extension marked as installed

Does each step happen? In the right order?

PART 3: UPDATE FLOW ANALYSIS
Trace the update flow:
1. User runs: llxprt extensions update <extension>
2. New version downloaded
3. New manifest read
4. If NEW settings added, prompt for those only
5. Existing settings preserved
6. Extension updated

Is this implemented correctly?

PART 4: RUNTIME FLOW ANALYSIS
Trace extension loading:
1. Extension is loaded at startup
2. Settings are read from storage
3. Env vars are populated from settings
4. Extension MCP server is started with env vars

Are env vars actually available to the extension?

PART 5: MANIFEST COMPATIBILITY
Read the manifest loading code:

Questions:
- What order are manifest files checked? (llxprt.json first, then gemini.json?)
- If both exist, which wins?
- Are settings from both formats parsed identically?
- Is there validation that settings schema is correct?

Test with actual files:
- Create test extension with gemini.json - does it work?
- Create test extension with llxprt.json - does it work?
- Create test extension with both - which is used?

PART 6: ERROR HANDLING
- What if manifest has invalid settings schema?
- What if settings prompt fails?
- What if keychain save fails during install?
- Is the extension still usable if settings fail?

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { ... },
  "qualitative": {
    "install_flow": {
      "verdict": "PASS/FAIL",
      "all_steps_present": true/false,
      "correct_order": true/false,
      "issues": []
    },
    "update_flow": {
      "verdict": "PASS/FAIL",
      "new_settings_only": true/false,
      "existing_preserved": true/false,
      "issues": []
    },
    "runtime_flow": {
      "verdict": "PASS/FAIL",
      "settings_loaded": true/false,
      "env_vars_populated": true/false,
      "available_to_extension": true/false,
      "issues": []
    },
    "manifest_compatibility": {
      "verdict": "PASS/FAIL",
      "check_order": "llxprt.json first?",
      "both_files_handled": true/false,
      "gemini_works": true/false,
      "llxprt_works": true/false,
      "issues": []
    },
    "error_handling": {
      "verdict": "PASS/FAIL",
      "invalid_schema": "describe behavior",
      "prompt_fail": "describe behavior",
      "keychain_fail": "describe behavior",
      "graceful_degradation": true/false
    }
  },
  "issues_requiring_remediation": []
}
```

---

## Phase 5: Keychain Naming (upstream c13ec85d7d)

### Test cases (write FIRST)
```typescript
describe('Keychain Service Names', () => {
  it('should use user-friendly format', () => {
    const serviceName = getKeychainServiceName('my-extension', 'ext-123');
    expect(serviceName).toBe('LLxprt Code Extensions my-extension ext-123');
  });

  it('should sanitize extension name', () => {
    const serviceName = getKeychainServiceName('My Extension!@#', 'ext-123');
    expect(serviceName).not.toContain('!');
    expect(serviceName).not.toContain('@');
    expect(serviceName).not.toContain('#');
  });

  it('should handle long extension names', () => {
    const longName = 'a'.repeat(100);
    const serviceName = getKeychainServiceName(longName, 'ext-123');
    expect(serviceName.length).toBeLessThan(256); // Keychain limit
  });
});
```

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 5 QUALITATIVE REVIEW for Extension Settings - Keychain Naming.

PART 1: MECHANICAL CHECKS
npm run lint && npm run typecheck && npm run test

PART 2: NAMING FORMAT ANALYSIS
Questions:
- What is the exact format? "LLxprt Code Extensions {name} {id}"?
- Is it consistent with upstream's format (but with LLxprt branding)?
- Will users understand what this entry is in Keychain Access?

PART 3: SANITIZATION ANALYSIS
Questions:
- What characters are removed/replaced?
- Is the sanitization safe for all OS keychains? (macOS, Windows, Linux)
- Does sanitization preserve uniqueness? (two different names don't collide)

PART 4: LENGTH HANDLING
Questions:
- What's the max service name length for keychain?
- How are long names truncated?
- Is uniqueness preserved after truncation?

PART 5: MIGRATION CONSIDERATION
If old keychain entries exist with different naming:
- Is there migration logic?
- Or are users prompted to re-enter settings?
- Is this documented?

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { ... },
  "qualitative": {
    "naming_format": {
      "verdict": "PASS/FAIL",
      "format": "describe exact format",
      "user_friendly": true/false,
      "consistent_with_upstream": true/false
    },
    "sanitization": {
      "verdict": "PASS/FAIL",
      "chars_handled": ["list"],
      "cross_platform": true/false,
      "uniqueness_preserved": true/false
    },
    "length_handling": {
      "verdict": "PASS/FAIL",
      "max_length": N,
      "truncation_method": "describe",
      "uniqueness_after_truncation": true/false
    },
    "migration": {
      "verdict": "PASS/FAIL/N-A",
      "migration_exists": true/false,
      "documented": true/false
    }
  },
  "issues_requiring_remediation": []
}
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

Extension loader should check:
1. `llxprt.json` (preferred)
2. `gemini.json` (fallback for upstream compatibility)

---

## Success Criteria

- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Qualitative review PASS for all phases
- [ ] Can install extension with settings defined
- [ ] Settings prompt appears during install
- [ ] Non-sensitive settings saved to .env file
- [ ] Sensitive settings saved to keychain with user-friendly name
- [ ] Extension can access settings via env vars at runtime
- [ ] Both gemini.json and llxprt.json manifests work
- [ ] llxprt.json preferred over gemini.json

---

## Rollback Strategy

Each phase has its own commit:
```bash
git log --oneline -10
git revert <commit-hash>
```
