# Plan 01: Constructor Options — Add providers and flowFactories

**Spec Reference**: technical-overview.md Section 9  
**File**: `packages/cli/src/auth/proxy/credential-proxy-server.ts`  
**Prerequisite**: None (first step)

---

## Overview

The `CredentialProxyServer` constructor currently accepts only `tokenStore` and `providerKeyStorage`. Per the specification, it also needs:

1. **`providers`**: `Map<string, OAuthProvider>` — for refresh token operations
2. **`flowFactories`**: `Map<string, () => OAuthFlow>` — for creating fresh flow instances per login session

These are required because:
- Refresh operations need to call `provider.refreshToken(currentToken)`
- Login operations need fresh flow instances (each session needs its own PKCE state)

---

## Requirements Trace

| Requirement | Source | Description |
|-------------|--------|-------------|
| REQ-01.1 | Spec §9 | Constructor receives `providers` map for refresh |
| REQ-01.2 | Spec §9 | Constructor receives `flowFactories` map for login |
| REQ-01.3 | Spec §8 | Each session gets its own flow instance to avoid shared PKCE state |

---

## Current State

```typescript
// packages/cli/src/auth/proxy/credential-proxy-server.ts (lines 38-44)
export interface CredentialProxyServerOptions {
  tokenStore: TokenStore;
  providerKeyStorage: ProviderKeyStorage;
  socketDir?: string;
  allowedProviders?: string[];
  allowedBuckets?: string[];
}
```

---

## Target State

```typescript
import type { OAuthProvider } from '../oauth-manager.js';

/**
 * Factory function that creates a fresh flow instance for a login session.
 * Each session gets its own instance to avoid shared PKCE state.
 */
export type OAuthFlowFactory = () => OAuthFlowInstance;

/**
 * Minimal interface for OAuth flow instances used by the proxy.
 * Each provider's device flow class implements this.
 */
export interface OAuthFlowInstance {
  /**
   * Provider-specific initiation. Returns flow-specific data.
   * For PKCE flows: auth_url
   * For device flows: verification_uri, user_code, device_code
   */
  // Methods vary by flow type — see plan 03 for details
}

export interface CredentialProxyServerOptions {
  tokenStore: TokenStore;
  providerKeyStorage: ProviderKeyStorage;
  socketDir?: string;
  allowedProviders?: string[];
  allowedBuckets?: string[];
  
  /**
   * Map of provider name to OAuthProvider instance.
   * Used for refresh operations (provider.refreshToken()).
   * 
   * Example: Map([['anthropic', anthropicProvider], ['qwen', qwenProvider]])
   */
  providers?: Map<string, OAuthProvider>;
  
  /**
   * Map of provider name to factory function that creates fresh flow instances.
   * Used for login operations — each session gets its own instance.
   * 
   * Example: Map([['anthropic', () => new AnthropicDeviceFlow()]])
   */
  flowFactories?: Map<string, OAuthFlowFactory>;
}
```

---

## Behavioral Test Scenarios

### Scenario 1: Constructor accepts providers map

```gherkin
@given the server is created with a providers map containing anthropic and qwen
@when a refresh_token operation is received for anthropic
@then the server uses the anthropic provider from the map to refresh
```

**Test Code**:
```typescript
describe('CredentialProxyServer constructor with providers', () => {
  it('stores providers map for refresh operations', async () => {
    const mockAnthropicProvider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(),
      getToken: vi.fn(),
      refreshToken: vi.fn().mockResolvedValue({
        access_token: 'refreshed_anthropic_token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'new_refresh_token',
      }),
    };

    const providers = new Map<string, OAuthProvider>([
      ['anthropic', mockAnthropicProvider],
    ]);

    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: createMockProviderKeyStorage(),
      providers,
    });

    // Start server, connect client, request refresh
    const socketPath = await server.start();
    // ... client connection and refresh_token request
    
    expect(mockAnthropicProvider.refreshToken).toHaveBeenCalled();
  });
});
```

### Scenario 2: Constructor accepts flowFactories map

```gherkin
@given the server is created with a flowFactories map
@when an oauth_initiate operation is received
@then the server calls the factory to create a fresh flow instance
```

**Test Code**:
```typescript
describe('CredentialProxyServer constructor with flowFactories', () => {
  it('creates fresh flow instance per session', async () => {
    const mockFlowInstance = {
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'test_verifier',
        verification_uri_complete: 'https://auth.example.com/authorize?...',
        expires_in: 1800,
        interval: 5,
      }),
    };
    
    const factoryFn = vi.fn().mockReturnValue(mockFlowInstance);
    
    const flowFactories = new Map<string, OAuthFlowFactory>([
      ['anthropic', factoryFn],
    ]);

    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: createMockProviderKeyStorage(),
      flowFactories,
    });

    // Start server, connect client, initiate two sessions
    // ... 
    
    // Factory should be called twice (once per session)
    expect(factoryFn).toHaveBeenCalledTimes(2);
  });
});
```

### Scenario 3: Graceful degradation without providers

```gherkin
@given the server is created without providers map
@when a refresh_token operation is received
@then the server returns an appropriate error (PROVIDER_NOT_CONFIGURED)
```

**Test Code**:
```typescript
describe('CredentialProxyServer without providers', () => {
  it('returns error when refresh requested without provider', async () => {
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: createMockProviderKeyStorage(),
      // No providers map
    });

    const socketPath = await server.start();
    const client = new ProxyClient(socketPath);
    await client.connect();

    const result = await client.request('refresh_token', {
      provider: 'anthropic',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PROVIDER_NOT_CONFIGURED');
  });
});
```

---

## Implementation Steps

### Step 1.1: Add types to credential-proxy-server.ts

Add the `OAuthFlowFactory` type alias and update `CredentialProxyServerOptions`:

```typescript
// At top of file, after existing imports
import type { OAuthProvider } from '../oauth-manager.js';

export type OAuthFlowFactory = () => unknown; // Generic - actual type varies by provider

export interface CredentialProxyServerOptions {
  tokenStore: TokenStore;
  providerKeyStorage: ProviderKeyStorage;
  socketDir?: string;
  allowedProviders?: string[];
  allowedBuckets?: string[];
  providers?: Map<string, OAuthProvider>;
  flowFactories?: Map<string, OAuthFlowFactory>;
}
```

### Step 1.2: Store references in class

Update the class to store the new options:

```typescript
export class CredentialProxyServer {
  private readonly options: CredentialProxyServerOptions;
  private readonly providers: Map<string, OAuthProvider>;
  private readonly flowFactories: Map<string, OAuthFlowFactory>;
  // ... existing fields

  constructor(options: CredentialProxyServerOptions) {
    this.options = options;
    this.providers = options.providers ?? new Map();
    this.flowFactories = options.flowFactories ?? new Map();
  }
}
```

### Step 1.3: Add helper methods

Add helper methods for provider/flow lookup:

```typescript
private getProvider(name: string): OAuthProvider | undefined {
  return this.providers.get(name);
}

private createFlowInstance(provider: string): unknown | undefined {
  const factory = this.flowFactories.get(provider);
  return factory ? factory() : undefined;
}
```

---

## Verification Criteria

| Criterion | Verification Method |
|-----------|---------------------|
| Options interface updated | TypeScript compilation passes |
| Constructor stores maps | Unit test checks internal state |
| Graceful degradation | Unit test with missing providers returns error |
| Backward compatible | Existing tests pass without providing new options |

---

## Dependencies

- `OAuthProvider` interface from `../oauth-manager.js`
- No new external dependencies

---

## Next Step

Proceed to **02-sandbox-wiring.md** to wire these options from `sandbox-proxy-lifecycle.ts`.
