# Plan 03: handleOAuthInitiate — Implement Real Flow Detection and Initiation

**Spec Reference**: technical-overview.md Section 8  
**File**: `packages/cli/src/auth/proxy/credential-proxy-server.ts`  
**Prerequisite**: Plans 01, 02

---

## Overview

The `handleOAuthInitiate` handler currently hardcodes `flow_type: 'browser_redirect'` for all providers. The real implementation must:

1. Look up the provider in `flowFactories`
2. Create a fresh flow instance for the session
3. Call the provider-specific initiation method
4. Return the appropriate flow type and flow-specific data
5. Store the session with flow instance for later exchange/poll

---

## Requirements Trace

| Requirement | Source | Description |
|-------------|--------|-------------|
| REQ-03.1 | Spec §8 | Each session gets fresh flow instance |
| REQ-03.2 | Spec §8 | Return `flow_type` based on provider |
| REQ-03.3 | Spec §8 | PKCE flows return `auth_url` |
| REQ-03.4 | Spec §8 | Device flows return `verification_url`, `user_code`, `pollIntervalMs` |
| REQ-03.5 | Spec §8 | Session stores flow instance for exchange |
| REQ-03.6 | Spec §8 | `device_code` (PKCE verifier) must NOT be returned to inner |

---

## Current State (Stub)

```typescript
// packages/cli/src/auth/proxy/credential-proxy-server.ts (lines 523-555)
private async handleOAuthInitiate(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const provider = payload.provider as string | undefined;
  const bucket = payload.bucket as string | undefined;
  if (!provider) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
    return;
  }
  // ... provider validation ...

  // Generate session ID and store session
  const sessionId = crypto.randomBytes(16).toString('hex');
  this.oauthSessions.set(sessionId, { provider, bucket, complete: false });

  // STUB: Use browser_redirect flow for simplicity in testing
  this.sendOk(socket, id, {
    flow_type: 'browser_redirect',
    session_id: sessionId,
    auth_url: `https://auth.example.com/oauth?provider=${provider}`,
    pollIntervalMs: 100,
  });
}
```

---

## Target State

```typescript
/**
 * Session state for OAuth flows.
 * Extended to store flow instance and flow-specific metadata.
 */
interface OAuthSession {
  sessionId: string;
  provider: string;
  bucket?: string;
  flowType: 'pkce_redirect' | 'device_code' | 'browser_redirect';
  flowInstance: unknown; // Provider-specific flow class instance
  deviceCode?: string;   // For device_code flows
  pollIntervalMs?: number;
  createdAt: number;
  used: boolean;
  result?: { token: OAuthToken } | { error: string; code: string };
}

private readonly oauthSessions = new Map<string, OAuthSession>();

private async handleOAuthInitiate(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const provider = payload.provider as string | undefined;
  const bucket = payload.bucket as string | undefined;
  
  if (!provider) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
    return;
  }
  if (!this.isProviderAllowed(provider)) {
    this.sendError(socket, id, 'UNAUTHORIZED', `Provider not allowed: ${provider}`);
    return;
  }

  // Check if flow factory exists
  const factory = this.flowFactories.get(provider);
  if (!factory) {
    this.sendError(socket, id, 'PROVIDER_NOT_CONFIGURED', `No flow factory for provider: ${provider}`);
    return;
  }

  // Create fresh flow instance for this session
  const flowInstance = factory();
  const sessionId = crypto.randomBytes(16).toString('hex');
  const createdAt = Date.now();

  try {
    // Provider-specific initiation
    const result = await this.initiateProviderFlow(provider, flowInstance);
    
    // Store session with flow instance
    const session: OAuthSession = {
      sessionId,
      provider,
      bucket,
      flowType: result.flowType,
      flowInstance,
      deviceCode: result.deviceCode,
      pollIntervalMs: result.pollIntervalMs,
      createdAt,
      used: false,
    };
    this.oauthSessions.set(sessionId, session);

    // Start background polling for device_code flows
    if (result.flowType === 'device_code') {
      void this.startDeviceCodePolling(sessionId, session);
    }

    // Return appropriate response based on flow type
    this.sendOk(socket, id, {
      flow_type: result.flowType,
      session_id: sessionId,
      auth_url: result.authUrl,
      verification_url: result.verificationUrl,
      user_code: result.userCode,
      pollIntervalMs: result.pollIntervalMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    this.sendError(socket, id, 'FLOW_INIT_FAILED', message);
  }
}

/**
 * Provider-specific flow initiation.
 * Returns flow type and flow-specific data based on provider.
 */
private async initiateProviderFlow(
  provider: string,
  flowInstance: unknown,
): Promise<{
  flowType: 'pkce_redirect' | 'device_code' | 'browser_redirect';
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
  deviceCode?: string;
  pollIntervalMs?: number;
}> {
  switch (provider) {
    case 'anthropic':
      return this.initiateAnthropicFlow(flowInstance as AnthropicDeviceFlow);
    case 'codex':
      return this.initiateCodexFlow(flowInstance as CodexDeviceFlow);
    case 'qwen':
      return this.initiateQwenFlow(flowInstance as QwenDeviceFlow);
    case 'gemini':
      return this.initiateGeminiFlow(flowInstance as OAuth2Client);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

---

## Provider-Specific Initiation Methods

### Anthropic (pkce_redirect)

```typescript
/**
 * Anthropic uses PKCE code-paste flow.
 * User visits URL, authorizes, receives code to paste.
 * 
 * SECURITY: device_code in response IS the PKCE verifier - must NOT return it
 */
private async initiateAnthropicFlow(
  flow: AnthropicDeviceFlow,
): Promise<FlowInitResult> {
  const response = await flow.initiateDeviceFlow();
  // Do NOT return device_code - it's the PKCE verifier
  return {
    flowType: 'pkce_redirect',
    authUrl: response.verification_uri_complete,
    // No userCode - uses URL directly
  };
}
```

### Codex (browser_redirect primary, device_code fallback)

```typescript
/**
 * Codex primary: browser_redirect with localhost callback server.
 * For sandbox, we may need device_code fallback.
 */
private async initiateCodexFlow(
  flow: CodexDeviceFlow,
): Promise<FlowInitResult> {
  // For sandbox, prefer device_code flow (no localhost server)
  // This is the fallback path per spec
  try {
    const response = await flow.requestDeviceCode();
    return {
      flowType: 'device_code',
      verificationUrl: 'https://auth.openai.com/deviceauth/callback',
      userCode: response.user_code,
      deviceCode: response.device_auth_id,
      pollIntervalMs: response.interval * 1000,
    };
  } catch (err) {
    // If device code fails, try browser_redirect with generated state
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = 'https://auth.openai.com/deviceauth/callback';
    const authUrl = flow.buildAuthorizationUrl(redirectUri, state);
    return {
      flowType: 'browser_redirect',
      authUrl,
    };
  }
}
```

### Qwen (device_code)

```typescript
/**
 * Qwen uses device_code flow exclusively.
 */
private async initiateQwenFlow(
  flow: QwenDeviceFlow,
): Promise<FlowInitResult> {
  const response = await flow.initiateDeviceFlow();
  return {
    flowType: 'device_code',
    verificationUrl: response.verification_uri,
    userCode: response.user_code,
    deviceCode: response.device_code,
    pollIntervalMs: response.interval ? response.interval * 1000 : 5000,
  };
}
```

### Gemini (pkce_redirect)

```typescript
/**
 * Gemini uses OAuth2Client with PKCE code-paste flow.
 * Similar to Anthropic - user gets code from Google's callback page.
 */
private async initiateGeminiFlow(
  client: OAuth2Client,
): Promise<FlowInitResult> {
  const codeVerifier = await client.generateCodeVerifierAsync();
  const state = crypto.randomBytes(32).toString('hex');
  
  const authUrl = client.generateAuthUrl({
    redirect_uri: 'https://codeassist.google.com/authcode',
    access_type: 'offline',
    scope: 'email profile openid https://www.googleapis.com/auth/cloud-platform',
    code_challenge_method: 'S256',
    code_challenge: codeVerifier.codeChallenge,
    state,
  });

  // Store codeVerifier in client for later exchange
  // OAuth2Client stores this internally after generateCodeVerifierAsync()
  
  return {
    flowType: 'pkce_redirect',
    authUrl,
  };
}
```

---

## Behavioral Test Scenarios

### Scenario 1: Anthropic returns pkce_redirect with auth_url

```gherkin
@given the server has anthropic flow factory configured
@when oauth_initiate is called with provider=anthropic
@then response has flow_type='pkce_redirect'
@and response has auth_url containing authorization parameters
@and response does NOT have user_code or verification_url
```

**Test Code**:
```typescript
describe('handleOAuthInitiate - Anthropic', () => {
  it('returns pkce_redirect flow with auth_url', async () => {
    const mockFlow = {
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'secret_pkce_verifier',
        verification_uri_complete: 'https://claude.ai/oauth/authorize?code_challenge=xxx',
        expires_in: 1800,
        interval: 5,
      }),
    };
    
    const server = createServerWithFlowFactory('anthropic', () => mockFlow);
    const client = await connectClient(server);
    
    const response = await client.request('oauth_initiate', {
      provider: 'anthropic',
    });
    
    expect(response.ok).toBe(true);
    expect(response.data.flow_type).toBe('pkce_redirect');
    expect(response.data.auth_url).toContain('claude.ai/oauth/authorize');
    expect(response.data.session_id).toMatch(/^[a-f0-9]{32}$/);
    // SECURITY: device_code (PKCE verifier) must NOT be in response
    expect(response.data.device_code).toBeUndefined();
  });
});
```

### Scenario 2: Qwen returns device_code with user_code

```gherkin
@given the server has qwen flow factory configured
@when oauth_initiate is called with provider=qwen
@then response has flow_type='device_code'
@and response has verification_url and user_code
@and response has pollIntervalMs
```

**Test Code**:
```typescript
describe('handleOAuthInitiate - Qwen', () => {
  it('returns device_code flow with verification info', async () => {
    const mockFlow = {
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'qwen_device_123',
        user_code: 'ABC-XYZ',
        verification_uri: 'https://chat.qwen.ai/oauth/device',
        expires_in: 900,
        interval: 5,
      }),
    };
    
    const server = createServerWithFlowFactory('qwen', () => mockFlow);
    const client = await connectClient(server);
    
    const response = await client.request('oauth_initiate', {
      provider: 'qwen',
    });
    
    expect(response.ok).toBe(true);
    expect(response.data.flow_type).toBe('device_code');
    expect(response.data.verification_url).toBe('https://chat.qwen.ai/oauth/device');
    expect(response.data.user_code).toBe('ABC-XYZ');
    expect(response.data.pollIntervalMs).toBe(5000);
  });
});
```

### Scenario 3: Session stores flow instance

```gherkin
@given oauth_initiate returns a session_id
@when the session is looked up
@then the session contains the flow instance for later exchange
```

**Test Code**:
```typescript
describe('handleOAuthInitiate - session storage', () => {
  it('stores flow instance in session for exchange', async () => {
    const mockFlow = {
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'verifier',
        verification_uri_complete: 'https://example.com/auth',
        expires_in: 1800,
        interval: 5,
      }),
      exchangeCodeForToken: vi.fn(),
    };
    
    const server = createServerWithFlowFactory('anthropic', () => mockFlow);
    const client = await connectClient(server);
    
    const initResponse = await client.request('oauth_initiate', {
      provider: 'anthropic',
    });
    
    // Access internal session (test-only)
    const session = server['oauthSessions'].get(initResponse.data.session_id);
    expect(session).toBeDefined();
    expect(session.flowInstance).toBe(mockFlow);
    expect(session.flowType).toBe('pkce_redirect');
    expect(session.used).toBe(false);
  });
});
```

### Scenario 4: Missing flow factory returns error

```gherkin
@given the server has no flow factory for unknown_provider
@when oauth_initiate is called with provider=unknown_provider
@then response is error with code PROVIDER_NOT_CONFIGURED
```

**Test Code**:
```typescript
describe('handleOAuthInitiate - missing factory', () => {
  it('returns PROVIDER_NOT_CONFIGURED for unknown provider', async () => {
    const server = createServerWithNoFlowFactories();
    const client = await connectClient(server);
    
    const response = await client.request('oauth_initiate', {
      provider: 'unknown_provider',
    });
    
    expect(response.ok).toBe(false);
    expect(response.code).toBe('PROVIDER_NOT_CONFIGURED');
  });
});
```

---

## Implementation Steps

### Step 3.1: Define OAuthSession interface

```typescript
interface OAuthSession {
  sessionId: string;
  provider: string;
  bucket?: string;
  flowType: 'pkce_redirect' | 'device_code' | 'browser_redirect';
  flowInstance: unknown;
  deviceCode?: string;
  pollIntervalMs?: number;
  createdAt: number;
  used: boolean;
  result?: { token: OAuthToken } | { error: string; code: string };
}

// Update session map type
private readonly oauthSessions = new Map<string, OAuthSession>();
```

### Step 3.2: Implement provider-specific initiation methods

Add the four provider methods as shown above.

### Step 3.3: Update handleOAuthInitiate

Replace the stub with the full implementation.

### Step 3.4: Add background polling for device_code flows

```typescript
private async startDeviceCodePolling(
  sessionId: string,
  session: OAuthSession,
): Promise<void> {
  // Background polling handled in oauth_poll handler
  // This method just marks the session as ready for polling
  // Actual polling loop runs when client calls oauth_poll
}
```

---

## Verification Criteria

| Criterion | Verification Method |
|-----------|---------------------|
| Anthropic returns pkce_redirect | Unit test |
| Qwen returns device_code | Unit test |
| Codex returns device_code (sandbox) | Unit test |
| Gemini returns pkce_redirect | Unit test |
| Session stores flow instance | Unit test |
| PKCE verifier not leaked | Unit test |
| Missing factory returns error | Unit test |

---

## Security Considerations

1. **PKCE Verifier Protection**: The `device_code` field in Anthropic's response IS the PKCE verifier. It must NEVER be returned in the proxy response.

2. **Session Isolation**: Each session gets its own flow instance to prevent PKCE state leakage between concurrent logins.

3. **Session Timeout**: Sessions should expire after 10 minutes (spec §8). Add cleanup timer.

---

## Next Step

Proceed to **04-handle-oauth-exchange.md** to implement the token exchange handler.
