# Playbook: Unified Secrets Sanitization & Environment Redaction

**Upstream SHA:** `3b1dbcd42d8f7243f884a4ba99c46f32bc5e90b0`
**Upstream Subject:** Implemented unified secrets sanitization and env. redaction options
**Upstream Stats:** 18 files, 780 insertions

## What Upstream Does

Introduces a comprehensive **environment variable sanitization system** to prevent accidental leakage of secrets when executing tools (shell commands, hooks, MCP servers). The system:

1. **Creates `environmentSanitization.ts`** with pattern-based redaction:
   - Blocks env vars by name (`TOKEN`, `SECRET`, `PASSWORD`, `KEY`, `AUTH`, etc.)
   - Blocks by value pattern (private keys, API tokens, URLs with credentials)
   - Maintains allowlists (`PATH`, `HOME`, `GEMINI_CLI_*`, GitHub Actions vars)
   - Supports custom allowed/blocked lists via settings

2. **Adds settings schema:**
   - `security.environmentVariableRedaction.enabled` (boolean, default false)
   - `security.environmentVariableRedaction.allowed` (array of var names)
   - `security.environmentVariableRedaction.blocked` (array of var names)

3. **Integrates sanitization:**
   - `Config` class stores `sanitizationConfig`
   - `hookRunner.ts` sanitizes env before spawning hooks
   - `createTransport()` in MCP passes sanitization config
   - `shellExecutionService` (not in this diff but implied by `ShellExecutionConfig`)

4. **Documents the feature** in `docs/get-started/configuration.md` (52 lines of user-facing docs)

## LLxprt Adaptation Strategy

LLxprt **already has basic sanitization** in `packages/core/src/utils/sanitization.ts` and `packages/core/src/auth/token-sanitization.ts`, but these are limited to token detection in text. This upstream commit provides a **comprehensive environment variable redaction system** that should be adopted wholesale.

### Approach

1. **Create new file:** `packages/core/src/services/environmentSanitization.ts` (copy from upstream, 309 lines of implementation + tests)
2. **Update Config:** Add `sanitizationConfig` getter and fields to `ConfigParameters`
3. **Update settings schema:** Add the three new security settings
4. **Integrate into execution points:**
   - `hookRunner.ts`: Sanitize env before spawning hooks
   - Shell tool (if not already done)
   - MCP transport creation
5. **Update docs:** Add the environment variable redaction section to LLxprt docs

### Key Differences from Upstream

- LLxprt uses `@vybestack/llxprt-code-core` instead of `@google/gemini-cli-core`
- LLxprt has `packages/core/src/utils/sanitization.ts` already — **do not remove it**, as it's used for text sanitization (different use case)
- No A2A server in LLxprt, so skip `packages/a2a-server/` changes
- MCP integration may differ — check if `createTransport` exists in LLxprt

## Files to Create/Modify

### 1. Create New File
**File:** `packages/core/src/services/environmentSanitization.ts`
- Copy the entire implementation from upstream (lines 1-309 of the diff)
- Includes:
  - `ALWAYS_ALLOWED_ENVIRONMENT_VARIABLES` (23 safe vars)
  - `NEVER_ALLOWED_ENVIRONMENT_VARIABLES` (4 specific blocklist)
  - `NEVER_ALLOWED_NAME_PATTERNS` (10 regex patterns for var names)
  - `NEVER_ALLOWED_VALUE_PATTERNS` (15+ regex for secrets in values)
  - `sanitizeEnvironment(env, config)` main function
  - Full test suite (8 describe blocks, 20+ test cases)

### 2. Create Test File
**File:** `packages/core/src/services/environmentSanitization.test.ts`
- Already included in the file above (vitest tests inline)
- Covers all edge cases: private keys, tokens, URLs with creds, false positives, custom lists

### 3. Update Config Class
**File:** `packages/core/src/config/config.ts`
- Add to `ConfigParameters` interface:
  ```typescript
  allowedEnvironmentVariables?: string[];
  blockedEnvironmentVariables?: string[];
  enableEnvironmentVariableRedaction?: boolean;
  ```
- Add fields to `Config` class:
  ```typescript
  private allowedEnvironmentVariables: string[];
  private blockedEnvironmentVariables: string[];
  private readonly enableEnvironmentVariableRedaction: boolean;
  ```
- Add getter (around line 1081 in upstream):
  ```typescript
  get sanitizationConfig(): EnvironmentSanitizationConfig {
    return {
      allowedEnvironmentVariables: this.allowedEnvironmentVariables,
      blockedEnvironmentVariables: this.blockedEnvironmentVariables,
      enableEnvironmentVariableRedaction: this.enableEnvironmentVariableRedaction,
    };
  }
  ```
- Initialize in constructor (lines ~486-491 upstream)
- Update `shellExecutionConfig` to include `sanitizationConfig`

### 4. Update CLI Config Loader
**File:** `packages/cli/src/config/config.ts` (the CLI-specific loader)
- In `loadCliConfig()`, pass the new fields from settings:
  ```typescript
  blockedEnvironmentVariables: settings.security?.environmentVariableRedaction?.blocked,
  enableEnvironmentVariableRedaction: settings.security?.environmentVariableRedaction?.enabled,
  ```
- Also update MCP blocked servers logic (upstream lines 658-662)

### 5. Update Settings Schema
**File:** `packages/cli/src/config/settingsSchema.ts`
- Add new object under `security`:
  ```typescript
  environmentVariableRedaction: {
    type: 'object',
    label: 'Environment Variable Redaction',
    category: 'Security',
    default: {},
    properties: {
      allowed: { type: 'array', default: [], items: { type: 'string' } },
      blocked: { type: 'array', default: [], items: { type: 'string' } },
      enabled: { type: 'boolean', default: false },
    },
  }
  ```
- Update settings docs table in `docs/cli/settings.md`

### 6. Integrate into Hook Runner
**File:** `packages/core/src/hooks/hookRunner.ts`
- Import: `import { sanitizeEnvironment } from '../services/environmentSanitization.js';`
- Change line ~242 (where env is set for spawn):
  ```typescript
  const env = {
    ...sanitizeEnvironment(process.env, this.config.sanitizationConfig),
    GEMINI_PROJECT_DIR: input.cwd,
    CLAUDE_PROJECT_DIR: input.cwd, // Compat
  };
  ```

### 7. Update Hook Runner Tests
**File:** `packages/core/src/hooks/hookRunner.test.ts`
- Add `sanitizationConfig` to mock config (line ~72 upstream):
  ```typescript
  mockConfig = {
    isTrustedFolder: vi.fn().mockReturnValue(true),
    sanitizationConfig: {
      enableEnvironmentVariableRedaction: true,
    },
  } as unknown as Config;
  ```

### 8. Update Core Tool Scheduler Tests
**File:** `packages/core/src/core/coreToolScheduler.test.ts`
- Add `sanitizationConfig` to mock `getShellExecutionConfig()` returns (3 places in upstream diff)

### 9. Update MCP List Command (CLI)
**File:** `packages/cli/src/commands/mcp/list.ts` (if exists)
- Pass sanitization config to `createTransport()` (lines 62-77 upstream)
- **Check if LLxprt has this file** — if not, skip

### 10. Update Documentation
**File:** `docs/get-started/configuration.md` (or LLxprt equivalent)
- Add the "Environment variable redaction" section (52 lines, upstream lines 1187-1239)
- Documents default rules, allowlist, configuration examples

**File:** `docs/cli/settings.md`
- Update the security settings table to include the 3 new settings

### 11. Update UI (AppContainer)
**File:** `packages/cli/src/ui/AppContainer.tsx`
- Pass `sanitizationConfig` to shell tool config (line ~902 upstream):
  ```typescript
  sanitizationConfig: config.sanitizationConfig,
  ```

## Implementation Steps

1. **Create the sanitization module:**
   - Copy `environmentSanitization.ts` from upstream diff (all 309 lines)
   - Place in `packages/core/src/services/`
   - Run tests: `npm test environmentSanitization`

2. **Update Config class:**
   - Add 3 new fields to `ConfigParameters` and `Config` class
   - Add `sanitizationConfig` getter
   - Update constructor initialization
   - Update `shellExecutionConfig` to include it

3. **Update settings schema:**
   - Add `security.environmentVariableRedaction` object with 3 properties
   - Run `npm run build` to regenerate schema if auto-generated

4. **Update CLI config loader:**
   - In `loadCliConfig()`, map settings to config parameters
   - Handle `blockedEnvironmentVariables` and `enableEnvironmentVariableRedaction`

5. **Integrate into execution points:**
   - `hookRunner.ts`: Import and call `sanitizeEnvironment(process.env, config.sanitizationConfig)`
   - Update tests to include mock `sanitizationConfig`

6. **Update UI shell config:**
   - `AppContainer.tsx`: Pass `config.sanitizationConfig` to shell tool

7. **Documentation:**
   - Add the 52-line "Environment variable redaction" section to docs
   - Update settings table

8. **Verification:**
   - Run full test suite: `npm test`
   - Test manually: Set `GITHUB_TOKEN=ghp_xxx` and run a shell command — should be redacted
   - Check that allowed vars like `PATH` still work

## Execution Notes

- **Batch group:** Secrets
- **Dependencies:** None
- **Verification:** `npm run typecheck && npm run lint && npm run test`
- **Estimated magnitude:** Medium — 1 new file (309 lines), 10+ file updates, mostly additive
- **Risk:** Low-medium — could break shell commands if sanitization is too aggressive, but well-tested upstream
- **Critical gotcha:** Default is `enabled: false` — users must opt-in. Document this clearly.
- **LLxprt-specific:** Check if MCP `createTransport` exists; if not, skip that integration point
