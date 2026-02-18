# Plan 02: Sandbox Wiring — Wire providers and flowFactories from sandbox-proxy-lifecycle.ts

**Spec Reference**: technical-overview.md Section 9  
**File**: `packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts`  
**Prerequisite**: Plan 01 (Constructor Options)

---

## Overview

The `sandbox-proxy-lifecycle.ts` module creates the `CredentialProxyServer` instance. After Plan 01 adds the `providers` and `flowFactories` options to the constructor, this module must construct and pass those maps.

The wiring follows the same pattern used by `OAuthManager` registration in the codebase:
- Create provider instances with `TokenStore`
- Register them in a map
- Create factory functions that produce fresh flow instances

---

## Requirements Trace

| Requirement | Source | Description |
|-------------|--------|-------------|
| REQ-02.1 | Spec §9 | Proxy server must have access to OAuthProvider instances for refresh |
| REQ-02.2 | Spec §8 | Each login session needs a fresh flow instance |
| REQ-02.3 | Spec §6 | Refresh operations need to call provider.refreshToken() |

---

## Current State

```typescript
// packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts (lines 48-68)
export async function createAndStartProxy(
  config: SandboxProxyConfig,
): Promise<SandboxProxyHandle> {
  if (serverInstance) {
    return { stop: async () => { await stopProxy(); } };
  }

  const tokenStore = new KeyringTokenStore();
  const providerKeyStorage = getProviderKeyStorage();

  serverInstance = new CredentialProxyServer({
    tokenStore,
    providerKeyStorage,
    socketDir: config.socketPath.includes('/') ? undefined : undefined,
    allowedProviders: config.allowedProviders,
    allowedBuckets: config.allowedBuckets,
  });

  actualSocketPath = await serverInstance.start();
  // ...
}
```

---

## Target State

```typescript
import {
  getProviderKeyStorage,
  KeyringTokenStore,
  AnthropicDeviceFlow,
  CodexDeviceFlow,
  QwenDeviceFlow,
} from '@vybestack/llxprt-code-core';
import { AnthropicOAuthProvider } from '../anthropic-oauth-provider.js';
import { CodexOAuthProvider } from '../codex-oauth-provider.js';
import { QwenOAuthProvider } from '../qwen-oauth-provider.js';
import { GeminiOAuthProvider } from '../gemini-oauth-provider.js';
import { CredentialProxyServer, OAuthFlowFactory } from './credential-proxy-server.js';
import type { OAuthProvider } from '../oauth-manager.js';

export async function createAndStartProxy(
  config: SandboxProxyConfig,
): Promise<SandboxProxyHandle> {
  if (serverInstance) {
    return { stop: async () => { await stopProxy(); } };
  }

  const tokenStore = new KeyringTokenStore();
  const providerKeyStorage = getProviderKeyStorage();

  // Create OAuthProvider instances for refresh operations
  const providers = createOAuthProviders(tokenStore);
  
  // Create factory functions for login flow instances
  const flowFactories = createFlowFactories();

  serverInstance = new CredentialProxyServer({
    tokenStore,
    providerKeyStorage,
    socketDir: config.socketPath.includes('/') ? undefined : undefined,
    allowedProviders: config.allowedProviders,
    allowedBuckets: config.allowedBuckets,
    providers,
    flowFactories,
  });

  actualSocketPath = await serverInstance.start();
  // ...
}

/**
 * Creates OAuthProvider instances for all supported providers.
 * These are used by the proxy for refresh token operations.
 */
function createOAuthProviders(tokenStore: TokenStore): Map<string, OAuthProvider> {
  return new Map<string, OAuthProvider>([
    ['anthropic', new AnthropicOAuthProvider(tokenStore)],
    ['codex', new CodexOAuthProvider(tokenStore)],
    ['qwen', new QwenOAuthProvider(tokenStore)],
    ['gemini', new GeminiOAuthProvider(tokenStore)],
  ]);
}

/**
 * Creates factory functions for OAuth flow instances.
 * Each factory returns a fresh instance with its own PKCE state.
 * 
 * NOTE: These are the underlying flow classes, not OAuthProvider instances.
 * The proxy uses these directly for login operations to control the flow lifecycle.
 */
function createFlowFactories(): Map<string, OAuthFlowFactory> {
  return new Map<string, OAuthFlowFactory>([
    ['anthropic', () => new AnthropicDeviceFlow()],
    ['codex', () => new CodexDeviceFlow()],
    ['qwen', () => new QwenDeviceFlow({
      clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
      authorizationEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
      tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
      scopes: ['openid', 'profile', 'email', 'model.completion'],
    })],
    // Gemini uses OAuth2Client, handled specially in the initiate handler
    ['gemini', () => createGeminiOAuth2Client()],
  ]);
}

/**
 * Creates a configured OAuth2Client for Gemini authentication.
 * Uses the same configuration as oauth2.ts.
 */
function createGeminiOAuth2Client(): OAuth2Client {
  // Import dynamically to avoid circular dependencies
  const { OAuth2Client } = require('google-auth-library');
  return new OAuth2Client({
    clientId: '<GEMINI_OAUTH_CLIENT_ID>',
    clientSecret: '<GEMINI_OAUTH_CLIENT_SECRET>',
    redirectUri: 'https://codeassist.google.com/authcode',
  });
}
```

---

## Behavioral Test Scenarios

### Scenario 1: Providers map is passed to server

```gherkin
@given createAndStartProxy is called
@when the server is instantiated
@then providers map contains anthropic, codex, qwen, gemini
```

**Test Code**:
```typescript
describe('sandbox-proxy-lifecycle provider wiring', () => {
  it('passes providers map to CredentialProxyServer', async () => {
    // Spy on CredentialProxyServer constructor
    const constructorSpy = vi.spyOn(
      CredentialProxyServer.prototype, 
      'constructor' as never
    );
    
    const handle = await createAndStartProxy({
      socketPath: '/tmp/test.sock',
    });
    
    // Verify providers were passed
    const options = constructorSpy.mock.calls[0][0];
    expect(options.providers).toBeInstanceOf(Map);
    expect(options.providers.has('anthropic')).toBe(true);
    expect(options.providers.has('codex')).toBe(true);
    expect(options.providers.has('qwen')).toBe(true);
    expect(options.providers.has('gemini')).toBe(true);
    
    await handle.stop();
  });
});
```

### Scenario 2: Flow factories create fresh instances

```gherkin
@given flowFactories map is created
@when factory function is called twice
@then two distinct flow instances are created
```

**Test Code**:
```typescript
describe('createFlowFactories', () => {
  it('creates fresh instances on each call', () => {
    const factories = createFlowFactories();
    const anthropicFactory = factories.get('anthropic')!;
    
    const flow1 = anthropicFactory();
    const flow2 = anthropicFactory();
    
    // Different instances
    expect(flow1).not.toBe(flow2);
    
    // Both are AnthropicDeviceFlow
    expect(flow1).toBeInstanceOf(AnthropicDeviceFlow);
    expect(flow2).toBeInstanceOf(AnthropicDeviceFlow);
  });
});
```

### Scenario 3: Qwen factory uses correct config

```gherkin
@given flowFactories map is created
@when qwen factory is called
@then the flow has the correct clientId and endpoints
```

**Test Code**:
```typescript
describe('Qwen flow factory configuration', () => {
  it('configures flow with correct Qwen endpoints', () => {
    const factories = createFlowFactories();
    const qwenFactory = factories.get('qwen')!;
    
    const flow = qwenFactory() as QwenDeviceFlow;
    
    // Access private config for verification (in test only)
    const config = (flow as any).config;
    expect(config.clientId).toBe('f0304373b74a44d2b584a3fb70ca9e56');
    expect(config.authorizationEndpoint).toBe('https://chat.qwen.ai/api/v1/oauth2/device/code');
    expect(config.tokenEndpoint).toBe('https://chat.qwen.ai/api/v1/oauth2/token');
  });
});
```

---

## Implementation Steps

### Step 2.1: Add imports

```typescript
// Add to existing imports
import {
  AnthropicDeviceFlow,
  CodexDeviceFlow,
  QwenDeviceFlow,
} from '@vybestack/llxprt-code-core';
import { OAuth2Client } from 'google-auth-library';
import { AnthropicOAuthProvider } from '../anthropic-oauth-provider.js';
import { CodexOAuthProvider } from '../codex-oauth-provider.js';
import { QwenOAuthProvider } from '../qwen-oauth-provider.js';
import { GeminiOAuthProvider } from '../gemini-oauth-provider.js';
import type { OAuthProvider } from '../oauth-manager.js';
import type { OAuthFlowFactory } from './credential-proxy-server.js';
```

### Step 2.2: Add helper functions

```typescript
/**
 * Creates OAuthProvider instances for all supported providers.
 * These are used by the proxy for refresh token operations.
 */
function createOAuthProviders(tokenStore: KeyringTokenStore): Map<string, OAuthProvider> {
  return new Map<string, OAuthProvider>([
    ['anthropic', new AnthropicOAuthProvider(tokenStore)],
    ['codex', new CodexOAuthProvider(tokenStore)],
    ['qwen', new QwenOAuthProvider(tokenStore)],
    ['gemini', new GeminiOAuthProvider(tokenStore)],
  ]);
}

/**
 * Creates factory functions for OAuth flow instances.
 * Each factory returns a fresh instance with its own PKCE state.
 */
function createFlowFactories(): Map<string, OAuthFlowFactory> {
  return new Map<string, OAuthFlowFactory>([
    ['anthropic', () => new AnthropicDeviceFlow()],
    ['codex', () => new CodexDeviceFlow()],
    ['qwen', () => new QwenDeviceFlow({
      clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
      authorizationEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
      tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
      scopes: ['openid', 'profile', 'email', 'model.completion'],
    })],
    ['gemini', () => new OAuth2Client({
      clientId: '<GEMINI_OAUTH_CLIENT_ID>',
      clientSecret: '<GEMINI_OAUTH_CLIENT_SECRET>',
    })],
  ]);
}
```

### Step 2.3: Update createAndStartProxy

```typescript
export async function createAndStartProxy(
  config: SandboxProxyConfig,
): Promise<SandboxProxyHandle> {
  if (serverInstance) {
    return {
      stop: async () => {
        await stopProxy();
      },
    };
  }

  const tokenStore = new KeyringTokenStore();
  const providerKeyStorage = getProviderKeyStorage();
  
  // Create provider and flow infrastructure
  const providers = createOAuthProviders(tokenStore);
  const flowFactories = createFlowFactories();

  serverInstance = new CredentialProxyServer({
    tokenStore,
    providerKeyStorage,
    socketDir: config.socketPath.includes('/') ? undefined : undefined,
    allowedProviders: config.allowedProviders,
    allowedBuckets: config.allowedBuckets,
    providers,
    flowFactories,
  });

  actualSocketPath = await serverInstance.start();

  process.env.LLXPRT_CREDENTIAL_SOCKET = actualSocketPath;

  return {
    stop: async () => {
      await stopProxy();
    },
  };
}
```

---

## Configuration Constants

Extract provider configs to constants for maintainability:

```typescript
// Consider moving to a shared config file
const QWEN_CONFIG = {
  clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
  authorizationEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
  tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
  scopes: ['openid', 'profile', 'email', 'model.completion'],
} as const;

const GEMINI_OAUTH_CONFIG = {
  clientId: '<GEMINI_OAUTH_CLIENT_ID>',
  clientSecret: '<GEMINI_OAUTH_CLIENT_SECRET>',
} as const;
```

---

## Verification Criteria

| Criterion | Verification Method |
|-----------|---------------------|
| Providers map passed | Unit test verifies constructor receives map |
| Flow factories work | Unit test verifies factory creates instances |
| Configs correct | Unit test checks provider configurations |
| Existing tests pass | npm run test shows no regressions |

---

## Dependencies

- Plan 01 must be complete (constructor options)
- `AnthropicDeviceFlow`, `CodexDeviceFlow`, `QwenDeviceFlow` from `@vybestack/llxprt-code-core`
- `OAuth2Client` from `google-auth-library`
- Provider classes from `../xxx-oauth-provider.js`

---

## Architectural Note: Why Two Maps?

The design uses two separate maps because refresh and login have different requirements:

| Operation | Needs | Why |
|-----------|-------|-----|
| **Refresh** | `OAuthProvider` instances | `refreshToken(currentToken)` method, already handles token store interaction |
| **Login** | Flow class instances | Each session needs fresh PKCE state; providers reuse state across calls |

The `OAuthProvider` classes (e.g., `AnthropicOAuthProvider`) wrap the flow classes but maintain internal state that should be preserved across refreshes. For login, we need fresh flow instances without the provider wrapper's state accumulation.

---

## Next Step

Proceed to **03-handle-oauth-initiate.md** to implement the real OAuth initiation handler.
