# Implementation Plan: 518caae6 - Extract GEMINI_DIR Constant

## Summary of Upstream Changes

Upstream commit `518caae6` ("chore: Extract '.gemini' to GEMINI_DIR constant (#10540)"):
- Replaces hardcoded `.gemini` strings with `GEMINI_DIR` constant
- Touches many files across CLI, core, a2a-server, scripts

## Current State in LLxprt

### Constants Already Defined

**Location:** `packages/core/src/tools/memoryTool.ts` (lines 75-77)
```typescript
export const LLXPRT_CONFIG_DIR = '.llxprt';
// Alias for backward compatibility with gemini-cli code
export const GEMINI_DIR = LLXPRT_CONFIG_DIR;
```

These constants are already exported and available for use across the codebase.

### Actual .gemini Occurrences Analysis

Total grep hits: 106 files (includes tests, docs, plan files)
- **Non-test TypeScript files:** 32 occurrences across 10 files

#### Category 1: Variable/Property Names (NOT Config Directories)
These are NOT references to the `.gemini` directory - they are property names:
- `geminiClient` - GeminiClient instance references (11 occurrences)
- `geminiOAuthManager` - OAuth manager references (6 occurrences)
- `geminiDirectOverrides` - Configuration property (1 occurrence)
- `test.geminiChat.runtime` - Runtime ID string (1 occurrence)

**Action:** NO CHANGE NEEDED - these are legitimate property/variable names

#### Category 2: .geminiignore File References (5 occurrences)
File ignore pattern file (like .gitignore):
- `packages/core/src/utils/filesearch/ignore.ts` - reads `.geminiignore` file
- `packages/core/src/tools/ls.ts` - documentation references (3 occurrences)

**Action:** NO CHANGE NEEDED - this is a different file (`.geminiignore` not `.gemini/`)

#### Category 3: Actual Config Directory References (8 occurrences in 4 files)

**File 1: `packages/a2a-server/src/config/settings.ts` (line 18)**
```typescript
export const SETTINGS_DIRECTORY_NAME = '.gemini';
```
**Change:** Replace with LLXPRT_CONFIG_DIR constant
```typescript
import { LLXPRT_CONFIG_DIR } from '@vybestack/llxprt-code-core';
export const SETTINGS_DIRECTORY_NAME = LLXPRT_CONFIG_DIR;
```

**File 2: `packages/a2a-server/src/config/extension.ts` (line 15)**
```typescript
export const EXTENSIONS_DIRECTORY_NAME = path.join('.gemini', 'extensions');
```
**Change:** Replace with LLXPRT_CONFIG_DIR constant
```typescript
import { LLXPRT_CONFIG_DIR } from '@vybestack/llxprt-code-core';
export const EXTENSIONS_DIRECTORY_NAME = path.join(LLXPRT_CONFIG_DIR, 'extensions');
```

**File 3: `packages/core/src/code_assist/oauth-credential-storage.ts` (line 22)**
```typescript
legacyPaths.push(path.join(homeDir, '.gemini', OAUTH_FILE));
```
**Change:** Keep as-is - this is explicitly a legacy migration path
**Add comment:**
```typescript
// Legacy .gemini path for migration compatibility
legacyPaths.push(path.join(homeDir, '.gemini', OAUTH_FILE));
```

**File 4: `packages/cli/src/ui/commands/restoreCommand.ts` (line 69)**
```typescript
content: 'Could not determine the .gemini directory path.',
```
**Change:** Update error message to reflect current config directory
```typescript
content: 'Could not determine the configuration directory path.',
```

**File 5: `packages/cli/src/ui/commands/setupGithubCommand.ts` (line 57)**
```typescript
const gitignoreEntries = ['.gemini/', 'gha-creds-*.json'];
```
**Change:** This adds `.gemini/` to .gitignore for upstream compatibility
**Action:** Keep as-is OR document that we're maintaining upstream compatibility
**Add comment:**
```typescript
// Note: Using .gemini/ for upstream gemini-cli compatibility
const gitignoreEntries = ['.gemini/', 'gha-creds-*.json'];
```

## Implementation Strategy

### Option 1: Minimal Changes (RECOMMENDED)
Only update the two a2a-server files that define constants. This provides consistency in our constant definitions while maintaining backward compatibility elsewhere.

**Pros:**
- Minimal risk
- Maintains existing migration/legacy paths
- Clear separation between config dir constants and legacy compatibility

**Cons:**
- Some hardcoded strings remain (but they're intentional for compatibility)

### Option 2: Full Replacement
Replace all 5 occurrences with constants or import LLXPRT_CONFIG_DIR.

**Pros:**
- Complete consistency
- No hardcoded strings

**Cons:**
- May complicate legacy migration paths
- More files to change and test
- Error messages become less clear

## Recommended Implementation Steps

### Step 1: Update a2a-server Constants

**File:** `packages/a2a-server/src/config/settings.ts`
- Add import: `import { LLXPRT_CONFIG_DIR } from '@vybestack/llxprt-code-core';`
- Replace line 18: `export const SETTINGS_DIRECTORY_NAME = LLXPRT_CONFIG_DIR;`

**File:** `packages/a2a-server/src/config/extension.ts`
- Add import: `import { LLXPRT_CONFIG_DIR } from '@vybestack/llxprt-code-core';`
- Replace line 15: `export const EXTENSIONS_DIRECTORY_NAME = path.join(LLXPRT_CONFIG_DIR, 'extensions');`

### Step 2: Add Clarifying Comments

**File:** `packages/core/src/code_assist/oauth-credential-storage.ts` (line 22)
- Add comment before line 22:
```typescript
// Legacy .gemini path for backward compatibility during migration
legacyPaths.push(path.join(homeDir, '.gemini', OAUTH_FILE));
```

**File:** `packages/cli/src/ui/commands/setupGithubCommand.ts` (line 57)
- Add comment before line 57:
```typescript
// Using .gemini/ for upstream gemini-cli compatibility in GitHub workflows
const gitignoreEntries = ['.gemini/', 'gha-creds-*.json'];
```

### Step 3: Improve Error Message

**File:** `packages/cli/src/ui/commands/restoreCommand.ts` (line 69)
- Replace: `content: 'Could not determine the configuration directory path.',`

## Files to Modify

| File | Line | Change Type | Priority |
|------|------|-------------|----------|
| `packages/a2a-server/src/config/settings.ts` | 18 | Replace with constant | HIGH |
| `packages/a2a-server/src/config/extension.ts` | 15 | Replace with constant | HIGH |
| `packages/core/src/code_assist/oauth-credential-storage.ts` | 22 | Add comment | LOW |
| `packages/cli/src/ui/commands/setupGithubCommand.ts` | 57 | Add comment | LOW |
| `packages/cli/src/ui/commands/restoreCommand.ts` | 69 | Update error message | MEDIUM |

## Backward Compatibility

**Current approach already handles this:**
- `GEMINI_DIR` is exported as an alias to `LLXPRT_CONFIG_DIR` in memoryTool.ts
- Legacy migration path in oauth-credential-storage.ts checks both `.llxprt/` and `.gemini/`
- No breaking changes to existing user configurations

**No additional fallback logic needed.**

## Testing Strategy

1. Run full test suite to ensure no regressions
2. Verify a2a-server can load settings and extensions from `.llxprt/` directory
3. Check that legacy OAuth migration still works (test explicitly checks `.gemini` path)
4. Ensure setupGithubCommand still adds correct gitignore entries

## Acceptance Criteria

- [ ] a2a-server uses `LLXPRT_CONFIG_DIR` constant instead of hardcoded `.gemini`
- [ ] All tests pass (especially oauth-credential-storage.test.ts)
- [ ] Legacy paths remain commented and functional
- [ ] Error messages are clear and don't mention `.gemini` unnecessarily
- [ ] No regressions in configuration loading

## Notes

- This is a minimal-impact merge of upstream's constant extraction
- We maintain `.llxprt` as our primary config directory
- Legacy `.gemini` references are preserved only where needed for backward compatibility
- The bulk of grep results (92 occurrences) are property names, not directory paths
