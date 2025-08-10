# OAuth Remediation Specification

## Purpose

Fix the Qwen OAuth implementation to use OAuth as an enablement mechanism rather than an execution trigger. The `/auth` command should toggle OAuth availability per provider, while OAuth authentication should be triggered lazily only when needed and no other authentication method is available.

## Current Problem

1. `/auth` command currently triggers OAuth flow instead of enabling/disabling it
2. OAuth is not properly integrated into the authentication precedence chain
3. OpenAIProvider uses Qwen OAuth regardless of baseURL endpoint
4. No warning system when OAuth won't be used due to existing keys/env vars

## Architectural Decisions

- **Pattern**: Command-based OAuth enablement with lazy authentication
- **Technology Stack**: Existing TypeScript codebase
- **Data Flow**: Command toggles enablement → Provider checks enablement → Lazy OAuth trigger
- **Integration Points**: Auth commands, Provider authentication, Token storage

## Formal Requirements

**[REQ-001] Auth Command Toggle Behavior**
- [REQ-001.1] `/auth <provider>` toggles OAuth enablement for the specified provider
- [REQ-001.2] Command stores enablement state persistently
- [REQ-001.3] Command does NOT trigger OAuth flow immediately
- [REQ-001.4] Command shows current enablement status after toggle

**[REQ-002] Lazy OAuth Triggering**
- [REQ-002.1] Providers only trigger OAuth when they need authentication
- [REQ-002.2] OAuth is triggered only if no higher-priority auth method exists
- [REQ-002.3] OAuth trigger occurs during API call, not command execution

**[REQ-003] Authentication Precedence Chain**
- [REQ-003.1] Priority order: `/key` → `/keyfile` → `--key` → `--keyfile` → ENV_VAR → OAuth
- [REQ-003.2] Each provider respects this precedence when determining auth method
- [REQ-003.3] OAuth is only used if enabled AND no higher priority method available

**[REQ-004] OpenAI Provider Endpoint Validation**
- [REQ-004.1] OpenAIProvider only uses Qwen OAuth when baseURL matches Qwen endpoints
- [REQ-004.2] Default OpenAI endpoints should not use Qwen OAuth
- [REQ-004.3] Clear error message when OAuth enabled but endpoint mismatch

**[REQ-005] Warning System**
- [REQ-005.1] Warn when enabling OAuth but higher priority auth exists
- [REQ-005.2] Show which auth method will actually be used
- [REQ-005.3] Warn about endpoint mismatches for OpenAI provider

## Technical Environment

- **Type**: CLI Tool with UI components
- **Runtime**: Node.js 20.x with React UI
- **Dependencies**: Existing auth infrastructure, provider system
- **Storage**: File-based config for enablement state

## Data Schemas

```typescript
// OAuth enablement configuration
interface OAuthConfig {
  qwen: {
    enabled: boolean;
    lastToggled: Date;
  };
  // Future providers can extend this
}

// Provider auth status
interface AuthStatus {
  provider: string;
  method: 'key' | 'keyfile' | 'cli-key' | 'cli-keyfile' | 'env' | 'oauth' | 'none';
  source?: string; // file path, env var name, etc.
  available: boolean;
}
```

## Example Data

```typescript
// OAuth enablement toggle
const toggleExamples = {
  enable: {
    command: "/auth qwen",
    before: { qwen: { enabled: false } },
    after: { qwen: { enabled: true, lastToggled: "2024-01-15T10:00:00Z" } },
    output: "Qwen OAuth enabled. Will be used if no API key is configured."
  },
  disable: {
    command: "/auth qwen",
    before: { qwen: { enabled: true } },
    after: { qwen: { enabled: false, lastToggled: "2024-01-15T10:00:00Z" } },
    output: "Qwen OAuth disabled."
  }
};

// Authentication precedence examples
const precedenceExamples = {
  keyTakesPrecedence: {
    scenario: "User has /key set and OAuth enabled",
    config: { qwen: { enabled: true } },
    keyConfig: { openai: { key: "sk-..." } },
    expected: "key",
    warning: "OAuth enabled but API key will be used instead"
  },
  oauthUsed: {
    scenario: "OAuth enabled, no other auth",
    config: { qwen: { enabled: true } },
    keyConfig: {},
    envVars: {},
    expected: "oauth"
  }
};
```

## Constraints

- Do not modify existing OAuth flow implementation
- Preserve existing authentication methods and precedence
- Maintain backward compatibility with current auth commands
- No breaking changes to provider interfaces
- File-based config storage only (no new dependencies)

## Performance Requirements

- Auth enablement toggle: <50ms response time
- Auth precedence check: <10ms per provider
- No impact on existing authentication flows