# Phase 07: Anthropic Persistence TDD

## Phase ID
`PLAN-20250823-AUTHFIXES.P07`

## Prerequisites
- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20250823-AUTHFIXES.P06" .`
- Expected: AnthropicOAuthProvider stub exists

## Implementation Tasks

### Files to Create

1. **`/packages/cli/test/auth/anthropic-oauth-provider.test.ts`**
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P07`
   - MUST include: `@requirement:REQ-001, REQ-002`
   - Create 15-20 BEHAVIORAL tests
   - Include authorization code flow tests

### Test Coverage Requirements

1. **Token Persistence (REQ-001)**
   - Load token on initialization
   - Save after code exchange
   - Update after refresh

2. **Logout with Revocation (REQ-002)**
   - Attempt token revocation
   - Handle revocation failure gracefully
   - Remove token regardless

3. **Authorization Code Flow**
   - Handle user cancellation
   - Process authorization codes
   - PKCE verification

### Behavioral Test Examples

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P07
 * @requirement REQ-001.3
 * @scenario Refresh and persist expired token
 * @given Token expired with valid refresh token
 * @when refreshIfNeeded() is called
 * @then New token is obtained and persisted
 */
it('should refresh and persist expired token', async () => {
  const expiredToken: OAuthToken = {
    access_token: 'sk-ant-oat-expired',
    refresh_token: 'refresh-valid',
    expiry: Date.now() / 1000 - 100, // Expired
    token_type: 'Bearer'
  };
  
  const tokenStore = new MultiProviderTokenStore();
  await tokenStore.saveToken('anthropic', expiredToken);
  
  const provider = new AnthropicOAuthProvider(tokenStore);
  const refreshed = await provider.refreshIfNeeded();
  
  expect(refreshed?.access_token).not.toBe('sk-ant-oat-expired');
  expect(refreshed?.expiry).toBeGreaterThan(Date.now() / 1000);
});
```

## Verification Commands

```bash
# Check for behavioral assertions
grep -E "toBe\(|toEqual\(|toMatch\(" packages/cli/test/auth/anthropic-oauth-provider.test.ts
# Expected: 15+ occurrences

# Run tests - should fail naturally
npm test packages/cli/test/auth/anthropic-oauth-provider.test.ts
# Expected: Tests fail naturally
```

## Success Criteria

- 15-20 behavioral tests
- Tests handle authorization flow
- 30% property-based tests
- No mock theater

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P07.md`