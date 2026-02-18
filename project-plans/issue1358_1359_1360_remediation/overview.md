# OAuth/Refresh Integration Remediation Plan (STRICT)

**Plan ID**: PLAN-20250217-CREDPROXY-REMEDIATION
**Related Issues**: #1358 (Credential proxy), #1359 (Host-side refresh), #1360 (Host-side OAuth login)
**Status**: Implementation incomplete — handlers are stubs with hardcoded fake data
**Epic**: #1349 — Unified Credential Management, Phase B

---

## CRITICAL: The Problem Being Fixed

The credential proxy server has **4 fake handler implementations** that return hardcoded test data instead of calling real providers:

| Handler | Line | Fake Pattern | What It Should Do |
|---------|------|--------------|-------------------|
| `handleOAuthInitiate` | ~523 | `auth_url: 'https://auth.example.com/oauth?...'` | Detect provider flow type, create real flow instance, return real auth URL |
| `handleOAuthExchange` | ~558 | `access_token: 'test_access_${sessionId}'` | Call `flow.exchangeCodeForToken(code, state)`, store real token |
| `handleOAuthPoll` | ~615 | `access_token: 'test_access_${sessionId}'` immediate return | Poll real provider for device_code completion |
| `handleRefreshToken` | ~671 | `access_token: 'refreshed_${Date.now()}'` | Call `RefreshCoordinator` → `provider.refreshToken()` |

**These fakes make the credential proxy non-functional for real OAuth flows.**

---

## STRICT Verification Requirements

Every phase verification MUST include:

### 1. Semantic Behavior Checks

Real implementations MUST have specific method calls. Trivial stubs fail these checks:

| Handler | Required Behaviors |
|---------|-------------------|
| `handleOAuthInitiate` | flowFactories.get(), initiateDeviceFlow(), oauthSessions.set() |
| `handleOAuthExchange` | oauthSessions.get(), exchangeCodeForToken(), tokenStore.saveToken(), sanitize |
| `handleOAuthPoll` | pollForToken(), authorization_pending handling, slow_down handling, tokenStore.saveToken() |
| `handleRefreshToken` | RefreshCoordinator.refresh(), provider.refreshToken(), RATE_LIMITED handling |

```bash
# Verification command - check for required method calls
grep -c "flowFactories.get\|initiateDeviceFlow\|oauthSessions.set" file.ts
```

### 2. Fake Pattern Detection

```bash
# FAIL if any of these patterns found in implementation (not comments)
grep -n "test_access\|auth.example.com\|refreshed_\|TODO\|STUB\|fake\|mock\|placeholder" file.ts

# Detect TODO admissions of fake code
grep -n "TODO.*real\|TODO.*actual\|In real implementation\|for testing\|simulate" file.ts

# Detect "will be" future promises (exclude test files and comments)
grep -n "will be\|should be\|would be" file.ts | grep -v "^[0-9]*:.*//.*test"
```

### 3. Semantic Implementation Verification

Verify required method calls are present (not just line counts):

```bash
# Verify all required behaviors exist in implementation
grep -n "flowFactories.get\|exchangeCodeForToken\|pollForToken\|RefreshCoordinator" file.ts
```

### 4. Real Provider Call Verification

```bash
# handleOAuthInitiate MUST access flowFactories
grep -n "flowFactories\|getFlowFactory" file.ts

# handleOAuthExchange MUST call exchange
grep -n "exchangeCodeForToken\|exchangeCode" file.ts

# handleOAuthPoll MUST call poll
grep -n "pollForToken" file.ts

# handleRefreshToken MUST use coordinator
grep -n "RefreshCoordinator\|coordinator\.refresh\|refreshFn" file.ts
```

### 5. Test Reality Checks

```bash
# Tests MUST verify backing store state
grep -n "backingStore\|tokenStore\.get\|tokenStore\.save" test.ts

# Tests MUST NOT use mock theater
grep -n "toHaveBeenCalled\|toHaveBeenCalledWith\|mockReturnValue" test.ts
# FAIL if any found
```

### 6. Deepthinker Critical Analysis

Every phase MUST include deepthinker review with the prompts from `verification-prompts.md`.

---

## What's Keeping (Real Code)

### Client-side (packages/core/src/auth/proxy/) - ALL REAL

| File | Status | Notes |
|------|--------|-------|
| `ProxySocketClient` | [OK] KEEP | Real socket client |
| `ProxyTokenStore` | [OK] KEEP | Real token store adapter |
| `ProxyProviderKeyStorage` | [OK] KEEP | Real key storage adapter |
| `framing.ts` | [OK] KEEP | Real frame encoding/decoding |

### Server-side Token CRUD (credential-proxy-server.ts) - REAL

| Handler | Status | Notes |
|---------|--------|-------|
| `handleGetToken` | [OK] KEEP | Real token retrieval |
| `handleSaveToken` | [OK] KEEP | Real token persistence |
| `handleRemoveToken` | [OK] KEEP | Real token deletion |
| `handleListProviders` | [OK] KEEP | Real provider listing |
| `handleGetApiKey` | [OK] KEEP | Real API key retrieval |

### Infrastructure - REAL

| Component | Status | Notes |
|-----------|--------|-------|
| `RefreshCoordinator` | [OK] KEEP | Real rate limiting, dedup |
| `sandbox-proxy-lifecycle.ts` | [OK] KEEP | Real lifecycle management |
| Unix socket creation | [OK] KEEP | Real socket handling |

---

## What's Being Fixed (Fake → Real)

### 1. handleOAuthInitiate

**Current (FAKE):**
```typescript
this.sendOk(socket, id, {
  flow_type: 'browser_redirect',  // HARDCODED
  session_id: sessionId,
  auth_url: `https://auth.example.com/oauth?provider=${provider}`,  // FAKE URL
  pollIntervalMs: 100,
});
```

**Required (REAL):**
```typescript
// Get flow factory for provider
const flowFactory = this.options.flowFactories.get(provider);
if (!flowFactory) {
  return this.sendError(socket, id, 'PROVIDER_NOT_CONFIGURED', `No flow factory for ${provider}`);
}

// Create flow instance and initiate
const flow = flowFactory();
const flowType = this.detectFlowType(provider, flow);
const initiationResult = await flow.initiateDeviceFlow(redirectUri);

// Store session with flow instance (for later exchange)
this.oauthSessions.set(sessionId, {
  provider,
  bucket,
  flowInstance: flow,
  flowType,
  pkceState: flowType === 'pkce_redirect' ? initiationResult.device_code : undefined,
  createdAt: Date.now(),
  used: false,
});

// Return real auth URL and flow-specific data
this.sendOk(socket, id, {
  flow_type: flowType,
  session_id: sessionId,
  auth_url: initiationResult.verification_uri_complete,
  user_code: initiationResult.user_code,  // for device_code flows
  pollIntervalMs: initiationResult.interval * 1000,
});
```

### 2. handleOAuthExchange

**Current (FAKE):**
```typescript
const token: OAuthToken = {
  access_token: `test_access_${sessionId}`,  // FAKE TOKEN
  token_type: 'Bearer',
  expiry: Math.floor(Date.now() / 1000) + 3600,
};
```

**Required (REAL):**
```typescript
// Retrieve session and flow instance
const session = this.oauthSessions.get(sessionId);
// ... validation ...

// Call REAL exchange
const token = await session.flowInstance.exchangeCodeForToken(code, session.pkceState);

// Store FULL token (including refresh_token)
await this.options.tokenStore.saveToken(session.provider, token, session.bucket);

// Return SANITIZED token (no refresh_token)
const sanitized = sanitizeTokenForProxy(token);
this.sendOk(socket, id, sanitized);
```

### 3. handleOAuthPoll (device_code flows)

**Current (FAKE):**
```typescript
// TODO: For testing, immediately return complete with a token
// In real implementation, this would poll actual OAuth status
const token: OAuthToken = {
  access_token: `test_access_${sessionId}`,  // FAKE!
  token_type: 'Bearer',
  expiry: Math.floor(Date.now() / 1000) + 3600,
};
```

**Required (REAL):**
```typescript
// Retrieve session with device_code and flow instance
const session = this.oauthSessions.get(sessionId);
// ... validation ...

try {
  // Poll provider for token
  const token = await session.flowInstance.pollForToken(session.deviceCode);
  
  // Success! Store FULL token (including refresh_token)
  session.used = true;
  await this.options.tokenStore.saveToken(session.provider, token, session.bucket);
  
  // Return SANITIZED token (no refresh_token)
  const sanitized = sanitizeTokenForProxy(token);
  this.sendOk(socket, id, { status: 'complete', token: sanitized });
  
} catch (error) {
  if (error.code === 'authorization_pending') {
    return this.sendOk(socket, id, { status: 'pending' });
  }
  if (error.code === 'slow_down') {
    return this.sendOk(socket, id, { status: 'pending', interval: error.newInterval });
  }
  // Handle expired_token, access_denied, etc.
}
```

### 4. handleRefreshToken

**Current (FAKE):**
```typescript
const refreshedToken: OAuthToken = {
  ...existingToken,
  access_token: `refreshed_${Date.now()}`,  // FAKE REFRESH
  expiry: Math.floor(Date.now() / 1000) + 3600,
};
```

**Required (REAL):**
```typescript
// Use RefreshCoordinator for rate limiting and dedup
const result = await this.refreshCoordinator.refresh(provider, bucket);

if (result.status === 'rate_limited') {
  return this.sendError(socket, id, 'RATE_LIMITED', 'Refresh rate limited', result.retryAfter);
}

if (result.status !== 'ok') {
  return this.sendError(socket, id, 'REFRESH_FAILED', result.error);
}

// Token is already sanitized by coordinator
this.sendOk(socket, id, result.token);
```

---

## Constructor Changes Required

`CredentialProxyServerOptions` needs:

```typescript
interface CredentialProxyServerOptions {
  tokenStore: TokenStore;
  providerKeyStorage: ProviderKeyStorage;
  socketDir?: string;
  allowedProviders?: string[];
  allowedBuckets?: string[];
  // NEW - Required for real OAuth
  flowFactories: Map<string, () => OAuthFlow>;
  refreshCoordinator: RefreshCoordinator;
}
```

---

## Provider Flow Type Matrix

| Provider | Flow Type | Initiate | Exchange | Refresh |
|----------|-----------|----------|----------|---------|
| **anthropic** | `pkce_redirect` | `AnthropicDeviceFlow.initiateDeviceFlow()` | `flow.exchangeCodeForToken(code, state)` | `flow.refreshToken()` |
| **codex** | `browser_redirect` | `CodexDeviceFlow.buildAuthorizationUrl()` | `flow.exchangeCodeForToken(code)` | `flow.refreshToken()` |
| **qwen** | `device_code` | `QwenDeviceFlow.initiateDeviceFlow()` | `flow.pollForToken(deviceCode)` | `flow.refreshToken()` |
| **gemini** | `pkce_redirect` | `OAuth2Client.generateAuthUrl()` | `authWithCode(client, code)` | `client.getAccessToken()` |

---

## Phased Approach

### Phase 01: Delete Fake Handlers
- Replace fake bodies with `throw new Error('NOT_IMPLEMENTED: handleXxx')`
- Any test that still passes is mock theater and must be deleted
- This creates a clean baseline

### Phase 02-03: OAuth Initiate (TDD -> Impl)
- TDD: Tests verify real flow detection, session creation
- IMPL: Use flowFactories, store flow instance in session

### Phase 04-05: OAuth Exchange (TDD -> Impl)
- TDD: Tests verify backingStore has token after exchange
- IMPL: Call flow.exchangeCodeForToken(), store full token

### Phase 04b-04e: OAuth Poll (TDD -> Impl)
- TDD: Tests verify polling returns pending until complete
- TDD: Tests verify token stored only on completion
- IMPL: Call flow.pollForToken(deviceCode), handle pending/slow_down
- IMPL: Store token on success, return sanitized token

### Phase 06-07: Refresh Token (TDD -> Impl)
- TDD: Tests verify RefreshCoordinator rate limiting
- IMPL: Wire through coordinator to real provider

### Phase 08: Integration Wiring
- sandbox-proxy-lifecycle.ts passes real providers
- Verify end-to-end: sandbox -> proxy -> provider

### Phase 09: Final Acceptance
- Full deepthinker audit
- All verification checks pass
- Manual smoke test

---

## Plan Files

```
project-plans/issue1358_1359_1360_remediation/
├── overview.md                          # This file
├── test-strategy.md                     # Behavioral test requirements
├── verification-prompts.md              # Deepthinker prompts
└── plan/
    ├── 01-delete-fake-handlers.md       # Delete fakes first
    ├── 01a-delete-fake-handlers-verification.md
    ├── 02-oauth-initiate-tdd.md         # Tests FIRST
    ├── 02a-oauth-initiate-tdd-verification.md
    ├── 03-oauth-initiate-impl.md        # Then implementation
    ├── 03a-oauth-initiate-impl-verification.md
    ├── 04-oauth-exchange-tdd.md
    ├── 04a-oauth-exchange-tdd-verification.md
    ├── 04b-oauth-poll-tdd.md            # OAuth Poll TDD
    ├── 04c-oauth-poll-tdd-verification.md
    ├── 04d-oauth-poll-impl.md           # OAuth Poll implementation
    ├── 04e-oauth-poll-impl-verification.md
    ├── 05-oauth-exchange-impl.md
    ├── 05a-oauth-exchange-impl-verification.md
    ├── 06-refresh-token-tdd.md
    ├── 06a-refresh-token-tdd-verification.md
    ├── 07-refresh-token-impl.md
    ├── 07a-refresh-token-impl-verification.md
    ├── 08-integration-wiring.md
    ├── 08a-integration-wiring-verification.md
    └── 09-final-acceptance.md
```

---

## Success Criteria

### Functional
1. [ ] All fake handlers replaced with real implementations
2. [ ] `handleOAuthInitiate` uses flowFactories and stores flow instance
3. [ ] `handleOAuthExchange` calls `flow.exchangeCodeForToken()`
4. [ ] `handleOAuthPoll` calls `flow.pollForToken()` and handles pending status
5. [ ] `handleRefreshToken` uses RefreshCoordinator -> provider.refreshToken()
6. [ ] No hardcoded test values in production code

### Security
7. [ ] `refresh_token` NEVER crosses socket boundary
8. [ ] PKCE verifier NEVER in response
9. [ ] Sessions are single-use and expire

### Quality
10. [ ] All tests verify backingStore state changes
11. [ ] Zero mock theater (no `toHaveBeenCalled`)
12. [ ] All semantic behavior requirements met (verified by method call checks)
13. [ ] Deepthinker verdicts all PASS

### Build
14. [ ] `npm run test` passes
15. [ ] `npm run lint` passes
16. [ ] `npm run typecheck` passes
17. [ ] `npm run build` passes
18. [ ] Smoke test passes

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Flow instance state lost between requests | Store flow instance in session object |
| PKCE verifier leaked in response | Verify in tests; deepthinker checks |
| Concurrent refresh races | RefreshCoordinator handles dedup |
| Different providers need different flows | Flow type detection in handleOAuthInitiate |
| Tests pass with fake impl | Stub-fail verification required |

---

## On the Limits of Verification

**No verification system can completely prevent a sufficiently motivated faker.**

This plan uses multiple layers of defense:
1. **Structural checks** (files exist, markers present)
2. **Behavioral checks** (tests verify state changes)
3. **Semantic checks** (code has required behaviors)
4. **Holistic checks** (human-like "does this make sense?")
5. **Anti-evasion checks** (detect clever tricks)

But a determined model could still:
- Write code that passes all checks but has subtle bugs
- Implement the letter of the requirement but not the spirit
- Create "technically correct" code that fails edge cases

**The final defense is HUMAN REVIEW.** After each phase, a human should:
- Actually read the code diff
- Ask "would I approve this PR?"
- Run the code manually against real providers (in later phases)
- Trust their gut when something feels wrong

The verification phases are designed to ASSIST human review, not replace it.

---

## Canonical Response Schemas

### oauth_initiate Response
```typescript
{
  ok: true,
  data: {
    session_id: string,         // 32 hex chars
    flow_type: 'pkce_redirect' | 'device_code' | 'browser_redirect',
    auth_url: string,           // Real provider URL, NOT example.com
    user_code?: string,         // For device_code flows only
    pollIntervalMs: number,     // Suggested polling interval
  }
}
```

### oauth_exchange Response
```typescript
{
  ok: true,
  data: {
    access_token: string,
    token_type: 'Bearer',
    expiry: number,
    // NO refresh_token - stripped by sanitization
  }
}
```

### oauth_poll Response (pending)
```typescript
{
  ok: true,
  data: {
    status: 'pending',
    interval?: number  // seconds to wait before next poll (if slow_down)
  }
}
```

### oauth_poll Response (complete)
```typescript
{
  ok: true,
  data: {
    status: 'complete',
    token: {
      access_token: string,
      token_type: 'Bearer',
      expiry: number,
      // NO refresh_token - stripped by sanitization
    }
  }
}
```

### refresh_token Response
```typescript
{
  ok: true,
  data: {
    access_token: string,
    token_type: 'Bearer',
    expiry: number,
    // NO refresh_token - stripped by sanitization
  }
}
```
ripped by sanitization
    }
  }
}
```

### refresh_token Response
```typescript
{
  ok: true,
  data: {
    access_token: string,
    token_type: 'Bearer',
    expiry: number,
    // NO refresh_token - stripped by sanitization
  }
}
```
``

### refresh_token Response
```typescript
{
  ok: true,
  data: {
    access_token: string,
    token_type: 'Bearer',
    expiry: number,
    // NO refresh_token - stripped by sanitization
  }
}
```
