# Phase 08: Integration Wiring

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P08`

## Purpose

Wire real OAuth providers and flow factories into the credential proxy system:
1. Update `sandbox-proxy-lifecycle.ts` to pass real providers
2. Wire OAuthManager/FlowFactory into server construction
3. Ensure sandbox processes can use these handlers

---

## Prerequisites

- Phase 07 completed (handleRefreshToken implemented)
- Phase 07a verification passed

---

## Files to Modify

### 1. sandbox-proxy-lifecycle.ts

Update `createProxyServer` to wire real providers:

```typescript
/**
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P08
 */

import type { TokenStore, ProviderKeyStorage } from '@vybestack/llxprt-code-core';
import { CredentialProxyServer } from './credential-proxy-server.js';
import { RefreshCoordinator } from './refresh-coordinator.js';
// Import real flow implementations
import { AnthropicDeviceFlow } from '@vybestack/llxprt-code-core';
import { QwenDeviceFlow } from '@vybestack/llxprt-code-core';
import { CodexDeviceFlow } from '@vybestack/llxprt-code-core';

export interface SandboxProxyLifecycleOptions {
  tokenStore: TokenStore;
  providerKeyStorage: ProviderKeyStorage;
  allowedProviders?: string[];
  allowedBuckets?: string[];
  // NEW: Optional custom providers/flows for testing
  providers?: Map<string, OAuthProviderInterface>;
  flowFactories?: Map<string, () => OAuthFlowInterface>;
}

export class SandboxProxyLifecycle {
  private server: CredentialProxyServer | null = null;
  private readonly options: SandboxProxyLifecycleOptions;

  constructor(options: SandboxProxyLifecycleOptions) {
    this.options = options;
  }

  async start(): Promise<string> {
    if (this.server !== null) {
      throw new Error('Proxy already started');
    }

    // Build flow factories if not provided
    const flowFactories = this.options.flowFactories ?? this.buildDefaultFlowFactories();

    // Build providers if not provided
    const providers = this.options.providers ?? this.buildDefaultProviders(flowFactories);

    // Create RefreshCoordinator
    const refreshCoordinator = new RefreshCoordinator(
      this.options.tokenStore,
      30 * 1000, // 30s cooldown
    );

    this.server = new CredentialProxyServer({
      tokenStore: this.options.tokenStore,
      providerKeyStorage: this.options.providerKeyStorage,
      allowedProviders: this.options.allowedProviders,
      allowedBuckets: this.options.allowedBuckets,
      flowFactories,
      providers,
      refreshCoordinator,
    });

    return await this.server.start();
  }

  async stop(): Promise<void> {
    if (this.server !== null) {
      await this.server.stop();
      this.server = null;
    }
  }

  getSocketPath(): string | null {
    return this.server?.getSocketPath() ?? null;
  }

  /**
   * Builds default flow factories for known providers.
   * Each factory creates a fresh flow instance per OAuth session.
   *
   * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P08
   */
  private buildDefaultFlowFactories(): Map<string, () => OAuthFlowInterface> {
    return new Map([
      ['anthropic', () => new AnthropicDeviceFlow()],
      ['qwen', () => new QwenDeviceFlow()],
      ['codex', () => new CodexDeviceFlow()],
      // Gemini uses google-auth-library, needs special handling
      // ['gemini', () => new GeminiOAuthFlow()],
    ]);
  }

  /**
   * Builds default providers for refresh operations.
   * Providers wrap flow instances for refreshToken calls.
   *
   * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P08
   */
  private buildDefaultProviders(
    flowFactories: Map<string, () => OAuthFlowInterface>
  ): Map<string, OAuthProviderInterface> {
    const providers = new Map<string, OAuthProviderInterface>();

    for (const [name, factory] of flowFactories) {
      // Create provider that uses flow for refresh
      const flow = factory();
      providers.set(name, {
        refreshToken: async (refreshToken: string) => {
          if (typeof flow.refreshToken !== 'function') {
            throw new Error(`Provider ${name} does not support token refresh`);
          }
          return await flow.refreshToken(refreshToken);
        },
      });
    }

    return providers;
  }
}

// Interfaces
interface OAuthFlowInterface {
  initiateDeviceFlow(redirectUri?: string): Promise<DeviceCodeResponse>;
  exchangeCodeForToken?(code: string, state?: string): Promise<OAuthToken>;
  pollForToken?(deviceCode: string): Promise<OAuthToken>;
  refreshToken?(refreshToken: string): Promise<OAuthToken>;
}

interface OAuthProviderInterface {
  refreshToken(refreshToken: string): Promise<OAuthToken>;
}
```

### 2. Update CredentialProxyServer constructor

Ensure constructor initializes RefreshCoordinator with proper defaults:

```typescript
// In credential-proxy-server.ts

export class CredentialProxyServer {
  private readonly options: CredentialProxyServerOptions;
  private readonly refreshCoordinator: RefreshCoordinator;
  // ... other fields

  constructor(options: CredentialProxyServerOptions) {
    this.options = options;
    
    // Initialize RefreshCoordinator
    this.refreshCoordinator = options.refreshCoordinator ?? new RefreshCoordinator(
      options.tokenStore,
      30 * 1000, // 30s default cooldown
    );
  }
}
```

---

## Integration Tests

**Create**: `packages/cli/src/auth/proxy/__tests__/integration-wiring.spec.ts`

```typescript
/**
 * Integration tests verifying the full wiring from sandbox lifecycle
 * through credential proxy to real flow factories.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P08
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SandboxProxyLifecycle } from '../sandbox-proxy-lifecycle.js';
import { ProxySocketClient } from '@vybestack/llxprt-code-core';

describe('Integration: SandboxProxyLifecycle → CredentialProxyServer', () => {
  let lifecycle: SandboxProxyLifecycle;
  let client: ProxySocketClient;
  let backingStore: InMemoryTokenStore;
  let keyStorage: InMemoryProviderKeyStorage;

  beforeEach(async () => {
    backingStore = new InMemoryTokenStore();
    keyStorage = new InMemoryProviderKeyStorage();

    lifecycle = new SandboxProxyLifecycle({
      tokenStore: backingStore,
      providerKeyStorage: keyStorage,
      allowedProviders: ['anthropic', 'qwen'],
    });

    const socketPath = await lifecycle.start();
    client = new ProxySocketClient();
    await client.connect(socketPath);
  });

  afterEach(async () => {
    await client.close();
    await lifecycle.stop();
  });

  it('oauth_initiate uses real flow factory', async () => {
    const response = await client.request('oauth_initiate', { provider: 'anthropic' });

    expect(response.ok).toBe(true);
    expect(response.data.flow_type).toBe('pkce_redirect');
    expect(response.data.session_id).toMatch(/^[a-f0-9]{32}$/);
    // Real flow should return real Anthropic URL (not example.com)
    expect(response.data.auth_url).toContain('anthropic');
  });

  it('token operations use real backing store', async () => {
    // Save token via proxy
    await client.request('save_token', {
      provider: 'anthropic',
      token: { 
        access_token: 'integration_test_token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    // Verify in backing store
    const stored = await backingStore.getToken('anthropic');
    expect(stored?.access_token).toBe('integration_test_token');

    // Verify via proxy get
    const getResponse = await client.request('get_token', { provider: 'anthropic' });
    expect(getResponse.data.access_token).toBe('integration_test_token');
  });

  it('lifecycle stop cleans up socket', async () => {
    const socketPath = lifecycle.getSocketPath();
    expect(socketPath).not.toBeNull();

    await client.close();
    await lifecycle.stop();

    // Socket should be cleaned up
    expect(lifecycle.getSocketPath()).toBeNull();
  });
});
```

---

## Verification Commands

### Flow Factories Wired

```bash
grep -n "flowFactories\|buildDefaultFlowFactories" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
# Expected: Find wiring
```

### Providers Wired

```bash
grep -n "providers\|buildDefaultProviders" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
# Expected: Find wiring
```

### RefreshCoordinator Wired

```bash
grep -n "RefreshCoordinator" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
# Expected: Find instantiation and passing to server
```

### Real Flow Classes Imported

```bash
grep -n "AnthropicDeviceFlow\|QwenDeviceFlow\|CodexDeviceFlow" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
# Expected: Find imports
```

### Tests Pass

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/integration-wiring.spec.ts
# Expected: ALL PASS
```

---

## Success Criteria

1. [x] `SandboxProxyLifecycle` builds default flowFactories
2. [x] `SandboxProxyLifecycle` builds default providers
3. [x] `SandboxProxyLifecycle` creates RefreshCoordinator
4. [x] `CredentialProxyServer` receives all dependencies
5. [x] Real flow classes (AnthropicDeviceFlow, etc.) are used
6. [x] Integration tests pass
7. [x] oauth_initiate returns real provider URLs (not example.com)

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P08.md`
