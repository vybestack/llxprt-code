# Phase 03: OAuth Initiate Implementation

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P03`

## Purpose

Implement **REAL** `handleOAuthInitiate` that:
1. Uses flowFactories to create real flow instances
2. Detects flow type per provider
3. Stores flow instance in session for later exchange
4. Returns real auth URLs from providers, NOT fake `example.com`

---

## Prerequisites

- Phase 02 completed (TDD tests written)
- Phase 02a verification passed (tests fail against stub)

---

## Constructor Changes Required

### Add flowFactories to CredentialProxyServerOptions

**File**: `packages/cli/src/auth/proxy/credential-proxy-server.ts`

```typescript
// Add to CredentialProxyServerOptions interface
export interface CredentialProxyServerOptions {
  tokenStore: TokenStore;
  providerKeyStorage: ProviderKeyStorage;
  socketDir?: string;
  allowedProviders?: string[];
  allowedBuckets?: string[];
  // NEW: Required for OAuth initiation
  flowFactories?: Map<string, () => OAuthFlowInterface>;
}

// Define OAuthFlowInterface (or import from types)
interface OAuthFlowInterface {
  initiateDeviceFlow(redirectUri?: string): Promise<DeviceCodeResponse>;
  exchangeCodeForToken?(code: string, state?: string): Promise<OAuthToken>;
  pollForToken?(deviceCode: string): Promise<OAuthToken>;
  refreshToken?(refreshToken: string): Promise<OAuthToken>;
}
```

### Update Session Storage Type

```typescript
// Update the oauthSessions Map value type
private readonly oauthSessions = new Map<
  string,
  {
    provider: string;
    bucket?: string;
    complete: boolean;
    token?: OAuthToken;
    createdAt: number;
    used: boolean;
    // NEW: Required for real OAuth
    flowType: 'pkce_redirect' | 'device_code' | 'browser_redirect';
    flowInstance: OAuthFlowInterface;
    pkceState?: string;  // For PKCE flows
  }
>();
```

---

## Implementation

### handleOAuthInitiate - REAL Implementation

Replace the NOT_IMPLEMENTED stub with:

```typescript
/**
 * Handles OAuth initiation - creates real flow instance and session.
 * 
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P03
 */
private async handleOAuthInitiate(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const provider = payload.provider as string | undefined;
  const bucket = payload.bucket as string | undefined;
  const redirectUri = payload.redirect_uri as string | undefined;

  // Validate provider
  if (!provider) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
    return;
  }

  // Check provider authorization
  if (!this.isProviderAllowed(provider)) {
    this.sendError(
      socket,
      id,
      'UNAUTHORIZED',
      `Provider not allowed: ${provider}`,
    );
    return;
  }

  // Get flow factory for this provider
  const flowFactory = this.options.flowFactories?.get(provider);
  if (!flowFactory) {
    this.sendError(
      socket,
      id,
      'PROVIDER_NOT_CONFIGURED',
      `No OAuth flow factory configured for provider: ${provider}`,
    );
    return;
  }

  try {
    // Create flow instance
    const flowInstance = flowFactory();

    // Detect flow type based on provider and flow capabilities
    const flowType = this.detectFlowType(provider, flowInstance);

    // Initiate the flow - this calls the REAL provider
    const initiationResult = await flowInstance.initiateDeviceFlow(redirectUri);

    // Generate unique session ID
    const sessionId = crypto.randomBytes(16).toString('hex');

    // Store session with flow instance for later exchange
    this.oauthSessions.set(sessionId, {
      provider,
      bucket,
      complete: false,
      createdAt: Date.now(),
      used: false,
      flowType,
      flowInstance,
      // Store PKCE state for pkce_redirect flows (NOT returned to client)
      pkceState: flowType === 'pkce_redirect' ? initiationResult.device_code : undefined,
    });

    // Build response based on flow type
    const response: Record<string, unknown> = {
      flow_type: flowType,
      session_id: sessionId,
      pollIntervalMs: (initiationResult.interval ?? 5) * 1000,
    };

    // Add flow-type-specific data
    if (flowType === 'pkce_redirect' || flowType === 'browser_redirect') {
      // For redirect flows, return the complete auth URL
      response.auth_url = initiationResult.verification_uri_complete ?? initiationResult.verification_uri;
    } else if (flowType === 'device_code') {
      // For device code flows, return verification URI and user code
      response.auth_url = initiationResult.verification_uri;
      response.verification_uri = initiationResult.verification_uri;
      response.user_code = initiationResult.user_code;
      response.verification_uri_complete = initiationResult.verification_uri_complete;
    }

    // SECURITY: Do NOT return PKCE verifier, device_code internals, or flow instance
    // These stay server-side for the exchange step

    this.sendOk(socket, id, response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    this.sendError(socket, id, 'FLOW_INITIATION_FAILED', message);
  }
}

/**
 * Detects the OAuth flow type for a given provider.
 * 
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P03
 */
private detectFlowType(
  provider: string,
  flowInstance: OAuthFlowInterface,
): 'pkce_redirect' | 'device_code' | 'browser_redirect' {
  // Provider-specific flow type detection
  switch (provider.toLowerCase()) {
    case 'anthropic':
      // Anthropic uses PKCE redirect flow
      return 'pkce_redirect';

    case 'qwen':
      // Qwen uses device code flow
      return 'device_code';

    case 'codex':
      // Codex uses browser redirect with local callback
      return 'browser_redirect';

    case 'gemini':
      // Gemini uses PKCE redirect
      return 'pkce_redirect';

    default:
      // Check if flow instance has specific capabilities
      if ('pollForToken' in flowInstance && typeof flowInstance.pollForToken === 'function') {
        return 'device_code';
      }
      // Default to pkce_redirect for unknown providers with exchange capability
      return 'pkce_redirect';
  }
}
```

---

## Semantic Implementation Requirements

The implementation MUST have these behaviors:

1. **MUST use flowFactories** to get flow factory for provider
2. **MUST call initiateDeviceFlow()** on the flow instance
3. **MUST store flowInstance** in session for later exchange
4. **MUST detect flow type** (pkce_redirect, device_code, browser_redirect)
5. **MUST NOT return** code_verifier, flowInstance, or pkceState

Verify:
```bash
grep -n "flowFactories.get\|initiateDeviceFlow\|oauthSessions.set" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: All patterns found in handleOAuthInitiate
```

---

## Real Provider Call Verification

The implementation MUST call `flowInstance.initiateDeviceFlow()`:

```bash
grep -n "initiateDeviceFlow" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: Find the call inside handleOAuthInitiate
```

---

## Security Requirements

### MUST NOT return to client:
- `code_verifier` / `pkce_verifier`
- `device_code` (internal tracking)
- `flowInstance`
- `pkceState`

### MUST return to client:
- `session_id`
- `flow_type`
- `auth_url`
- `user_code` (for device_code flows only)
- `pollIntervalMs`

---

## Tests Should Now Pass

After implementation:

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
# Expected: ALL PASS
```

---

## Verification Commands

### No fake patterns

```bash
grep -n "example.com" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -i initiate
# Expected: 0 matches
```

### Real flow factory usage

```bash
grep -n "flowFactories\|flowFactory" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: Multiple matches in handleOAuthInitiate
```

### Session stores flow instance

```bash
grep -n "flowInstance" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: Found in session storage
```

### Semantic behavior check

```bash
# Verify all required method calls are present
grep -c "flowFactories.get\|flowFactory()\|initiateDeviceFlow\|oauthSessions.set" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: 3+
```

---

## Success Criteria

1. [x] `handleOAuthInitiate` calls `flowFactory()` to create flow instance
2. [x] `handleOAuthInitiate` calls `flowInstance.initiateDeviceFlow()`
3. [x] Session stores `flowInstance` and `flowType`
4. [x] Response includes `flow_type`, `session_id`, `auth_url`
5. [x] Response does NOT include `code_verifier`, `flowInstance`, `pkceState`
6. [x] All required semantic behaviors present
7. [x] All Phase 02 tests now PASS
8. [x] No fake patterns (`example.com`, `test_`)

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P03.md`

```markdown
Phase: P03
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/cli/src/auth/proxy/credential-proxy-server.ts

Changes:
- Added flowFactories to CredentialProxyServerOptions
- Implemented handleOAuthInitiate with all required behaviors
- Added detectFlowType helper
- Updated session storage to include flowInstance

Key Implementation Lines:
- Line XX: flowFactory()
- Line YY: flowInstance.initiateDeviceFlow()
- Line ZZ: this.oauthSessions.set(sessionId, { ... flowInstance ... })

Verification:
- Semantic behaviors: All required method calls present
- Tests: All Phase 02 tests PASS
- Fake patterns: 0 matches
- Flow factory usage: Present
```
