# Test Strategy: Anti-Fake Behavioral Tests

**Purpose**: Define strict behavioral tests that CANNOT pass with fake implementations.

---

## CRITICAL: Why This Document Exists

The credential proxy handlers were implemented as **fakes that return hardcoded values**. Tests that "pass" against fakes are worthless. This document defines test patterns that:

1. **FAIL against fakes** - Tests that would pass with `return { access_token: 'test_' + id }` are mock theater
2. **VERIFY state changes** - Tests must check backingStore, not just response
3. **DETECT hardcoded values** - Tests must verify token values come from provider, not inline

---

## The Anti-Fake Test Checklist

Every test MUST satisfy ALL of these criteria:

### [OK] REQUIRED Patterns

| Pattern | Why Required |
|---------|--------------|
| `await backingStore.getToken(...)` | Verifies state actually changed |
| `expect(stored?.access_token).toBe(...)` | Verifies correct value persisted |
| Test fails against stub | Proves test has value |
| Complementary failure test | Proves error paths work |

### [FAIL] FORBIDDEN Patterns

| Pattern | Why Forbidden |
|---------|---------------|
| `expect(mock).toHaveBeenCalled()` | Mock theater - tests nothing |
| `expect(mock).toHaveBeenCalledWith(...)` | Tests mock config, not behavior |
| `mockReturnValue(x)` then `expect(result).toBe(x)` | Circular "proof" |
| Testing response only, no state check | Could be fake response |
| Tests that pass with empty implementation | Worthless |

---

## The Stub-Fail Requirement

**CRITICAL**: Before ANY test is accepted, it must be proven to fail against the stub implementation.

### How to Verify

1. **Replace implementation with stub:**
```typescript
private async handleOAuthInitiate(...): Promise<void> {
  throw new Error('NOT_IMPLEMENTED: handleOAuthInitiate');
}
```

2. **Run test:**
```bash
npm test -- --grep "oauth_initiate"
```

3. **Verify test FAILS** - If test passes with stub, it's mock theater

### What Stub-Fail Proves

- Test actually exercises the implementation
- Test would catch regression to fake/stub
- Test has real verification

---

## Anti-Fake Test Patterns

### Pattern 1: Backing Store Verification

```typescript
// [OK] CORRECT: Verify state change via backing store
it('exchange stores token in backing store', async () => {
  // Arrange: Configure provider to return specific token
  const expectedToken = {
    access_token: 'real_from_provider_abc123',  // NOT 'test_access_'
    refresh_token: 'real_refresh_xyz789',
    token_type: 'Bearer' as const,
    expiry: Date.now() + 3600000,
  };
  testFlow.setExchangeResult(expectedToken);

  // Act: Initiate and exchange
  const init = await client.request('oauth_initiate', { provider: 'anthropic' });
  await client.request('oauth_exchange', { 
    session_id: init.data.session_id, 
    code: 'auth_code' 
  });

  // Assert: Verify BACKING STORE has correct token
  const stored = await backingStore.getToken('anthropic');
  expect(stored?.access_token).toBe('real_from_provider_abc123');
  expect(stored?.refresh_token).toBe('real_refresh_xyz789');  // Backing store keeps refresh
});
```

```typescript
// [FAIL] WRONG: Only checks response, not state
it('exchange returns token', async () => {
  const response = await client.request('oauth_exchange', { ... });
  expect(response.ok).toBe(true);
  expect(response.data.access_token).toBeDefined();  // Could be fake!
});
```

### Pattern 2: Sanitization Verification

```typescript
// [OK] CORRECT: Verify refresh_token stripped from response but kept in store
it('exchange strips refresh_token from response but stores it', async () => {
  testFlow.setExchangeResult({
    access_token: 'access_abc',
    refresh_token: 'MUST_NOT_CROSS_SOCKET',
    token_type: 'Bearer' as const,
    expiry: Date.now() + 3600000,
  });

  const init = await client.request('oauth_initiate', { provider: 'anthropic' });
  const exchange = await client.request('oauth_exchange', { 
    session_id: init.data.session_id, 
    code: 'auth_code' 
  });

  // Response must NOT have refresh_token
  expect(exchange.data.refresh_token).toBeUndefined();
  expect('refresh_token' in exchange.data).toBe(false);

  // Backing store MUST have refresh_token
  const stored = await backingStore.getToken('anthropic');
  expect(stored?.refresh_token).toBe('MUST_NOT_CROSS_SOCKET');
});
```

### Pattern 3: Flow Type Detection

```typescript
// [OK] CORRECT: Verify provider-specific flow type
it('anthropic uses pkce_redirect flow', async () => {
  const response = await client.request('oauth_initiate', { provider: 'anthropic' });
  
  expect(response.data.flow_type).toBe('pkce_redirect');
  expect(response.data.auth_url).toContain('console.anthropic.com');  // Real URL
  expect(response.data.auth_url).not.toContain('example.com');  // NOT fake
});

it('qwen uses device_code flow', async () => {
  const response = await client.request('oauth_initiate', { provider: 'qwen' });
  
  expect(response.data.flow_type).toBe('device_code');
  expect(response.data.user_code).toBeDefined();  // device_code has user_code
  expect(response.data.verification_uri).toContain('alibaba');  // Real provider
});
```

```typescript
// [FAIL] WRONG: Would pass with fake hardcoded response
it('returns flow type', async () => {
  const response = await client.request('oauth_initiate', { provider: 'any' });
  expect(response.data.flow_type).toBeDefined();  // 'browser_redirect' would pass!
});
```

### Pattern 4: Session Single-Use Enforcement

```typescript
// [OK] CORRECT: Verify session consumed after use
it('session cannot be used twice', async () => {
  testFlow.setExchangeResult({ access_token: 'token1', ... });

  const init = await client.request('oauth_initiate', { provider: 'anthropic' });
  
  // First exchange succeeds
  const first = await client.request('oauth_exchange', { 
    session_id: init.data.session_id, 
    code: 'code1' 
  });
  expect(first.ok).toBe(true);

  // Second exchange with SAME session fails
  const second = await client.request('oauth_exchange', { 
    session_id: init.data.session_id, 
    code: 'code2' 
  });
  expect(second.ok).toBe(false);
  expect(second.code).toBe('SESSION_ALREADY_USED');
});
```

### Pattern 5: Rate Limiting Verification

```typescript
// [OK] CORRECT: Verify rate limiting with real timing
it('enforces 30s refresh cooldown', async () => {
  // Pre-populate token with refresh capability
  await backingStore.saveToken('anthropic', {
    access_token: 'old_access',
    refresh_token: 'valid_refresh',
    token_type: 'Bearer',
    expiry: Date.now() - 1000,
  });

  // First refresh succeeds
  const first = await client.request('refresh_token', { provider: 'anthropic' });
  expect(first.ok).toBe(true);
  expect(first.data.access_token).not.toBe('old_access');  // Changed!

  // Second refresh within 30s fails with rate limit
  const second = await client.request('refresh_token', { provider: 'anthropic' });
  expect(second.ok).toBe(false);
  expect(second.code).toBe('RATE_LIMITED');
  expect(second.data.retryAfter).toBeGreaterThan(0);
  expect(second.data.retryAfter).toBeGreaterThan(25); // MUST be close to 30 (within ~5s tolerance for timing)
});
```

### Pattern 6: Provider Call Verification (Without Mocks)

```typescript
// [OK] CORRECT: Use controllable test double, verify OUTPUT
class TestOAuthFlow {
  private exchangeCount = 0;
  private exchangeResult: OAuthToken | null = null;

  setExchangeResult(token: OAuthToken): void {
    this.exchangeResult = token;
  }

  async exchangeCodeForToken(code: string, state: string): Promise<OAuthToken> {
    this.exchangeCount++;
    if (!this.exchangeResult) {
      throw new Error('Test flow not configured');
    }
    // Verify code and state are actually passed
    if (!code || !state) {
      throw new Error('Missing code or state');
    }
    return this.exchangeResult;
  }

  getExchangeCount(): number {
    return this.exchangeCount;
  }
}

it('calls flow.exchangeCodeForToken with correct params', async () => {
  const flow = new TestOAuthFlow();
  flow.setExchangeResult({ access_token: 'from_provider', ... });
  server.registerFlowFactory('anthropic', () => flow);

  const init = await client.request('oauth_initiate', { provider: 'anthropic' });
  await client.request('oauth_exchange', { session_id: init.data.session_id, code: 'the_code' });

  // Verify via OUTPUT, not mock assertion
  expect(flow.getExchangeCount()).toBe(1);  // Call happened
  
  // Verify via STATE
  const stored = await backingStore.getToken('anthropic');
  expect(stored?.access_token).toBe('from_provider');  // Right token stored
});
```

```typescript
// [FAIL] WRONG: Mock theater
it('calls exchange', async () => {
  const mockFlow = { exchangeCodeForToken: vi.fn().mockResolvedValue({ ... }) };
  
  await client.request('oauth_exchange', { ... });
  
  expect(mockFlow.exchangeCodeForToken).toHaveBeenCalled();  // MOCK THEATER
});
```

---

## Test File Requirements

### oauth-initiate.spec.ts

| Test | Verification Method |
|------|---------------------|
| Returns correct flow_type per provider | Check specific provider → specific flow_type |
| Returns different session_ids | Compare two init calls |
| Session can be cancelled | Cancel, then exchange fails |
| Unknown provider fails | Expect PROVIDER_NOT_CONFIGURED |
| PKCE verifier NOT in response | `expect('code_verifier' in response.data).toBe(false)` |
| Session stored in server | After init, cancel works (proves session exists) |

### oauth-exchange.spec.ts

| Test | Verification Method |
|------|---------------------|
| Token stored in backingStore | `await backingStore.getToken()` |
| refresh_token NOT in response | `expect(response.data.refresh_token).toBeUndefined()` |
| refresh_token IN backingStore | `expect(stored.refresh_token).toBe(...)` |
| Session invalidated after use | Second exchange fails |
| Session expires after timeout | Wait, then exchange fails |
| Invalid session fails | Random session_id fails |
| Missing code fails | No code → error |

### refresh-token.spec.ts

| Test | Verification Method |
|------|---------------------|
| New token in backingStore | `await backingStore.getToken()` after refresh |
| refresh_token NOT in response | Sanitization check |
| Rate limited within 30s | Second call returns RATE_LIMITED |
| retryAfter in rate limit response | `expect(response.data.retryAfter).toBeGreaterThan(0)` |
| No refresh_token → error | Token without refresh fails |
| Auth error propagated | Provider auth fail → REFRESH_FAILED |

---

## Test Infrastructure

### In-Memory Token Store (NOT a Mock)

```typescript
/**
 * Real implementation that stores tokens in memory.
 * NOT a mock - actually implements TokenStore interface.
 */
class InMemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();

  async saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void> {
    this.tokens.set(`${provider}:${bucket ?? 'default'}`, { ...token });
  }

  async getToken(provider: string, bucket?: string): Promise<OAuthToken | null> {
    return this.tokens.get(`${provider}:${bucket ?? 'default'}`) ?? null;
  }

  // ... other methods
}
```

### Controllable Test Flow (NOT a Mock)

```typescript
/**
 * Test double for OAuth flows.
 * NOT a mock - actually implements flow interface with controllable behavior.
 */
class TestOAuthFlow {
  private initiateResult: DeviceCodeResponse | null = null;
  private exchangeResult: OAuthToken | null = null;
  private refreshResult: OAuthToken | null = null;

  // Control what the flow returns
  setInitiateResult(result: DeviceCodeResponse): void {
    this.initiateResult = result;
  }

  setExchangeResult(result: OAuthToken): void {
    this.exchangeResult = result;
  }

  setRefreshResult(result: OAuthToken): void {
    this.refreshResult = result;
  }

  // Real interface implementation
  async initiateDeviceFlow(): Promise<DeviceCodeResponse> {
    if (!this.initiateResult) throw new Error('Not configured');
    return this.initiateResult;
  }

  async exchangeCodeForToken(code: string, state: string): Promise<OAuthToken> {
    if (!this.exchangeResult) throw new Error('Not configured');
    if (!code) throw new Error('Missing code');
    return this.exchangeResult;
  }

  async refreshToken(): Promise<OAuthToken> {
    if (!this.refreshResult) throw new Error('Not configured');
    return this.refreshResult;
  }
}
```

---

## CI Verification Gate

```yaml
# .github/workflows/test.yml

- name: Verify no mock theater in proxy tests
  run: |
    echo "=== Checking for mock theater ==="
    if grep -rn "toHaveBeenCalled\|toHaveBeenCalledWith\|mockReturnValue" packages/cli/src/auth/proxy/__tests__/*.ts; then
      echo "FAIL: Mock theater found in proxy tests"
      exit 1
    fi
    echo "PASS: No mock theater"

- name: Verify state verification in tests
  run: |
    echo "=== Checking for state verification ==="
    for test in packages/cli/src/auth/proxy/__tests__/oauth-*.spec.ts packages/cli/src/auth/proxy/__tests__/refresh-*.spec.ts; do
      if [ -f "$test" ]; then
        if ! grep -q "backingStore\|tokenStore.*getToken" "$test"; then
          echo "FAIL: $test does not verify backing store state"
          exit 1
        fi
      fi
    done
    echo "PASS: All tests verify state"

- name: Verify no fake patterns in implementation
  run: |
    echo "=== Checking for fake patterns ==="
    if grep -rn "test_access_\|auth.example.com\|refreshed_\${Date" packages/cli/src/auth/proxy/*.ts | grep -v "__tests__\|.spec.ts\|.test.ts"; then
      echo "FAIL: Fake patterns found in implementation"
      exit 1
    fi
    echo "PASS: No fake patterns"
```

---

## Stub-Fail Verification Protocol

Before committing tests, run this verification:

```bash
#!/bin/bash
# verify-stub-fail.sh

set -e

echo "=== STUB-FAIL VERIFICATION ==="

# 1. Save current implementation
cp packages/cli/src/auth/proxy/credential-proxy-server.ts /tmp/real-impl.ts

# 2. Replace with stub
cat > /tmp/stub-handlers.patch << 'EOF'
--- Replace handleOAuthInitiate body with:
    throw new Error('NOT_IMPLEMENTED: handleOAuthInitiate');

--- Replace handleOAuthExchange body with:
    throw new Error('NOT_IMPLEMENTED: handleOAuthExchange');

--- Replace handleRefreshToken body with:
    throw new Error('NOT_IMPLEMENTED: handleRefreshToken');
EOF

# (Manual: Apply patch or use sed)

# 3. Run tests - they MUST fail
echo "Running tests against stub..."
if npm test -- --grep "oauth_initiate\|oauth_exchange\|refresh_token" 2>/dev/null; then
  echo "FAIL: Tests passed against stub - this is mock theater!"
  mv /tmp/real-impl.ts packages/cli/src/auth/proxy/credential-proxy-server.ts
  exit 1
fi

# 4. Restore real implementation
mv /tmp/real-impl.ts packages/cli/src/auth/proxy/credential-proxy-server.ts

# 5. Run tests - they MUST pass
echo "Running tests against real implementation..."
npm test -- --grep "oauth_initiate\|oauth_exchange\|refresh_token" || {
  echo "FAIL: Tests failed against real implementation"
  exit 1
}

echo "=== STUB-FAIL VERIFICATION PASSED ==="
```

---

## Summary

| Requirement | Verification |
|-------------|--------------|
| Tests verify state | grep for `backingStore.getToken` |
| No mock theater | grep for `toHaveBeenCalled` returns 0 |
| Tests fail against stub | Manual stub-fail verification |
| No fake patterns | grep for fake patterns returns 0 |
| Complementary tests | Every success has failure test |
| Sanitization verified | Tests check both response AND backingStore |
