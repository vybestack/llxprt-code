# Playbook: Unified Secrets Sanitization & Environment Redaction

**Upstream SHA:** `3b1dbcd42d8f7243f884a4ba99c46f32bc5e90b0`
**Upstream Subject:** Implemented unified secrets sanitization and env. redaction options
**Upstream Stats:** 18 files, 780 insertions

## What Upstream Does

Introduces a comprehensive **environment variable sanitization system** to prevent accidental leakage of secrets when executing tools (shell commands, hooks, MCP servers). The system:

1. **Creates `environmentSanitization.ts`** with pattern-based redaction:
   - Blocks env vars by name (`TOKEN`, `SECRET`, `PASSWORD`, `KEY`, `AUTH`, etc.)
   - Blocks by value pattern (private keys, API tokens, URLs with credentials)
   - Maintains allowlists (`PATH`, `HOME`, `LLXPRT_CLI_*`, GitHub Actions vars)
   - Supports custom allowed/blocked lists via settings

2. **Adds settings schema:**
   - `security.environmentVariableRedaction.enabled` (boolean, default false)
   - `security.environmentVariableRedaction.allowed` (array of var names)
   - `security.environmentVariableRedaction.blocked` (array of var names)

3. **Integrates sanitization:**
   - `Config` class stores `sanitizationConfig`
   - `hookRunner.ts` sanitizes env before spawning hooks
   - MCP transport creation passes sanitization config
   - Shell execution service uses sanitization

4. **Documents the feature** in configuration docs

## LLxprt File Existence Map

**VERIFIED paths:**
- `packages/core/src/hooks/hookRunner.ts` (EXISTS, needs sanitization integration)
- `packages/core/src/config/config.ts` (EXISTS, needs sanitizationConfig field)
- `packages/cli/src/config/config.ts` (EXISTS, needs to pass settings to core config)
- `packages/cli/src/config/settingsSchema.ts` (EXISTS, needs security settings)
- `packages/core/src/services/environmentSanitization.ts` (NEEDS CREATION)

**Actions required:**
1. CREATE: `packages/core/src/services/environmentSanitization.ts` (309 lines of implementation + tests)
2. MODIFY: `packages/core/src/config/config.ts` (add sanitizationConfig)
3. MODIFY: `packages/cli/src/config/config.ts` (pass settings to core)
4. MODIFY: `packages/cli/src/config/settingsSchema.ts` (add security settings)
5. MODIFY: `packages/core/src/hooks/hookRunner.ts` (sanitize env)
6. MODIFY: `packages/core/src/hooks/hookRunner.test.ts` (add mock config)
7. MODIFY: `packages/core/src/core/coreToolScheduler.test.ts` (add mock config)
8. MODIFY: `packages/cli/src/ui/AppContainer.tsx` (pass sanitizationConfig to shell tool)
9. UPDATE: `docs/get-started/configuration.md` (add env redaction section)

## LLxprt Adaptations

**Replace branding:**
- `GEMINI_CLI_*` → `LLXPRT_CLI_*`
- `GEMINI_API_KEY` → `LLXPRT_API_KEY`
- `GEMINI_PROJECT_DIR` → `LLXPRT_PROJECT_DIR`
- `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`

## Files to Create/Modify

### 1. Create Environment Sanitization Module
**File:** `packages/core/src/services/environmentSanitization.ts`

**Content:** (Implement 309-line module based on upstream commit `3b1dbcd42d8f`; adapt all branding references)
```typescript
// Full implementation including:
// - ALWAYS_ALLOWED_ENVIRONMENT_VARIABLES (23 safe vars)
// - NEVER_ALLOWED_ENVIRONMENT_VARIABLES (4 specific blocklist)
// - NEVER_ALLOWED_NAME_PATTERNS (10 regex patterns for var names)
// - NEVER_ALLOWED_VALUE_PATTERNS (15+ regex for secrets in values)
// - sanitizeEnvironment(env, config) main function
// - Full test suite (8 describe blocks, 20+ test cases)
```

**Key changes from upstream:**
- Replace `GEMINI_CLI_` with `LLXPRT_CLI_` in allowlist
- Update JSDoc to mention LLxprt instead of Gemini CLI

### 2. Update Core Config Class
**File:** `packages/core/src/config/config.ts`

**Add to `ConfigParameters` interface:**
```typescript
allowedEnvironmentVariables?: string[];
blockedEnvironmentVariables?: string[];
enableEnvironmentVariableRedaction?: boolean;
```

**Add fields to `Config` class:**
```typescript
private allowedEnvironmentVariables: string[];
private blockedEnvironmentVariables: string[];
private readonly enableEnvironmentVariableRedaction: boolean;
```

**Add getter:**
```typescript
get sanitizationConfig(): EnvironmentSanitizationConfig {
  return {
    allowedEnvironmentVariables: this.allowedEnvironmentVariables,
    blockedEnvironmentVariables: this.blockedEnvironmentVariables,
    enableEnvironmentVariableRedaction: this.enableEnvironmentVariableRedaction,
  };
}
```

**Initialize in constructor:**
```typescript
this.allowedEnvironmentVariables = params.allowedEnvironmentVariables ?? [];
this.blockedEnvironmentVariables = params.blockedEnvironmentVariables ?? [];
this.enableEnvironmentVariableRedaction = params.enableEnvironmentVariableRedaction ?? false;
```

**Update `shellExecutionConfig`:**
```typescript
get shellExecutionConfig(): ShellExecutionConfig {
  return {
    // ... existing fields
    sanitizationConfig: this.sanitizationConfig,
  };
}
```

### 3. Update CLI Config Loader
**File:** `packages/cli/src/config/config.ts`

**In `loadCliConfig()` function:**
```typescript
return new Config({
  // ... existing params
  allowedEnvironmentVariables: settings.security?.environmentVariableRedaction?.allowed,
  blockedEnvironmentVariables: settings.security?.environmentVariableRedaction?.blocked,
  enableEnvironmentVariableRedaction: settings.security?.environmentVariableRedaction?.enabled ?? false,
  // ... rest of params
});
```

### 4. Update Settings Schema
**File:** `packages/cli/src/config/settingsSchema.ts`

**Add under `security` object:**
```typescript
security: {
  type: 'object',
  properties: {
    // ... existing security settings
    environmentVariableRedaction: {
      type: 'object',
      label: 'Environment Variable Redaction',
      category: 'Security',
      default: {},
      description: 'Configure environment variable sanitization for shell commands, hooks, and MCP servers.',
      properties: {
        allowed: {
          type: 'array',
          label: 'Allowed Variables',
          category: 'Security',
          default: [],
          items: { type: 'string' },
          description: 'Environment variables to allow in addition to the default allowlist.',
        },
        blocked: {
          type: 'array',
          label: 'Blocked Variables',
          category: 'Security',
          default: [],
          items: { type: 'string' },
          description: 'Environment variables to block in addition to the default blocklist.',
        },
        enabled: {
          type: 'boolean',
          label: 'Enable Redaction',
          category: 'Security',
          default: false,
          description: 'Enable environment variable redaction (disabled by default).',
        },
      },
    },
  },
}
```

### 5. Integrate into Hook Runner
**File:** `packages/core/src/hooks/hookRunner.ts`

**Add import:**
```typescript
import { sanitizeEnvironment } from '../services/environmentSanitization.js';
```

**Update spawn env (around line 242):**
```typescript
const env = {
  ...sanitizeEnvironment(process.env, this.config.sanitizationConfig),
  LLXPRT_PROJECT_DIR: input.cwd,
  CLAUDE_PROJECT_DIR: input.cwd, // Backwards compatibility
};
```

### 6. Update Hook Runner Tests
**File:** `packages/core/src/hooks/hookRunner.test.ts`

**Add to mock config:**
```typescript
mockConfig = {
  isTrustedFolder: vi.fn().mockReturnValue(true),
  sanitizationConfig: {
    enableEnvironmentVariableRedaction: true,
    allowedEnvironmentVariables: [],
    blockedEnvironmentVariables: [],
  },
} as unknown as Config;
```

### 7. Update Core Tool Scheduler Tests
**File:** `packages/core/src/core/coreToolScheduler.test.ts`

**Add to mock `getShellExecutionConfig()` returns:**
```typescript
mockConfig.getShellExecutionConfig.mockReturnValue({
  // ... existing fields
  sanitizationConfig: {
    enableEnvironmentVariableRedaction: false,
    allowedEnvironmentVariables: [],
    blockedEnvironmentVariables: [],
  },
});
```

### 8. Update UI Shell Config
**File:** `packages/cli/src/ui/AppContainer.tsx`

**Pass sanitizationConfig to shell tool (if ShellTool config exists):**
```typescript
sanitizationConfig: config.sanitizationConfig,
```

### 9. Update Documentation
**File:** `docs/get-started/configuration.md`

**Add new section under security settings:**
```markdown
#### Environment Variable Redaction

LLxprt can sanitize environment variables passed to hooks, shell commands, and MCP servers to prevent accidental secret leakage.

**Configuration:**
```json
{
  "security": {
    "environmentVariableRedaction": {
      "enabled": true,
      "allowed": ["CUSTOM_VAR"],
      "blocked": ["MY_SECRET"]
    }
  }
}
```

**Default Behavior:**
- Disabled by default (opt-in for security)
- When enabled, blocks variables matching patterns: `TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `AUTH`, etc.
- Always allows: `PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LLXPRT_CLI_*`, and other safe system vars
- Detects secrets in values: private keys, API tokens, URLs with credentials

**Custom Lists:**
- `allowed`: Additional variables to allow (beyond default allowlist)
- `blocked`: Additional variables to block (beyond default blocklist)

**Use Cases:**
- Prevent hooks from accessing your API keys
- Protect credentials when running untrusted project-level hooks
- Audit what environment variables are exposed to subprocesses

For the complete default allowlist and blocklist patterns, see [environmentSanitization.ts](../../packages/core/src/services/environmentSanitization.ts).
```

## Preflight Checks

**VERIFIED:**
- [OK] Hook runner exists and can be modified
- [OK] Config class exists and can be extended
- [OK] Settings schema exists and can be extended
- [OK] CLI config loader exists and can be modified

**Dependencies:**
- None (self-contained feature)

**Verification Commands:**
```bash
npm run typecheck   # Must pass
npm run lint        # Must pass
npm run test        # All tests must pass (including new sanitization tests)
```

## Implementation Steps

1. **Create sanitization module:**
   - Copy `environmentSanitization.ts` from upstream (309 lines)
   - Replace `GEMINI_CLI_*` with `LLXPRT_CLI_*`
   - Place in `packages/core/src/services/`
   - Run tests: `npm test environmentSanitization`

2. **Update Config class:**
   - Add 3 new fields to `ConfigParameters` and `Config` class
   - Add `sanitizationConfig` getter
   - Update constructor initialization
   - Update `shellExecutionConfig` to include it

3. **Update settings schema:**
   - Add `security.environmentVariableRedaction` object with 3 properties
   - Verify schema generates correctly

4. **Update CLI config loader:**
   - Map settings to config parameters in `loadCliConfig()`

5. **Integrate into hook runner:**
   - Import and call `sanitizeEnvironment(process.env, config.sanitizationConfig)`
   - Update tests to include mock `sanitizationConfig`

6. **Update test files:**
   - Add `sanitizationConfig` to all mock configs
   - Ensure tests pass

7. **Update documentation:**
   - Add environment variable redaction section to docs

8. **Manual testing:**
   - Set `GITHUB_TOKEN=ghp_xxx` and run a shell command
   - Verify token is redacted when `enabled: true`
   - Verify allowed vars like `PATH` still work

9. **Verification:**
   ```bash
   npm run typecheck && npm run lint && npm run test
   ```

## Execution Notes

- **Batch group:** Secrets-Sanitization
- **Dependencies:** None
- **Verification:** `npm run typecheck && npm run lint && npm run test`
- **Risk:** Low-medium — Could break shell commands if sanitization too aggressive, but well-tested upstream
- **Critical gotcha:** Default is `enabled: false` — users must opt-in. Document this clearly.
- **Testing priority:** High — Must verify that:
  - Legitimate env vars (PATH, HOME) are NOT redacted
  - Secrets (API keys, tokens) ARE redacted when enabled
  - Disabled mode passes all vars through unchanged
