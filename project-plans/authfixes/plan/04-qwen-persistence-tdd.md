# Phase 04: Qwen Persistence TDD

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
   - Create 15-20 BEHAVIORAL tests
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
  // Behavioral test implementation
});
```

### Test Coverage Requirements

1. **Token Persistence (REQ-001)**
   - Load token on initialization
   - Save token after authentication
   - Update token after refresh
   - Validate expiry before use

2. **Logout Functionality (REQ-002)**
   - Remove token from storage
   - Handle logout without session
   - Clear token on logout

3. **Token Lifecycle (REQ-003)**
   - Refresh with 30-second buffer
   - Remove invalid tokens
   - Handle missing refresh token

### Behavioral Test Examples

```typescript
// Test actual behavior with real data flows
it('should persist token after successful authentication', async () => {
  const mockToken: OAuthToken = {
    access_token: 'qwen-access-123',
    refresh_token: 'qwen-refresh-456',
    expiry: Date.now() / 1000 + 3600,
    token_type: 'Bearer',
    resource_url: 'https://api.qwen.ai/v1'
  };
  
  const tokenStore = new MultiProviderTokenStore();
  const provider = new QwenOAuthProvider(tokenStore);
  
  // Simulate authentication flow
  await provider.initiateAuth(); // Will fail in stub
  
  const saved = await tokenStore.getToken('qwen');
  expect(saved).toEqual(mockToken);
});
```

### Property-Based Tests (30% minimum)

```typescript
import * as fc from 'fast-check';

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
```

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

# Verify property-based tests
grep -c "test\.prop\(" packages/cli/test/auth/qwen-oauth-provider.test.ts
# Expected: 5+ property tests

# Run tests - should fail naturally
npm test packages/cli/test/auth/qwen-oauth-provider.test.ts
# Expected: Tests fail with "Cannot read property" or similar
```

## Success Criteria

- 15-20 behavioral tests created
- 30% property-based tests
- Tests fail naturally (not with NotYetImplemented)
- No mock theater or reverse testing
- All tests tagged with requirements

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/test/auth/`
2. Re-run Phase 04 with corrected tests

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P04.md`