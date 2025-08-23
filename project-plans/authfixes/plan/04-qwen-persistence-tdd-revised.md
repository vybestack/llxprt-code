# Phase 04: Qwen Persistence TDD (REVISED)

## Phase ID
`PLAN-20250823-AUTHFIXES.P04`

## Prerequisites
- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20250823-AUTHFIXES.P03" .`
- Expected: QwenOAuthProvider stub exists

## Implementation Tasks

### Files to Create

1. **`/packages/cli/test/auth/qwen-oauth-provider.test.ts`**
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P04`
   - MUST include: `@requirement:REQ-001`
   - Create 15 BEHAVIORAL tests
   - Create 7 PROPERTY-BASED tests (30%+ of total)
   - NO testing for NotYetImplemented
   - NO reverse tests

### Required Test Structure

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P04
 * @requirement REQ-001.1
 * @scenario Load persisted token on initialization
 * @given Valid token exists in storage
 * @when QwenOAuthProvider is constructed
 * @then Token is loaded and available via getToken()
 */
it('should load persisted token on initialization', async () => {
  // Behavioral test - expects real behavior
  const mockToken: OAuthToken = {
    access_token: 'qwen-access-123',
    refresh_token: 'qwen-refresh-456',
    expiry: Date.now() / 1000 + 3600,
    token_type: 'Bearer',
    resource_url: 'https://api.qwen.ai/v1'
  };
  
  const tokenStore = new MultiProviderTokenStore();
  await tokenStore.saveToken('qwen', mockToken);
  const provider = new QwenOAuthProvider(tokenStore);
  
  const token = await provider.getToken();
  expect(token).toEqual(mockToken); // Expects real behavior, will fail with NotYetImplemented
});
```

### Property-Based Test Examples (7 required - 30% of 22 total tests)

```typescript
import * as fc from 'fast-check';

// Property Test 1: Token expiry validation
test.prop([fc.integer({ min: 0, max: 2147483647 })])(
  'should correctly identify expired tokens for any timestamp',
  (timestamp) => {
    const token: OAuthToken = {
      access_token: 'test',
      expiry: timestamp,
      token_type: 'Bearer'
    };
    
    const provider = new QwenOAuthProvider();
    const isExpired = provider.isTokenExpired(token);
    const expected = timestamp <= (Date.now() / 1000 + 30);
    
    expect(isExpired).toBe(expected);
  }
);

// Property Test 2: Token persistence with random data
test.prop([
  fc.string({ minLength: 10, maxLength: 100 }),
  fc.string({ minLength: 10, maxLength: 100 }),
  fc.integer({ min: Date.now() / 1000, max: Date.now() / 1000 + 86400 })
])(
  'should persist and retrieve tokens with any valid data',
  async (accessToken, refreshToken, expiry) => {
    const token: OAuthToken = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry: expiry,
      token_type: 'Bearer'
    };
    
    const tokenStore = new MultiProviderTokenStore();
    const provider = new QwenOAuthProvider(tokenStore);
    
    // Save via provider flow (will fail in stub)
    const saved = await tokenStore.saveToken('qwen', token);
    const retrieved = await tokenStore.getToken('qwen');
    
    expect(retrieved).toEqual(token);
  }
);

// Property Test 3: Resource URL validation
test.prop([fc.webUrl()])(
  'should handle any valid resource URL',
  async (url) => {
    const token: OAuthToken = {
      access_token: 'test',
      expiry: Date.now() / 1000 + 3600,
      token_type: 'Bearer',
      resource_url: url
    };
    
    const tokenStore = new MultiProviderTokenStore();
    await tokenStore.saveToken('qwen', token);
    
    const provider = new QwenOAuthProvider(tokenStore);
    const retrieved = await provider.getToken();
    
    expect(retrieved?.resource_url).toBe(url);
  }
);

// Property Test 4: Refresh token edge cases
test.prop([fc.option(fc.string(), { nil: undefined })])(
  'should handle optional refresh tokens correctly',
  async (refreshToken) => {
    const token: OAuthToken = {
      access_token: 'access',
      refresh_token: refreshToken,
      expiry: Date.now() / 1000 - 100, // Expired
      token_type: 'Bearer'
    };
    
    const tokenStore = new MultiProviderTokenStore();
    await tokenStore.saveToken('qwen', token);
    
    const provider = new QwenOAuthProvider(tokenStore);
    const result = await provider.refreshIfNeeded();
    
    if (refreshToken) {
      // Should attempt refresh (will fail in stub)
      expect(result).toBeDefined();
    } else {
      // Should clear token without refresh
      expect(result).toBeNull();
    }
  }
);

// Property Test 5: Concurrent token operations
test.prop([fc.array(fc.string(), { minLength: 2, maxLength: 10 })])(
  'should handle concurrent token operations safely',
  async (operations) => {
    const tokenStore = new MultiProviderTokenStore();
    const provider = new QwenOAuthProvider(tokenStore);
    
    const promises = operations.map(async (op) => {
      if (op.length % 2 === 0) {
        return provider.getToken();
      } else {
        return provider.refreshIfNeeded();
      }
    });
    
    const results = await Promise.all(promises);
    // All operations should complete without corruption
    expect(results).toHaveLength(operations.length);
  }
);

// Property Test 6: Token scope combinations
test.prop([fc.array(fc.constantFrom('openid', 'profile', 'email', 'model.completion'))])(
  'should preserve any combination of scopes',
  async (scopes) => {
    const token: OAuthToken = {
      access_token: 'test',
      expiry: Date.now() / 1000 + 3600,
      token_type: 'Bearer',
      scope: scopes.join(' ')
    };
    
    const tokenStore = new MultiProviderTokenStore();
    await tokenStore.saveToken('qwen', token);
    
    const provider = new QwenOAuthProvider(tokenStore);
    const retrieved = await provider.getToken();
    
    expect(retrieved?.scope).toBe(scopes.join(' '));
  }
);

// Property Test 7: Token expiry buffer calculations
test.prop([
  fc.integer({ min: 0, max: 120 }), // Buffer seconds
  fc.integer({ min: 0, max: 7200 }) // Time until expiry
])(
  'should respect configurable expiry buffers',
  (bufferSeconds, timeUntilExpiry) => {
    const now = Date.now() / 1000;
    const token: OAuthToken = {
      access_token: 'test',
      expiry: now + timeUntilExpiry,
      token_type: 'Bearer'
    };
    
    const provider = new QwenOAuthProvider();
    // Assuming isTokenExpired uses 30-second buffer
    const isExpired = provider.isTokenExpired(token);
    
    const expectedExpired = timeUntilExpiry <= 30;
    expect(isExpired).toBe(expectedExpired);
  }
);
```

### Behavioral Test Coverage (15 tests)

1. **Token Persistence (REQ-001)**
   - Load token on initialization
   - Save token after authentication
   - Update token after refresh
   - Validate expiry before use
   - Handle missing token store

2. **Logout Functionality (REQ-002)**
   - Remove token from storage
   - Handle logout without session
   - Clear token on logout

3. **Token Lifecycle (REQ-003)**
   - Refresh with 30-second buffer
   - Remove invalid tokens
   - Handle missing refresh token
   - Handle network errors during refresh

4. **Integration (REQ-004)**
   - Token available to provider
   - Settings updated correctly
   - Backward compatibility maintained

## Verification Commands

```bash
# Check for mock theater
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/test/auth/
# Expected: No results (no mock verification)

# Check for reverse testing
grep -r "toThrow('NotYetImplemented')\|expect.*not\.toThrow()" packages/cli/test/auth/
# Expected: No results

# Check for behavioral assertions
grep -E "toBe\(|toEqual\(|toMatch\(|toContain\(" packages/cli/test/auth/qwen-oauth-provider.test.ts
# Expected: 15+ occurrences

# Verify property-based tests (30% minimum)
TOTAL=$(grep -c "it\(\|test\(" packages/cli/test/auth/qwen-oauth-provider.test.ts)
PROPERTY=$(grep -c "test\.prop\(" packages/cli/test/auth/qwen-oauth-provider.test.ts)
echo "Total tests: $TOTAL, Property tests: $PROPERTY"
# Expected: Total: 22, Property: 7 (31.8%)

# Run tests - should fail naturally with NotYetImplemented
npm test packages/cli/test/auth/qwen-oauth-provider.test.ts 2>&1 | head -20
# Expected: Error: NotYetImplemented (from stub, not from test expectation)
```

## Success Criteria

- 15 behavioral tests + 7 property-based tests = 22 total
- 31.8% property-based tests (exceeds 30% minimum)
- Tests fail with NotYetImplemented from stub
- No mock theater or reverse testing
- All tests tagged with requirements

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P04.md`